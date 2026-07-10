const express = require("express");
const schedulesRepo = require("../db/schedulesRepo");

// Factory (not a bare router) so the GET list can be enriched with which schedule is
// currently running, per the backend-owned scheduleRunner - the frontend used to compute
// this itself from local state, which reset on every reconnect/reload.
function createSchedulesRouter({ scheduleRunner }) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      const schedules = await schedulesRepo.listSchedules();
      const activeIds = new Set(scheduleRunner.getActiveScheduleIds());
      res.json(schedules.map((s) => ({ ...s, active: activeIds.has(s.id) })));
    } catch (err) { next(err); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const { track_id, start_time, end_time, enabled } = req.body;
      if (!track_id || !start_time || !end_time) {
        return res.status(400).json({ error: "track_id, start_time and end_time are required" });
      }
      const id = await schedulesRepo.createSchedule({ track_id, start_time, end_time, enabled });
      res.status(201).json({ id });
    } catch (err) { next(err); }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      await schedulesRepo.updateSchedule(req.params.id, req.body);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await schedulesRepo.deleteSchedule(req.params.id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createSchedulesRouter };
