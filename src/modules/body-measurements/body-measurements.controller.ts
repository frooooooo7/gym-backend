import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import type {
  BodyMeasurementsListQuery,
  BodyMeasurementsUpsertInput,
} from "./body-measurements.schemas.js";
import { bodyMeasurementsService } from "./body-measurements.service.js";

export const bodyMeasurementsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const { limit } = req.query as unknown as BodyMeasurementsListQuery;
    res.status(200).json(await bodyMeasurementsService.list(userId, limit));
  }),

  upsert: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const entry = await bodyMeasurementsService.upsert(
      userId,
      req.params.date,
      req.body as BodyMeasurementsUpsertInput,
    );
    res.status(200).json(entry);
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    await bodyMeasurementsService.delete(userId, req.params.date);
    res.status(204).end();
  }),
};
