const express = require("express");
const tracksRepo = require("../db/tracksRepo");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    res.json(await tracksRepo.listTracks());
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, waypoints, dwellMs, loopDwellMs } = req.body;
    if (!name || !Array.isArray(waypoints)) {
      return res.status(400).json({ error: "name and waypoints[] are required" });
    }
    res.status(201).json(await tracksRepo.createTrack({ name, waypoints, dwellMs, loopDwellMs }));
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const track = await tracksRepo.getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: "track not found" });
    res.json(track);
  } catch (err) { next(err); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { name, waypoints, dwellMs, loopDwellMs } = req.body;
    if (!name || !Array.isArray(waypoints)) {
      return res.status(400).json({ error: "name and waypoints[] are required" });
    }
    res.json(await tracksRepo.updateTrack(req.params.id, { name, waypoints, dwellMs, loopDwellMs }));
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await tracksRepo.deleteTrack(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
