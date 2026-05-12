import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage, uuidParamsSchema } from "../../common/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { trainingPlanBodySchema } from "./training-plans.schemas.js";
import { trainingPlansService } from "./training-plans.service.js";

export const trainingPlansController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const plans = await trainingPlansService.list(userId);
    res.status(200).json(plans);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = trainingPlanBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const { plan, created } = await trainingPlansService.create(
      userId,
      parsed.data,
    );
    res.status(created ? 201 : 200).json(plan);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = uuidParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({
        error: firstZodMessage(parsedParams.error.issues),
      });
      return;
    }
    const parsed = trainingPlanBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const plan = await trainingPlansService.update(
      userId,
      parsedParams.data.id,
      parsed.data,
    );
    res.status(200).json(plan);
  }),

  destroy: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = uuidParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({
        error: firstZodMessage(parsedParams.error.issues),
      });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    await trainingPlansService.deleteIfOwned(userId, parsedParams.data.id);
    res.status(204).send();
  }),
};
