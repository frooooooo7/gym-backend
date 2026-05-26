import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage } from "../../common/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  profileActivitiesQuerySchema,
  profileListQuerySchema,
  profileUpdateSchema,
  userIdParamsSchema,
  userSearchQuerySchema,
} from "./profile.schemas.js";
import { profileService } from "./profile.service.js";

export const profileController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getOwnProfile(userId);
    res.status(200).json(profile);
  }),

  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.updateBio(userId, parsed.data.bio);
    res.status(200).json(profile);
  }),

  getUserProfile: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = userIdParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({
        error: firstZodMessage(parsedParams.error.issues),
      });
      return;
    }
    const viewerId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getUserProfile(
      viewerId,
      parsedParams.data.userId,
    );
    res.status(200).json(profile);
  }),

  getFollowing: asyncHandler(async (req: Request, res: Response) => {
    const parsed = profileListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const items = await profileService.getFollowing(
      userId,
      parsed.data.limit,
      parsed.data.offset,
    );
    res.status(200).json(items);
  }),

  getFollowers: asyncHandler(async (req: Request, res: Response) => {
    const parsed = profileListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const items = await profileService.getFollowers(
      userId,
      parsed.data.limit,
      parsed.data.offset,
    );
    res.status(200).json(items);
  }),

  getActivities: asyncHandler(async (req: Request, res: Response) => {
    const parsed = profileActivitiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const items = await profileService.getRecentActivities(
      userId,
      parsed.data.limit,
    );
    res.status(200).json(items);
  }),

  searchUsers: asyncHandler(async (req: Request, res: Response) => {
    const parsed = userSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const viewerId = (req as AuthRequest).auth.sub;
    const items = await profileService.searchUsers(
      viewerId,
      parsed.data.q,
      parsed.data.limit,
    );
    res.status(200).json(items);
  }),
};
