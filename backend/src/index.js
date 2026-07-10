const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const config = require("./config");
const { requireApiKey, isValidWsKey } = require("./auth");
const { createDeviceClient } = require("./device/deviceClient");
const { attachControlSocket } = require("./ws/controlSocket");
const { createScheduleRunner } = require("./scheduler/scheduleRunner");
const activityLogRepo = require("./db/activityLogRepo");
const tracksRouter = require("./routes/tracks");
const { createSchedulesRouter } = require("./routes/schedules");
const activityLogRouter = require("./routes/activityLog");

const deviceClient = createDeviceClient({ deviceIp: config.deviceIp, devicePort: config.devicePort });
const scheduleRunner = createScheduleRunner({ deviceClient, activityLogRepo });
scheduleRunner.start();

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/tracks", requireApiKey, tracksRouter);
app.use("/api/schedules", requireApiKey, createSchedulesRouter({ scheduleRunner }));
app.use("/api/activity-log", requireApiKey, activityLogRouter);

// Serve the built React app in production (frontend/dist), after `npm run build`
// in frontend/. In dev, run the Vite dev server separately (it proxies /api and /ws
// here) - this static block is simply a no-op 404 passthrough until dist/ exists.
app.use(express.static(path.join(__dirname, "../../frontend/dist")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });
attachControlSocket(wss, { deviceClient, activityLogRepo, scheduleRunner });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (!isValidWsKey(url.searchParams.get("key"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port} (REST + /ws)`);
});
