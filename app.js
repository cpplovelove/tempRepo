import { fileURLToPath } from "url";
import config from "./config.js";

import path from "path";
import https from "https";
import express from "express";
import mediasoup from "mediasoup";

// import socketIo from "socket.io";
// import * as socketIo from "socket.io";
import Server from "socket.io";

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
// Global variables
let worker;
let mediasoupRouter;
let producer;
let consumer;
let producerTransport;
let consumerTransport;

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

    await runMediasoupWorker();

    await runSocketServer();
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
        console.log("1.5 create consumer 생성함");

        socket.emit("getCreatedConsumerTransport", params);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("connectProducerTransport", async (data, callback) => {
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      console.log("1. producer connection 됐음");
      callback();
    });

    socket.on("connectConsumerTransport", async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      console.log("2. consumer connection 됐음");
    });

    socket.on("produce", async (data, callback) => {
      const { kind, rtpParameters } = data;
      try {
        producer = await producerTransport.produce({ kind, rtpParameters });
        callback({ id: producer.id });

        console.log("2. produce 함 : ", producer.id);
        socket.broadcast.emit("newProducer");
      } catch (err) {
        console.log(err);
      }
    });

    socket.on("consume", async (data, callback) => {
      callback(await createConsumer(producer, data.rtpCapabilities));
      console.log("3. consume 함 : ", consumer.id);
    });

    socket.on("resume", async (data, callback) => {
      await consumer.resume();
      callback();
    });
  });
}

async function runMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on("died", () => {
    console.error(
      "mediasoup worker died, exiting in 2 seconds... [pid:%d]",
      worker.pid
    );
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
}

async function createWebRtcTransport() {
  const { maxIncomingBitrate, initialAvailableOutgoingBitrate } =
    config.mediasoup.webRtcTransport;

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {}
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

async function createConsumer(producer, rtpCapabilities) {
  if (
    !mediasoupRouter.canConsume({
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error("can not consume");
    return;
  }
  try {
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === "video",
    });
  } catch (error) {
    console.error("consume failed", error);
    return;
  }

  if (consumer.type === "simulcast") {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused,
  };
}
