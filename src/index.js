require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Client } = require("pg");

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

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

client.connect();

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

// 發送更新給所有已連線的用戶
const syncAllUsers = () => {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;

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
  const query = `
    INSERT INTO "DeviceProfiles" ("Fingerprint", "DisplayName")
    VALUES ($1, $2)
    ON CONFLICT ("Fingerprint") DO UPDATE
    SET "DisplayName" = EXCLUDED."DisplayName";
  `;

  try {
    await client.query(query, [uuid, user]);
    console.log("Upsert 成功");
  } catch (error) {
    console.error("Upsert 失敗", error);
  }
}

async function getDisplayName(uuid) {
  const query = `
    SELECT "DisplayName" FROM "DeviceProfiles" WHERE "Fingerprint" = $1;
  `;
  try {
    const result = await client.query(query, [uuid]);

    return result.rows[0].DisplayName;
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
    users.push({ name, number });
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

wss.on("connection", (ws) => {
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
  await client.end();
});
