const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");

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

// 處理刪除用戶的功能
function deleteUser(name) {
  const userIndex = users.findIndex((user) => user.name === name);
  if (userIndex !== -1) {
    users.splice(userIndex, 1);
    return true;
  }
  return false;
}

wss.on("connection", (ws) => {
  // 當有新用戶連線時，會把目前所有用戶號碼資料發送給新用戶
  ws.send(JSON.stringify(users));

  // 當接收到來自用戶的訊息時，更新該用戶的號碼
  ws.on("message", (message) => {
    const data = JSON.parse(message.toString());

    // 處理刪除操作
    if (data.action === "delete" && data.name) {
      if (deleteUser(data.name)) {
        // 發送更新給所有已連線的用戶
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(users));
          }
        });
      }
      return;
    }

    const { name, number } = data;
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

    // 發送更新給所有已連線的用戶
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(users));
      }
    });
  });

  ws.on("close", () => {
    // 當用戶離開時，可以在此處處理用戶離開邏輯（如移除該用戶）
  });
});

// 啟動服務器
server.listen(PORT, () => {
  console.log(`伺服器已啟動，監聽 ${PORT} 端口，WebSocket端口與HTTP端口相同`);
});
