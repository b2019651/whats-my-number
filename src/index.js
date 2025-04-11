require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");

// 創建Express應用
const app = express();
const PORT = process.env.PORT || 3000;

// 設置靜態文件目錄
app.use(express.static(path.join(__dirname, "../public")));

// 創建HTTP服務器並將Express應用集成進去
const server = http.createServer(app);

// 創建WebSocket服務器
const wss = new WebSocket.Server({ server });

// 儲存用戶及其號碼
let users = [];

mongoose.connect(process.env.DATABASE_URL);

const deviceProfileSchema = new mongoose.Schema({
  Fingerprint: { type: String, unique: true },
  DisplayName: String,
});

const DeviceProfile = mongoose.model("DeviceProfile", deviceProfileSchema);

// 中介者模式
class TaskMediator {
  constructor() {
    this.handlers = {};
  }

  register(task, handler) {
    this.handlers[task] = handler;
  }

  handleTask(task, data, ws) {
    if (this.handlers[task]) {
      this.handlers[task](data, ws);
    } else {
      console.warn(`No handler for task: ${task}`);
    }
  }
}

const getSortedUsers = (fingerprint) => {
  const usersCopy = [...users];
  const sortedUsers = usersCopy.sort((a, b) => {
    if (a.fingerprint === fingerprint) return -1;
    if (b.fingerprint === fingerprint) return 1;
    return a.name.localeCompare(b.name);
  });

  return (fingerprint ? sortedUsers : users).map(({ name, number }) => ({
    name,
    number,
  }));
};

// 發送更新給所有已連線的用戶
const syncAllUsers = () => {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;

    const users = getSortedUsers(client.fingerprint);

    client.send(JSON.stringify({ task: "users", users }));
  });
};

// 處理刪除用戶的功能
function deleteUser(name) {
  const userIndex = users.findIndex((user) => user.name === name);
  if (userIndex !== -1) {
    users.splice(userIndex, 1);
    return true;
  }
  return false;
}

async function upsertDeviceProfile(uuid, user) {
  try {
    await DeviceProfile.updateOne(
      { Fingerprint: uuid },
      { $set: { DisplayName: user } },
      { upsert: true }
    );
    console.log("Upsert 成功");
  } catch (error) {
    console.error("Upsert 失敗", error);
  }
}

async function getDisplayName(uuid) {
  try {
    const profile = await DeviceProfile.findOne({ Fingerprint: uuid }).lean();
    return profile?.DisplayName || null;
  } catch (error) {
    console.error("getDisplayName 失敗", error);
  }
}

// 註冊任務處理
const mediator = new TaskMediator();

mediator.register("users", (data, ws) => {
  const { name, number, fingerprint } = data;
  if (!name || !number) return;

  // 檢查該用戶是否已經存在
  const userIndex = users.findIndex((user) => user.name === name);
  if (userIndex !== -1) {
    // 更新號碼
    users[userIndex].number = number;
  } else {
    // 新用戶，加入名單
    users.push({ name, number, fingerprint });
  }

  // UPSERT
  upsertDeviceProfile(fingerprint, name);

  syncAllUsers();
});

mediator.register("delete", (data, ws) => {
  const { name } = data;

  if (name) deleteUser(name);

  syncAllUsers();
});

mediator.register("default-user", async (data, ws) => {
  const displayName = await getDisplayName(data.fingerprint);

  ws.send(JSON.stringify({ task: "default-user", displayName }));
});

wss.on("connection", (ws, req) => {
  const params = new URL(req.url, `http://${req.headers.host}`).searchParams;

  ws.fingerprint = params.get("fingerprint");

  const users = getSortedUsers(ws.fingerprint);

  // 當有新用戶連線時，會把目前所有用戶號碼資料發送給新用戶
  ws.send(JSON.stringify({ task: "users", users }));

  // 當接收到來自用戶的訊息時，更新該用戶的號碼
  ws.on("message", (message) => {
    const data = JSON.parse(message.toString());
    const { task } = data;

    mediator.handleTask(task, data, ws);
  });

  ws.on("close", () => {
    // 當用戶離開時，可以在此處處理用戶離開邏輯（如移除該用戶）
  });
});

// 啟動服務器
server.listen(PORT, () => {
  console.log(`伺服器已啟動，監聽 ${PORT} 端口，WebSocket端口與HTTP端口相同`);
});

process.on("SIGINT", async () => {
  console.log("應用關閉中");
  await mongoose.disconnect();
});
