import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';

/** An error with an HTTP status; the message is sent to the client. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'Bad Request') => new HttpError(400, message);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not Found') => new HttpError(404, message);
export const conflict = (message = 'Conflict') => new HttpError(409, message);

function errorResponse(status: number, message: string | string[]) {
  return Response.json({ statusCode: status, message }, { status });
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) return errorResponse(err.status, err.message);
  if (err instanceof ZodError) {
    return errorResponse(
      400,
      err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
    );
  }
  if (err instanceof SyntaxError) return errorResponse(400, 'Invalid JSON body');
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return errorResponse(404, 'Not Found');
    if (err.code === 'P2002') return errorResponse(409, 'ข้อมูลนี้มีอยู่แล้ว');
  }
  console.error('[http] unhandled error', err);
  return errorResponse(500, 'Internal server error');
}

type Params = Record<string, string>;

/**
 * Wraps a route handler: awaits the dynamic params, serializes the result as JSON
 * (201 for POST, like the previous NestJS API), and maps errors to `{ statusCode, message }`.
 */
export function route<P extends Params = Params>(fn: (req: Request, params: P) => unknown) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const result = await fn(req, ((await ctx?.params) ?? {}) as P);
      if (result instanceof Response) return result;
      const status = req.method === 'POST' ? 201 : 200;
      return result === undefined ? new Response(null, { status }) : Response.json(result, { status });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Parse and validate a JSON body; unknown keys are stripped. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.text();
  return schema.parse(raw ? JSON.parse(raw) : {});
}

export function searchParams(req: Request) {
  return new URL(req.url).searchParams;
}
