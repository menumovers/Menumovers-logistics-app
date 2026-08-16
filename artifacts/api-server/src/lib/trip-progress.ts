import type { OrderStatus, TripStopKind } from "@workspace/db";

/**
 * Trip progress derives entirely from order status (D6).
 *
 * There is no per-stop completion record. `trip_stops.completed_at` existed
 * but nothing ever wrote it, so every trip read 0% forever. Rather than add a
 * second thing riders have to remember to tap, a stop's state is read off the
 * order it belongs to — which the rider is already keeping up to date.
 */
export const TRIP_STOP_STATES = ["upcoming", "done", "skipped"] as const;
export type TripStopState = (typeof TRIP_STOP_STATES)[number];

/** Statuses that can only have been reached by collecting the food. */
const PICKED_UP: ReadonlyArray<OrderStatus> = [
  "picked_up",
  "en_route_to_customer",
  "delivered",
];

/**
 * A failed order settles both of its stops without completing either. The
 * status column is last-write-wins, so once an order reads `failed` we can no
 * longer tell whether the pickup happened before it went wrong — and guessing
 * would be worse than saying "not completed, not outstanding". The status log
 * has the detail if anyone needs it.
 */
export function stopStateFor(
  kind: TripStopKind,
  status: OrderStatus,
): TripStopState {
  if (status === "failed") return "skipped";
  if (kind === "pickup") return PICKED_UP.includes(status) ? "done" : "upcoming";
  return status === "delivered" ? "done" : "upcoming";
}

export type TripProgress = {
  stopCount: number;
  doneStopCount: number;
  skippedStopCount: number;
};

/**
 * Counts stops by derived state. Stops whose order could not be loaded count
 * as outstanding rather than being dropped — an unresolvable stop is a problem
 * to see, not to round away.
 */
export function tripProgress(
  stops: ReadonlyArray<{ orderId: string; kind: TripStopKind }>,
  statusByOrderId: ReadonlyMap<string, OrderStatus>,
): TripProgress {
  let doneStopCount = 0;
  let skippedStopCount = 0;
  for (const stop of stops) {
    const status = statusByOrderId.get(stop.orderId);
    if (!status) continue;
    const state = stopStateFor(stop.kind, status);
    if (state === "done") doneStopCount += 1;
    else if (state === "skipped") skippedStopCount += 1;
  }
  return { stopCount: stops.length, doneStopCount, skippedStopCount };
}
