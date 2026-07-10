require("dotenv").config();

module.exports = {
  deviceIp: process.env.DEVICE_IP || "192.168.1.60",
  devicePort: parseInt(process.env.DEVICE_PORT || "4196", 10),
  port: parseInt(process.env.PORT || "3001", 10),
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
