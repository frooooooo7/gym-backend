import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import type {
  BodyWeightListQuery,
  BodyWeightUpsertInput,
} from "./body-weight.schemas.js";
import { bodyWeightService } from "./body-weight.service.js";

export const bodyWeightController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const { limit } = req.query as unknown as BodyWeightListQuery;
    res.status(200).json(await bodyWeightService.list(userId, limit));
  }),

  upsert: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const { weightKg } = req.body as BodyWeightUpsertInput;
    const entry = await bodyWeightService.upsert(
      userId,
      req.params.date,
      weightKg,
    );
    res.status(200).json(entry);
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    await bodyWeightService.delete(userId, req.params.date);
    res.status(204).end();
  }),
};
