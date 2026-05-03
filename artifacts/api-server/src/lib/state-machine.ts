import type { OrderStatus } from "@workspace/db";

const PIPELINE_TRANSITIONS: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  pending: ["driver_assigned"],
  driver_assigned: ["en_route_to_restaurant", "postponed"],
  en_route_to_restaurant: ["picked_up", "postponed"],
  picked_up: ["en_route_to_customer"],
  en_route_to_customer: ["delivered", "postponed"],
  delivered: [],
  failed: [],
  // From postponed, the rider may resume to either in-flight phase, or fail.
  // Which leg is appropriate depends on what came before; the API trusts the
  // rider/UI here.
  postponed: ["en_route_to_restaurant", "en_route_to_customer"],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  // Failure terminal: reachable from any non-failed state (incl. delivered).
  if (to === "failed") return from !== "failed";
  return PIPELINE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isValidTransition(from, to)) {
    const err = new Error(
      `Invalid status transition: ${from} -> ${to}`,
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 422;
    err.code = "INVALID_TRANSITION";
    throw err;
  }
}

export function nextStatusesFor(from: OrderStatus): ReadonlyArray<OrderStatus> {
  const pipeline = PIPELINE_TRANSITIONS[from] ?? [];
  if (from === "failed") return pipeline;
  return [...pipeline, "failed" as OrderStatus];
}
