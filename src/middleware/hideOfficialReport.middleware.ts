import type { NextFunction, Request, Response } from 'express';

/**
 * N-R7-S53 (Step 2 Batch 14, SCR-M-228) · the official's match report (cautions,
 * sendings-off, incidents) is for the match's officials, scorer and organiser: they
 * read it through GET /matches/:id/assistants, which checks who is asking. The match
 * payloads (GET /matches, /matches/:id, /matches/history, /matches/next) select the
 * whole row, so `official_report` (its text and author id) went to every signed-in
 * user. This drops it from the `match` / `matches` objects of every response on the
 * matches router (top level only, so it costs nothing).
 */
export function hideOfficialReport(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === 'object') {
      const b = body as { match?: unknown; matches?: unknown };
      const strip = (m: unknown) => {
        if (m && typeof m === 'object' && 'official_report' in m) delete (m as { official_report?: unknown }).official_report;
      };
      strip(b.match);
      if (Array.isArray(b.matches)) b.matches.forEach(strip);
    }
    return json(body);
  }) as Response['json'];
  next();
}
