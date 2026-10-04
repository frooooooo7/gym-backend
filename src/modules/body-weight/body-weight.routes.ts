import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { bodyWeightController } from "./body-weight.controller.js";
import {
  bodyWeightDateParamsSchema,
  bodyWeightListQuerySchema,
  bodyWeightUpsertSchema,
} from "./body-weight.schemas.js";

export const bodyWeightRouter = Router();

bodyWeightRouter.get(
  "/body-weight",
  requireAuth,
  validateRequest({ query: bodyWeightListQuerySchema }),
  bodyWeightController.list,
);

bodyWeightRouter.put(
  "/body-weight/:date",
  requireAuth,
  validateRequest({
    params: bodyWeightDateParamsSchema,
    body: bodyWeightUpsertSchema,
  }),
  bodyWeightController.upsert,
);

bodyWeightRouter.delete(
  "/body-weight/:date",
  requireAuth,
  validateRequest({ params: bodyWeightDateParamsSchema }),
  bodyWeightController.remove,
);
