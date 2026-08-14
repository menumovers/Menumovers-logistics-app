import type { PickupTimeSource } from "@workspace/db";

const MINUTE_MS = 60_000;

export type OriginalPickupTimeInputs = {
  /** `asap` | `later_today` | `other_day`. Anything else is treated as scheduled. */
  deliveryTimeType: string;
  /** When the customer expects delivery. Always present in the inbound payload. */
  requestedDeliveryTime: Date;
  /** A pickup time supplied by the source outright. Wins when present. */
  sourceRestaurantReadyTime: Date | null;
  /** Per-order estimates from the payload; either or both may be absent. */
  restaurantMinDeliveryTime: number | null;
  deliveryTeamMinDeliveryTime: number | null;
  /** `restaurants.minDeliveryTime` — the per-restaurant default. */
  restaurantDefaultMinDeliveryTime: number;
  /** Global admin override. Wins outright over every per-order figure. */
  travelOverrideMinutes: number | null;
  now: Date;
};

export type OriginalPickupTime = {
  pickupTimeOriginal: Date;
  /** The travel figure used, in minutes. Surfaced for logging and debugging. */
  travelMinutes: number;
  /** Which branch produced the result. */
  basis: "source" | "asap" | "scheduled";
};

/**
 * Minutes between leaving the restaurant and reaching the customer.
 *
 * Priority: global admin override → the longest of the two per-order
 * estimates → the restaurant's default. The override wins outright rather
 * than acting as a fallback, so an operator can correct bad upstream figures
 * without waiting on the source to fix them.
 *
 * See docs/workflow-decisions.md D4.
 */
export function resolveTravelMinutes(
  inputs: Pick<
    OriginalPickupTimeInputs,
    | "restaurantMinDeliveryTime"
    | "deliveryTeamMinDeliveryTime"
    | "restaurantDefaultMinDeliveryTime"
    | "travelOverrideMinutes"
  >,
): number {
  if (inputs.travelOverrideMinutes !== null) return inputs.travelOverrideMinutes;
  const estimates = [
    inputs.restaurantMinDeliveryTime,
    inputs.deliveryTeamMinDeliveryTime,
  ].filter((n): n is number => typeof n === "number");
  if (estimates.length > 0) return Math.max(...estimates);
  return inputs.restaurantDefaultMinDeliveryTime;
}

/**
 * Compute `pickup_time_original` at ingestion. IMMUTABLE afterwards — this is
 * only ever called on insert, never on replay.
 *
 * `now + travel` is correct for an ASAP order and wrong for a scheduled one:
 * an order placed at noon for 19:00 would otherwise get a 12:30 pickup time
 * and read as overdue for seven hours. Scheduled orders work backwards from
 * the time the customer was actually promised.
 *
 * Deliberately not clamped to the kitchen's prep time. Bestellenbij already
 * factors prep into the slots it offers customers, so a pickup time earlier
 * than the food can exist means our figures and the storefront's disagree —
 * which is worth surfacing, not smoothing over. See docs/workflow-decisions.md D4.
 */
export function resolveOriginalPickupTime(
  inputs: OriginalPickupTimeInputs,
): OriginalPickupTime {
  const travelMinutes = resolveTravelMinutes(inputs);

  if (inputs.sourceRestaurantReadyTime) {
    return {
      pickupTimeOriginal: inputs.sourceRestaurantReadyTime,
      travelMinutes,
      basis: "source",
    };
  }

  if (inputs.deliveryTimeType === "asap") {
    return {
      pickupTimeOriginal: new Date(inputs.now.getTime() + travelMinutes * MINUTE_MS),
      travelMinutes,
      basis: "asap",
    };
  }

  return {
    pickupTimeOriginal: new Date(
      inputs.requestedDeliveryTime.getTime() - travelMinutes * MINUTE_MS,
    ),
    travelMinutes,
    basis: "scheduled",
  };
}

export type PickupTimeInputs = {
  pickupTimeOriginal: Date;
  pickupTimeRider: Date | null;
  pickupTimeRestaurant: Date | null;
  pickupTimeOverride: Date | null;
};

export type EffectivePickupTime = {
  effectivePickupTime: Date;
  effectivePickupSource: PickupTimeSource | undefined;
};

/**
 * Priority: coordinator/admin override → restaurant → rider → original.
 * The "source" is undefined when no override is present (i.e., using the
 * upstream-calculated original time).
 */
export function resolveEffectivePickupTime(
  inputs: PickupTimeInputs,
): EffectivePickupTime {
  if (inputs.pickupTimeOverride) {
    return {
      effectivePickupTime: inputs.pickupTimeOverride,
      effectivePickupSource: "override",
    };
  }
  if (inputs.pickupTimeRestaurant) {
    return {
      effectivePickupTime: inputs.pickupTimeRestaurant,
      effectivePickupSource: "restaurant",
    };
  }
  if (inputs.pickupTimeRider) {
    return {
      effectivePickupTime: inputs.pickupTimeRider,
      effectivePickupSource: "rider",
    };
  }
  return {
    effectivePickupTime: inputs.pickupTimeOriginal,
    effectivePickupSource: undefined,
  };
}
