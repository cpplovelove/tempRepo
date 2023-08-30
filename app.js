import { fileURLToPath } from "url";
import config from "./config.js";
import Room from "./room.js";
import Peer from "./peer.js";

import path from "path";
import https from "https";
import express from "express";
import mediasoup from "mediasoup";

// import socketIo from "socket.io";
// import * as socketIo from "socket.io";
import Server from "socket.io";

import fs from "fs";
import cors from "cors";

let roomList = new Map();
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
let workers;

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

    socket.on("createRoom", async ({ room_id }, callback) => {
      socket.room_id = room_id;

      if (roomList.has(socket.room_id)) {
        callback({ error: "already exists" });
      } else {
        log.debug("Created room", { room_id: socket.room_id });
        // let worker = await getMediasoupWorker(workers, nextMediasoupWorkerIdx);
        roomList.set(socket.room_id, new Room(socket.room_id, worker, io));
        callback({ room_id: socket.room_id });
      }
    });

    socket.on("setHost", async (callback) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("setHost", socket.id);
      roomList.get(socket.room_id).setHost(socket.id);

      const resJson = roomList
        .get(socket.room_id)
        .getPeers()
        .get(socket.id)?.peer_info;
      roomList.get(socket.room_id).broadCast(socket.id, "setHost", resJson);
      callback("Successfully setHost");
    });

    socket.on("accessReq", async (peer_info, callback) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("accessRequest", socket.id);

      const host = roomList.get(socket.room_id).getHost();
      roomList.get(socket.room_id).sendTo(host, "accessReqest", peer_info);
      callback("Successfully request access");
    });

    socket.on("accessRes", async (data, callback) => {
      if (!roomList.has(socket.room_id)) return;
      const host = roomList.get(socket.room_id).getHost();
      const { access, peer_info } = data;

      log.debug("accessResponse", data);

      if (socket.id != host) return;
      roomList
        .get(socket.room_id)
        .sendTo(peer_info.peer_id, "permitResponse", access);
      callback("Successfully response access");
    });

    socket.on("getPeerCounts", async ({}, callback) => {
      if (!roomList.has(socket.room_id)) return;

      let peerCounts = roomList.get(socket.room_id).getPeersCount();

      log.debug("Peer counts", { peerCounts: peerCounts });

      callback({ peerCounts: peerCounts });
    });

    socket.on("peerAction", (data) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("Peer action", data);

      if (data.broadcast) {
        roomList
          .get(socket.room_id)
          .broadCast(data.peer_id, "peerAction", data);
      } else {
        roomList.get(socket.room_id).sendTo(data.peer_id, "peerAction", data);
      }
    });

    socket.on("updatePeerInfo", (data) => {
      if (!roomList.has(socket.room_id)) return;

      // update my peer_info status to all in the room
      roomList
        .get(socket.room_id)
        .getPeers()
        .get(socket.id)
        .updatePeerInfo(data);
      roomList.get(socket.room_id).broadCast(socket.id, "updatePeerInfo", data);
    });

    socket.on("setVideoOff", (data) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("Video off", getPeerName());
      roomList.get(socket.room_id).broadCast(socket.id, "setVideoOff", data);
    });

    socket.on("join", (data, cb) => {
      data = JSON.parse(data);
      console.log(data);
      socket.room_id = data.room_id;

      if (!roomList.has(socket.room_id)) {
        return cb({
          error: "Room does not exist",
        });
      }

      log.debug("User joined", data);
      roomList.get(socket.room_id).addPeer(new Peer(socket.id, data));
      roomList
        .get(socket.room_id)
        .broadCast(socket.id, "newMemberJoined", data);

      cb(roomList.get(socket.room_id).toJson());
    });

    socket.on("getRouterRtpCapabilities", (_, callback) => {
      if (!roomList.has(socket.room_id)) {
        return callback({ error: "Room not found" });
      }

      log.debug("Get RouterRtpCapabilities", getPeerName());
      try {
        callback(roomList.get(socket.room_id).getRtpCapabilities());
      } catch (err) {
        callback({
          error: err.message,
        });
      }
    });

    socket.on("getProducers", () => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("Get producers", getPeerName());

      // send all the current producer to newly joined member
      let producerList = roomList.get(socket.room_id).getProducerListForPeer();

      socket.emit("newProducers", producerList);
    });

    socket.on("createWebRtcTransport", async (_, callback) => {
      if (!roomList.has(socket.room_id)) {
        return callback({ error: "Room not found" });
      }

      log.debug("Create webrtc transport", getPeerName());
      try {
        const { params } = await roomList
          .get(socket.room_id)
          .createWebRtcTransport(socket.id);
        callback(params);
      } catch (err) {
        log.error("Create WebRtc Transport error: ", err.message);
        callback({
          error: err.message,
        });
      }
    });

    socket.on(
      "connectTransport",
      async ({ transport_id, dtlsParameters }, callback) => {
        if (!roomList.has(socket.room_id)) {
          return callback({ error: "Room not found" });
        }

        log.debug("Connect transport", getPeerName());

        await roomList
          .get(socket.room_id)
          .connectPeerTransport(socket.id, transport_id, dtlsParameters);

        callback("success");
      }
    );

    socket.on(
      "produce",
      async (
        { producerTransportId, kind, appData, rtpParameters },
        callback
      ) => {
        if (!roomList.has(socket.room_id)) {
          return callback({ error: "Room not found" });
        }

        let peer_name = getPeerName(false);

        // peer_info audio Or video ON
        let data = {
          peer_name: peer_name,
          peer_id: socket.id,
          kind: kind,
          type: appData.mediaType,
          status: true,
        };
        await roomList
          .get(socket.room_id)
          .getPeers()
          .get(socket.id)
          .updatePeerInfo(data);

        let producer_id = await roomList
          .get(socket.room_id)
          .produce(
            socket.id,
            producerTransportId,
            rtpParameters,
            kind,
            appData.mediaType
          );

        log.debug("Produce", {
          kind: kind,
          type: appData.mediaType,
          peer_name: peer_name,
          peer_id: socket.id,
          producer_id: producer_id,
        });

        // add producer to audio level observer
        if (kind === "audio") {
          roomList
            .get(socket.room_id)
            .addProducerToAudioLevelObserver({ producerId: producer_id });
        }

        callback({
          producer_id,
        });
      }
    );

    socket.on(
      "consume",
      async (
        { consumerTransportId, producerId, rtpCapabilities },
        callback
      ) => {
        if (!roomList.has(socket.room_id)) {
          return callback({ error: "Room not found" });
        }

        let params = await roomList
          .get(socket.room_id)
          .consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

        log.debug("Consuming", {
          peer_name: getPeerName(false),
          producer_id: producerId,
          consumer_id: params ? params.id : undefined,
        });

        callback(params);
      }
    );

    socket.on("producerClosed", (data) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("Producer close", data);

      // update video, audio OFF
      roomList
        .get(socket.room_id)
        .getPeers()
        .get(socket.id)
        .updatePeerInfo(data);
      roomList.get(socket.room_id).broadCast(socket.id, "updatePeerInfo", data);
      roomList.get(socket.room_id).closeProducer(socket.id, data.producer_id);
    });

    socket.on("refreshParticipantsCount", () => {
      if (!roomList.has(socket.room_id)) return;

      let data = {
        room_id: socket.room_id,
        peer_counts: roomList.get(socket.room_id).getPeers().size,
      };
      log.debug("Refresh Participants count", data);
      roomList
        .get(socket.room_id)
        .broadCast(socket.id, "refreshParticipantsCount", data);
    });

    socket.on("message", (data) => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("message", data);
      if (data.to_peer_id == "all") {
        roomList.get(socket.room_id).broadCast(socket.id, "message", data);
      } else {
        roomList.get(socket.room_id).sendTo(data.to_peer_id, "message", data);
      }
    });

    socket.on("disconnect", () => {
      if (!roomList.has(socket.room_id)) return;

      log.debug("Disconnect", getPeerName());
      roomList.get(socket.room_id).removePeer(socket.id);
      roomList
        .get(socket.room_id)
        .broadCast(socket.id, "removeMe", removeMeData());

      if (roomList.get(socket.room_id).getPeers().size === 0) {
        roomList.delete(socket.room_id);
      }
      socket.room_id = null;
    });

    socket.on("exitHost", async (newHost, callback) => {
      if (!roomList.has(socket.room_id)) {
        return callback({
          error: "Not currently in a room",
        });
      }
      if (!newHost)
        return callback({
          error: "new hostInfo required",
        });
      if (!roomList.get(socket.room_id).isExist(newHost.peer_id))
        return callback({
          error: "new host is not Exist in the room",
        });

      log.debug("Exit room Host", getPeerName());

      roomList.get(socket.room_id).setHost(newHost.peer_id);
      const resJson = roomList
        .get(socket.room_id)
        .getPeers()
        .get(socket.id)?.peer_info;
      roomList.get(socket.room_id).broadCast(socket.id, "setHost", resJson);
      log.debug("setHost", socket.id);

      await roomList.get(socket.room_id).removePeer(socket.id);

      roomList
        .get(socket.room_id)
        .broadCast(socket.id, "removeMe", removeMeData());

      if (roomList.get(socket.room_id).getPeers().size === 0) {
        roomList.delete(socket.room_id);
      }

      socket.room_id = null;

      callback("Successfully exited room");
    });

    function getPeerName(json = true) {
      try {
        let peer_name =
          roomList.get(socket.room_id) &&
          roomList.get(socket.room_id).getPeers().get(socket.id).peer_info
            ?.peer_name;
        if (json) {
          return {
            peer_name: peer_name,
          };
        }
        return peer_name;
      } catch (err) {
        log.error("getPeerName", err);
        return json ? { peer_name: "undefined" } : "undefined";
      }
    }

    function removeMeData() {
      return {
        room_id: roomList.get(socket.room_id) && socket.room_id,
        peer_id: socket.id,
        peer_counts:
          roomList.get(socket.room_id) &&
          roomList.get(socket.room_id).getPeers().size,
      };
    }
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
