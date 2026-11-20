import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async Express 4 route handler so rejected promises forward cleanly to error middleware. */
export function asyncHandler<P = Record<string, string>>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
