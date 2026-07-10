const config = require("./config");

// Minimal shared-secret protection: one API key checked on every REST request
// (X-Api-Key header) and on WebSocket connect (?key= query param). Cheap to add
// now; deliberately simple (no user accounts/sessions) since this only needs to
// keep the control channel from being wide open to anyone on the network.
function requireApiKey(req, res, next) {
  const key = req.get("X-Api-Key");
  if (key !== config.apiKey) {
    return res.status(401).json({ error: "invalid or missing X-Api-Key header" });
  }
  next();
}

function isValidWsKey(key) {
  return key === config.apiKey;
}

module.exports = { requireApiKey, isValidWsKey };
