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
    const query = req.query as BodyWeightListQuery;
    const body = await bodyWeightService.list(userId, query.from, query.to);
    res.status(200).json(body);
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

  remove: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    await bodyWeightService.remove(userId, req.params.date);
    res.status(204).end();
  }),
};
