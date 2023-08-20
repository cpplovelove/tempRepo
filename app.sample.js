import {
  createConsumer,
  createWebRtcTransport,
  runMediasoupWorker,
} from "./server/service.js";
import { fileURLToPath } from "url";

import path from "path";
import https from "https";
import express from "express";
import initService from "./server/init.js";
import { Server } from "socket.io";

let server;
let socketServer;
let app;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    app.get("/test", (req, res) => {
      console.log("test");
      res.send("test");
    });

    //web server 띄우기
    // const tls = initService.runWebServer();
    // server = https.createServer(tls, app);
    server = https.createServer(app);

    server.on("error", (err) => {
      console.error("starting web server failed:", err.message);
    });

    // await new Promise((resolve) => {
    //   server.listen(5000, () => {
    //     const ip = "127.0.0.1" || null;
    //     console.log("server is running");
    //     console.log(`✅ open https://${ip}:5000 in your web browser`);
    //     resolve();
    //   });
    // });
    server.listen(5000, () => {
      const ip = "127.0.0.1" || null;
      console.log("server is running");
      console.log(`✅ open https://${ip}:5000 in your web browser`);
    });

    // await runWebServer();
    await runSocketServer();
    //여기 고쳐야함
    await runMediasoupWorker(worker, mediasoupRouter);
  } catch (err) {
    console.error(err);
  }
})();

//소켓 연결되고 방 열리고 이런 것들 만들어야함
async function runSocketServer() {
  socketServer = new Server(server, {
    serveClient: false,
    path: "/server",
    log: false,
  });

  socketServer.on("connection", (socket) => {
    console.log("client connected");

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

    socket.on("createProducerTransport", async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport(
          mediasoupRouter
        );
        producerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
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
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on("connectConsumerTransport", async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on("produce", async (data, callback) => {
      const { kind, rtpParameters } = data;
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback({ id: producer.id });

      // inform clients about new producer
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
