require("dotenv").config();

module.exports = {
  deviceIp: process.env.DEVICE_IP || "10.8.242.50",
  devicePort: parseInt(process.env.DEVICE_PORT || "4196", 10),
  port: parseInt(process.env.PORT || "3001", 10),
  // "0.0.0.0" (all interfaces) by default so a phone/tablet on the same LAN can reach the
  // bridge directly - override to "127.0.0.1" in production deployments that sit behind a
  // reverse proxy (see PANDUAN_PKL.md) where only loopback access should be allowed.
  host: process.env.HOST || "0.0.0.0",
  apiKey: process.env.API_KEY || "change-me",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "sinso",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "sinso_ptz",
  },
};
