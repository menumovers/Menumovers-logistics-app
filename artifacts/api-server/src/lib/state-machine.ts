import { ORDER_STATUSES, type OrderStatus } from "@workspace/db";

/**
 * Order status is a **report**, not a gate.
 *
 * Whoever is present — the rider, the restaurant — says where things stand. A
 * missing report is missing information, not an illegal act: if someone forgets
 * to tap a step, the next step is still accepted, and the audit trail records
 * the jump that actually happened rather than inventing the steps in between.
 * A mistaken report can be corrected the same way.
 *
 * This replaced a strictly linear table that returned 422 on any deviation, so
 * a rider who forgot "en route to restaurant", arrived, and tapped "picked up"
 * was refused while standing outside the restaurant.
 *
 * **"Not a gate" is not "no validation."** Four rules remain, because each is
 * an invariant about data consistency rather than a rule about workflow order:
 *
 *  1. `pending` and `rider_assigned` are not settable here. Both are coupled
 *     to `riderId` — `rider_assigned` must be written together with a rider by
 *     `POST /orders/:id/assign`, and `pending` means no rider is attached.
 *     Allowing either as a plain report would let status and `riderId` disagree.
 *  2. `delivered` and `failed` are terminal. Leaving them is not a side effect
 *     of a stray tap. `delivered → failed` stays permitted — a delivery can be
 *     discovered to have failed after the fact — but nothing else leaves.
 *  3. No same-state transition. A report that changes nothing is not a report,
 *     and the route's atomic guard depends on the status actually moving.
 *  4. `rider_accepted` is reportable only from `rider_assigned`. A coordinator
 *     assigns a rider (`rider_assigned`); the rider then accepts. That accept
 *     is otherwise a plain report like any other, but it must not be reachable
 *     by report-skipping from `pending` or anywhere else — the only other path
 *     to `rider_accepted` is atomically together with `riderId`, via
 *     `POST /orders/:id/assign` (rider self-claim, which bypasses this
 *     function entirely). Without this rule a bare status report could set
 *     `rider_accepted` on an order with no rider attached.
 *
 * Everything else — forward, skipping ahead, or back to correct a mis-tap — is
 * accepted. See docs/workflow-decisions.md D1.
 */

/** Coupled to `riderId`, so never settable as a bare status report. */
const RIDER_COUPLED: ReadonlyArray<OrderStatus> = ["pending", "rider_assigned"];

/** Once here, an order does not casually leave. */
const TERMINAL: ReadonlyArray<OrderStatus> = ["delivered", "failed"];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.includes(status);
}

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  // Rule 3 — a report must actually move the order.
  if (from === to) return false;
  // Rule 1 — riderId-coupled statuses are written by /assign, not reported.
  if (RIDER_COUPLED.includes(to)) return false;
  // Rule 4 — rider_accepted is a report, but only from rider_assigned.
  if (to === "rider_accepted") return from === "rider_assigned";
  // Rule 2 — terminals are sticky; only delivered → failed leaves.
  if (from === "failed") return false;
  if (from === "delivered") return to === "failed";
  return true;
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

/**
 * Every status reportable from `from`, derived from the rules above rather than
 * from a table. Serialized onto each order so clients render the real options
 * instead of keeping their own copy of the transition rules — which is how the
 * machine came to exist in three places that disagreed.
 */
export function nextStatusesFor(from: OrderStatus): ReadonlyArray<OrderStatus> {
  return ORDER_STATUSES.filter((to) => isValidTransition(from, to));
}
