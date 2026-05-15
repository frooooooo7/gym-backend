import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { trainingHistoryController } from "./training-history.controller.js";

export const trainingHistoryRouter = Router();

trainingHistoryRouter.get(
  "/api/v1/training-history",
  requireAuth,
  trainingHistoryController.list,
);
trainingHistoryRouter.get(
  "/api/v1/training-sessions",
  requireAuth,
  trainingHistoryController.list,
);
trainingHistoryRouter.get(
  "/api/v1/training-history/:sessionId",
  requireAuth,
  trainingHistoryController.detail,
);
trainingHistoryRouter.get(
  "/api/v1/training-sessions/:sessionId",
  requireAuth,
  trainingHistoryController.detail,
);
