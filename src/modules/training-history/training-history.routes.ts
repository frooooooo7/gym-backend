import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { trainingHistoryController } from "./training-history.controller.js";

/**
 * Path-relative: mounted only under `/api/v1` (see app.ts), which yields
 * `/api/v1/training-history[/:sessionId]` and the read aliases
 * `/api/v1/training-sessions[/:sessionId]`.
 *
 * Under `/api/v1` the training-sessions (write) router is mounted before this
 * one, so `/training-sessions/active` and `/training-sessions/history` reach
 * that router; any other `GET /training-sessions/:sessionId` lands here.
 */
export const trainingHistoryRouter = Router();

trainingHistoryRouter.get(
  "/training-history",
  requireAuth,
  trainingHistoryController.list,
);
trainingHistoryRouter.get(
  "/training-sessions",
  requireAuth,
  trainingHistoryController.list,
);
trainingHistoryRouter.get(
  "/training-history/:sessionId",
  requireAuth,
  trainingHistoryController.detail,
);
trainingHistoryRouter.get(
  "/training-sessions/:sessionId",
  requireAuth,
  trainingHistoryController.detail,
);
