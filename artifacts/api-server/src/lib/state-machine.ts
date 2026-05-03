import type { OrderStatus } from "@workspace/db";

const TRANSITIONS: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  pending: ["driver_assigned", "failed"],
  driver_assigned: ["en_route_to_restaurant", "failed"],
  en_route_to_restaurant: ["picked_up", "failed"],
  picked_up: ["en_route_to_customer", "failed"],
  en_route_to_customer: ["delivered", "failed"],
  delivered: [],
  failed: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
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
  return TRANSITIONS[from] ?? [];
}
