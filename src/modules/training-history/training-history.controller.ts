import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage } from "../../common/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  decodeCursor,
  trainingHistoryIdParamsSchema,
  trainingHistoryListQuerySchema,
} from "./training-history.schemas.js";
import { trainingHistoryService } from "./training-history.service.js";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_limit: "limit must be an integer between 1 and 50",
  invalid_cursor: "cursor must be a valid opaque cursor from previous page",
  invalid_plan_id: "planId must be a valid UUID",
  invalid_date_range: "from must be earlier than or equal to to",
  invalid_session_id: "sessionId must be a valid UUID",
};

const messageFor = (code: string): string => ERROR_MESSAGES[code] ?? code;

const weakEtag = (value: unknown): string => {
  const hash = createHash("sha1").update(JSON.stringify(value)).digest("hex");
  return `W/"${hash}"`;
};

const sendWithEtag = (req: Request, res: Response, body: unknown) => {
  const etag = weakEtag(body);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, must-revalidate");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).send();
    return;
  }
  res.status(200).json(body);
};

export const trainingHistoryController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const parsed = trainingHistoryListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const code = firstZodMessage(parsed.error.issues);
      res.status(400).json({ error: code, message: messageFor(code) });
      return;
    }

    const query = parsed.data;
    const userId = (req as AuthRequest).auth.sub;
    const body = await trainingHistoryService.list({
      userId,
      limit: query.limit,
      status: query.status,
      planId: query.planId,
      q: query.q,
      from: query.from,
      to: query.to,
      cursor: decodeCursor(query.cursor),
    });

    sendWithEtag(req, res, body);
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const parsed = trainingHistoryIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      const code = firstZodMessage(parsed.error.issues);
      res.status(400).json({ error: code, message: messageFor(code) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const body = await trainingHistoryService.getById(
      userId,
      parsed.data.sessionId,
    );
    sendWithEtag(req, res, body);
  }),
};

