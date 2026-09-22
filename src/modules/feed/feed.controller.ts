import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import type {
  CommentsQuery,
  CreateCommentBody,
  FeedQuery,
  KudosListQuery,
  SuggestedUsersQuery,
  UserPostsQuery,
} from "./feed.schemas.js";
import { feedService } from "./feed.service.js";

const viewerIdOf = (req: Request): string => (req as AuthRequest).auth.sub;

export const feedController = {
  getFeed: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as FeedQuery;
    const body = await feedService.getFeed(
      viewerIdOf(req),
      query.limit,
      query.cursor,
    );
    res.status(200).json(body);
  }),

  getUserPosts: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as UserPostsQuery;
    const body = await feedService.getUserPosts(
      viewerIdOf(req),
      req.params.userId,
      query.limit,
      query.cursor,
    );
    res.status(200).json(body);
  }),

  getPost: asyncHandler(async (req: Request, res: Response) => {
    const body = await feedService.getPost(viewerIdOf(req), req.params.sessionId);
    res.status(200).json(body);
  }),

  giveKudo: asyncHandler(async (req: Request, res: Response) => {
    const body = await feedService.giveKudo(
      viewerIdOf(req),
      req.params.sessionId,
    );
    res.status(200).json(body);
  }),

  removeKudo: asyncHandler(async (req: Request, res: Response) => {
    const body = await feedService.removeKudo(
      viewerIdOf(req),
      req.params.sessionId,
    );
    res.status(200).json(body);
  }),

  listKudos: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as KudosListQuery;
    const body = await feedService.listKudos(
      viewerIdOf(req),
      req.params.sessionId,
      query.limit,
      query.offset,
    );
    res.status(200).json(body);
  }),

  listComments: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as CommentsQuery;
    const body = await feedService.listComments(
      viewerIdOf(req),
      req.params.sessionId,
      query.limit,
      query.cursor,
    );
    res.status(200).json(body);
  }),

  addComment: asyncHandler(async (req: Request, res: Response) => {
    const { body } = req.body as CreateCommentBody;
    const comment = await feedService.addComment(
      viewerIdOf(req),
      req.params.sessionId,
      body,
    );
    res.status(201).json(comment);
  }),

  deleteComment: asyncHandler(async (req: Request, res: Response) => {
    await feedService.deleteComment(
      viewerIdOf(req),
      req.params.sessionId,
      req.params.commentId,
    );
    res.status(204).send();
  }),

  getSuggestedUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as SuggestedUsersQuery;
    const body = await feedService.getSuggestedUsers(
      viewerIdOf(req),
      query.limit,
    );
    res.status(200).json(body);
  }),
};
