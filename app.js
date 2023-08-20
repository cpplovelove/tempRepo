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

app = express();
app.use(express.json());
app.use(express.static(__dirname));
app.get("/test", (req, res) => {
  console.log("test");
  res.send("test");
});

app.listen(5000,funciton(){
    console.log()
})