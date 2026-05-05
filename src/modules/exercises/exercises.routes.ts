import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { exercisesLimiter } from "../../middleware/rate-limit.js";
import { exercisesController } from "./exercises.controller.js";

export const exercisesRouter = Router();

exercisesRouter.use(exercisesLimiter);

exercisesRouter.get("/exercises", requireAuth, exercisesController.list);
exercisesRouter.post("/exercises", requireAuth, exercisesController.create);
exercisesRouter.put(
  "/exercises/:id",
  requireAuth,
  exercisesController.update,
);
exercisesRouter.delete(
  "/exercises/:id",
  requireAuth,
  exercisesController.destroy,
);
exercisesRouter.post(
  "/exercises/:id/favourite",
  requireAuth,
  exercisesController.toggleFavourite,
);
