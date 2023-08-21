import { fileURLToPath } from "url";

import path from "path";
import https from "https";
import express from "express";
import initService from "./server/init.js";
import {
  runMediasoupWorker,
  createWebRtcTransport,
  createConsumer,
} from "./server/service.js";
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
        console.log("create consumer");

        socket.emit("getCreatedConsumerTransport", params);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("connectProducerTransport", async (data, callback) => {
      console.log(producerTransport);
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      //잠깐 produce 넣기
      producer = await producerTransport.produce({
        kind: "video",
        rtpParameters: {
          mid: "1",
          codecs: [
            {
              mimeType: "video/VP8",
              payloadType: 101,
              clockRate: 90000,
              rtcpFeedback: [
                { type: "nack" },
                { type: "nack", parameter: "pli" },
                { type: "ccm", parameter: "fir" },
                { type: "goog-remb" },
              ],
            },
            {
              mimeType: "video/rtx",
              payloadType: 102,
              clockRate: 90000,
              parameters: { apt: 101 },
            },
          ],
          headerExtensions: [
            {
              id: 2,
              uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
            },
            {
              id: 3,
              uri: "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
            },
            {
              id: 5,
              uri: "urn:3gpp:video-orientation",
            },
            {
              id: 6,
              uri: "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
            },
          ],
          encodings: [
            { rid: "r0", active: true, maxBitrate: 100000 },
            { rid: "r1", active: true, maxBitrate: 300000 },
            { rid: "r2", active: true, maxBitrate: 900000 },
          ],
          rtcp: {
            cname: "Zjhd656aqfoo",
          },
        },
      });
      console.log("제발" + producer);
      socket.broadcast.emit("newProducer");
      console.log("producer connection 성공");
    });

    socket.on("connectConsumerTransport", async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      console.log("consumer connection");
    });

    socket.on("produce", async (data, callback) => {
      console.log("produce 하다");

      const { kind, rtpParameters } = data;
      producer = await producerTransport.produce({ kind, rtpParameters });

      socket.broadcast.emit("newProducer");
    });

    socket.on("consume", async (data, callback) => {
      console.log("consume 하는 거임");
      socket.emit(
        "consumeResult",
        await createConsumer(
          mediasoupRouter,
          producer,
          consumerTransport,
          data.rtpCapabilities
        )
      );
    });

    socket.on("resume", async (data, callback) => {
      await consumer.resume();
      callback();
    });
  });
}
