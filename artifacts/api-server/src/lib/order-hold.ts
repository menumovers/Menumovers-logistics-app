import { sql, type SQL } from "drizzle-orm";
import { ordersTable, type Order, type OrderHoldState } from "@workspace/db";

/**
 * The "on hold" family — the only mechanism that gates an order.
 *
 * Statuses are reports and never block; a hold is a deliberate stop. A hold
 * blocks *new assignment only*: an order already being worked keeps accepting
 * status reports, so a coordinator can never freeze a rider mid-delivery.
 *
 * See docs/workflow-decisions.md D2.
 */

/**
 * Resolve an order's hold state, falling back to the deprecated `isParked`
 * flag for rows written before the hold family existed.
 *
 * This fallback is the *only* place `isParked` should be read. It exists so
 * behaviour is correct both before and after the backfill runs, rather than
 * making the backfill a correctness prerequisite. Remove it — and the column —
 * once the backfill is confirmed; see docs/environment-checklist.md.
 */
export function effectiveHoldState(
  order: Pick<Order, "holdState" | "isParked">,
): OrderHoldState | null {
  if (order.holdState) return order.holdState;
  return order.isParked ? "parked" : null;
}

export function effectiveHoldReason(
  order: Pick<Order, "holdState" | "holdReason" | "isParked" | "parkedReason">,
): string | null {
  if (order.holdState) return order.holdReason;
  return order.isParked ? order.parkedReason : null;
}

export function isHeld(order: Pick<Order, "holdState" | "isParked">): boolean {
  return effectiveHoldState(order) !== null;
}

/**
 * SQL predicate matching orders that are NOT held, including the legacy
 * `isParked` fallback. Used to keep held work out of rider discovery at the
 * query level rather than filtering in application code.
 */
export function notHeld(): SQL {
  return sql`${ordersTable.holdState} IS NULL AND ${ordersTable.isParked} = false`;
}
