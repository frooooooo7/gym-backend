import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { healthService } from "./health.service.js";

export const healthController = {
  getHealth: (_req: Request, res: Response): void => {
    res.status(200).json({ status: "ok" });
  },

  getReady: asyncHandler(async (_req, res) => {
    const { status, body } = await healthService.getReadiness();
    res.status(status).json(body);
  }),
};
