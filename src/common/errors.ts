export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export const isAppError = (err: unknown): err is AppError =>
  err instanceof AppError;
