/**
 * SC-433 · call an Express controller from inside another one.
 *
 * Used for exactly one thing: applying a scorer's signed RESULT op through
 * `completeMatch` rather than through a second copy of it.
 *
 * `completeMatch` is ~585 lines — bracket advance, ELO and record deltas,
 * champion crowning, walkovers, draws, lease and authority guards, the SC-253
 * compare-and-set that makes the champion notification fire exactly once. A
 * parallel implementation for the handoff path would drift from it, and the
 * thing it would drift on is who won a tournament. So the handoff path calls the
 * real one.
 *
 * This is a deliberate, narrow seam and not a general pattern: the controller is
 * a plain function of (req, res), and everything below is the smallest shape it
 * actually reads — `userId`, `params`, `body`, and headers via `deviceIdOf`.
 * Nothing streams, nothing sets cookies, nothing touches the socket.
 */
import type { Request, Response } from 'express';

export interface InvokeResult<T = unknown> {
  status: number;
  body: T;
}

export async function invokeController<T = unknown>(
  controller: (req: Request, res: Response) => unknown,
  args: {
    userId: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<InvokeResult<T>> {
  const headers = args.headers ?? {};
  const req = {
    userId: args.userId,
    params: args.params ?? {},
    body: args.body ?? {},
    headers,
    // `deviceIdOf` and friends read headers case-insensitively through `get`.
    get: (name: string) => headers[name] ?? headers[name.toLowerCase()],
    header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
  } as unknown as Request;

  let status = 200;
  let body: unknown;
  let settled = false;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; settled = true; return this; },
    send(payload: unknown) { body = payload; settled = true; return this; },
  } as unknown as Response;

  await controller(req, res);
  // A controller that returned without answering is a bug in the controller, not
  // something to paper over with a default — say so loudly.
  if (!settled) throw new Error('invokeController: controller produced no response');
  return { status, body: body as T };
}
