const express = require("express");
const activityLogRepo = require("../db/activityLogRepo");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { limit, since, type } = req.query;
    res.json(await activityLogRepo.list({ limit, since, type }));
  } catch (err) { next(err); }
});

module.exports = router;
