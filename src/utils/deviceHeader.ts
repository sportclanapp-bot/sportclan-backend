/**
 * SC-430 · the per-install id a request identifies itself with.
 *
 * Carried as a HEADER rather than in the body so every scoring verb can send it
 * — including `DELETE /matches/:id/events/:eventId`, which has no body at all —
 * without reshaping six request payloads.
 *
 * Absent is fine where nobody holds a lease. Where somebody does, a write with
 * no device id is refused as DEVICE_REQUIRED (see leaseCore.leaseVerdict): it
 * used to pass on identity alone, which let a raw API call write around the
 * phone holding the pad.
 */
import type { Request } from 'express';

export const DEVICE_HEADER = 'x-device-id';

export function deviceIdOf(req: Request): string | null {
  const raw = req.header(DEVICE_HEADER);
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // Bounded: this is echoed back to clients and stored, so a caller does not get
  // to write an essay into the lease row.
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}
