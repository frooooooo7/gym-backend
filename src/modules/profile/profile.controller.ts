import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { profileService } from "./profile.service.js";

export const profileController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getOwnProfile(userId);
    res.status(200).json(profile);
  }),

  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.updateBio(userId, req.body.bio);
    res.status(200).json(profile);
  }),

  getUserProfile: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getUserProfile(
      viewerId,
      req.params.userId,
    );
    res.status(200).json(profile);
  }),

  getFollowing: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getFollowing(
      userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  getFollowers: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getFollowers(
      userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  getActivities: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getRecentActivities(
      userId,
      query.limit,
    );
    res.status(200).json(items);
  }),

  getUserActivities: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getUserActivities(
      viewerId,
      req.params.userId,
      query.limit,
    );
    res.status(200).json(items);
  }),

  searchUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as any;
    const viewerId = (req as AuthRequest).auth.sub;
    const items = await profileService.searchUsers(
      viewerId,
      query.q,
      query.limit,
    );
    res.status(200).json(items);
  }),
};

