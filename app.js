import { fileURLToPath } from "url";

import path from "path";
import https from "https";
import express from "express";
import initService from "./server/init.js";
import { runMediasoupWorker, createWebRtcTransport } from "./server/service.js";
import socketIo from "socket.io";
import fs from "fs";
import cors from "cors";
import { WebRtcTransport } from "mediasoup/node/lib/WebRtcTransport.js";

let flag = false;
let server;
let socketServer;
let app;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  key: fs.readFileSync("ssl/key.pem"),
  cert: fs.readFileSync("ssl/cert.pem"),
};
// Global variables
let worker;
let mediasoupRouter;
let producer;
let producerTransport;

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

    const { worker: tempWorker, mediasoupRouter: tempRouter } =
      await runMediasoupWorker(worker, mediasoupRouter);
    (worker = tempWorker), (mediasoupRouter = tempRouter);

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

    // inform the client about existence of producer
    if (producer) {
      socket.emit("newProducer");
    }

    socket.on("disconnect", () => {
      console.log("client disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error("client connection error", err);
    });

    socket.on("getRouterRtpCapabilities", (data, callback) => {
      callback(mediasoupRouter.rtpCapabilities);
    });

    socket.emit("getRouterRtpCapabilities", mediasoupRouter.rtpCapabilities);

    socket.on("createProducerTransport", async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport(
          mediasoupRouter
        );
        producerTransport = transport;
        socket.emit("getCreatedProducerTransport", params);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("createConsumerTransport", async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport(
          mediasoupRouter
        );
        consumerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on("connectProducerTransport", async (data, callback) => {
      console.log(producerTransport);
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      console.log("producer connection 성공");
    });

    socket.on("connectConsumerTransport", async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on("produce", async (data, callback) => {
      console.log("produce 하다");

      const { kind, rtpParameters } = data;
      producer = await producerTransport.produce({ kind, rtpParameters });

      socket.broadcast.emit("newProducer");
    });

    socket.on("consume", async (data, callback) => {
      callback(await createConsumer(producer, data.rtpCapabilities));
    });

    socket.on("resume", async (data, callback) => {
      await consumer.resume();
      callback();
    });
  });
}
