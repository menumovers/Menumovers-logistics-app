import type { TripListItem } from "@workspace/api-client-react";

/**
 * Trip progress is derived server-side from order statuses (D6) — the client
 * only decides how to phrase it. Kept here so the coordinator and rider views
 * cannot drift into describing the same trip differently.
 */
export type TripProgress = {
  total: number;
  /** Stops the order reports as completed. */
  done: number;
  /** Stops on a failed order — settled without being completed. */
  skipped: number;
  /** Still to do. */
  outstanding: number;
  /** How far through the trip is, counting skipped stops as behind you. */
  pct: number;
};

export function tripProgress(
  trip: Pick<TripListItem, "stopCount" | "doneStopCount" | "skippedStopCount">,
): TripProgress {
  const total = trip.stopCount;
  const done = trip.doneStopCount;
  const skipped = trip.skippedStopCount;
  const settled = done + skipped;
  return {
    total,
    done,
    skipped,
    outstanding: Math.max(total - settled, 0),
    pct: total > 0 ? Math.round((settled / total) * 100) : 0,
  };
}
