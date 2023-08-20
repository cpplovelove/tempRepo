import { fileURLToPath } from "url";

import path from "path";
import https from "https";
import express from "express";
import initService from "./server/init.js";
import socketIo from "socket.io";
import fs from "fs";
import cors from "cors";

let server;
let socketServer;
let app;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  key: fs.readFileSync("ssl/key.pem"),
  cert: fs.readFileSync("ssl/cert.pem"),
};

(async () => {
  try {
    app = express();
    app.use(express.json());
    app.use(express.static(__dirname));
    app.use(cors({ credentials: true, origin: "http://localhost:3000" }));

    app.get("/test", (req, res) => {
      console.log("test");
      res.send("test");
    });
    server = https.createServer(options, app).listen(5000, () => {
      console.log(`✅ open https://localhost:5000 in your web browser`);
    });

    await runSocketServer();
  } catch (err) {
    console.error(err);
  }
})();

//소켓 연결되고 방 열리고 이런 것들 만들어야함
async function runSocketServer() {
  socketServer = socketIo(server, {
    serveClient: false,
    path: "/server",
    log: false,
    transport: ["websocket"],
    allowEIO3: true,
  });

  socketServer.on("connect", (socket) => {
    console.log(`클라이언트 연결 성공 - 소켓ID: ${socket.id}`);

    // console.log("client connected");
  });
}
