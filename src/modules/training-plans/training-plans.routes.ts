import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { trainingPlansController } from "./training-plans.controller.js";

export const trainingPlansRouter = Router();

trainingPlansRouter.get(
  "/training-plans",
  requireAuth,
  trainingPlansController.list,
);
trainingPlansRouter.post(
  "/training-plans",
  requireAuth,
  trainingPlansController.create,
);
trainingPlansRouter.put(
  "/training-plans/:id",
  requireAuth,
  trainingPlansController.update,
);
trainingPlansRouter.delete(
  "/training-plans/:id",
  requireAuth,
  trainingPlansController.destroy,
);
