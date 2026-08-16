import type { PickupTimeSource } from "@workspace/db";

const MINUTE_MS = 60_000;

/**
 * How long before the delivery time we want a rider at the restaurant.
 *
 * **Not travel time.** Nothing measures how long the journey takes; this is a
 * chosen gap, which is why it is an "offset" — it says where pickup sits
 * relative to delivery and makes no claim about what fills the space.
 */
export const DEFAULT_PICKUP_OFFSET_MINUTES = 20;

export type OriginalPickupTimeInputs = {
  /** `asap` | `later_today` | `other_day`. Anything else is treated as scheduled. */
  deliveryTimeType: string;
  /** When checkout completed at the source. */
  sourceCreatedAt: Date;
  /**
   * The delivery time shown to the customer at checkout — despite the name,
   * nothing is "requested" on an ASAP order. Bestellenbij computes it with the
   * restaurant's opening hours, prep times and its own estimates already
   * applied, which is exactly why we anchor to it: recomputing from checkout
   * would redo their work with less information than they had.
   */
  requestedDeliveryTime: Date;
  /** Admin setting: the standing gap between pickup and delivery. */
  pickupOffsetMinutes: number;
  /**
   * Admin setting: the minimum time the delivery team needs, from checkout,
   * before they can collect at all. Set by a coordinator for today's
   * conditions and cleared at 03:00 Europe/Amsterdam.
   *
   * PROVISIONAL — currently applied as a floor (see below), which is known to
   * be only half of what it should do. The owner requires it to work in both
   * directions: when things are quiet a coordinator should be able to pull a
   * pickup *earlier*, not merely stop delaying it. Finishing that needs a lower
   * bound so "sooner" cannot land before the food exists, and we do not have
   * opening hours. See docs/workflow-decisions.md D13, "OPEN".
   *
   * ASAP only.
   */
  minimumTodayMinutes: number | null;
};

export type OriginalPickupTime = {
  pickupTimeOriginal: Date;
  /** The offset applied, in minutes. Surfaced for logging. */
  offsetMinutes: number;
  /** Which branch produced the result, and whether the floor bound. */
  basis: "asap" | "scheduled";
  /** True when today's minimum pushed the pickup later than the offset alone would. */
  minimumApplied: boolean;
};

/**
 * Where pickup sits when nothing else intervenes: a fixed gap before the
 * delivery time the customer was shown.
 */
export function defaultPickupTime(
  inputs: Pick<OriginalPickupTimeInputs, "requestedDeliveryTime" | "pickupOffsetMinutes">,
): Date {
  return new Date(
    inputs.requestedDeliveryTime.getTime() - inputs.pickupOffsetMinutes * MINUTE_MS,
  );
}

/**
 * Compute `pickup_time_original` at ingestion. IMMUTABLE afterwards — only ever
 * called on insert, never on replay.
 *
 * **Nothing here reads the clock**, and everything anchors to
 * `requestedDeliveryTime`. That timestamp already carries the restaurant's
 * opening hours and prep time, because the source applied them when it told the
 * customer when to expect delivery. Counting forward from checkout instead —
 * which an earlier version of this did — reconstructs that calculation without
 * the opening hours, and gets it wrong every time a restaurant is closed at the
 * moment someone orders.
 *
 * For an ASAP order, today's minimum currently acts as a floor: if the delivery
 * team cannot collect for 45 minutes, a pickup time 20 minutes before delivery
 * is a fiction, so `MAX` keeps whichever is later. **This is provisional** — it
 * cannot express the quiet case, where a coordinator wants to pull a pickup
 * earlier. D13 "OPEN" has the unresolved part. It is deliberately not applied
 * to scheduled orders — today's conditions say nothing about next Tuesday.
 *
 * Deliberately not clamped otherwise. An order that arrives too late to fulfil
 * is a fact about what happened upstream, not something for us to repair;
 * Bestellenbij owns feasibility. We surface the lead time and let a coordinator
 * go and ask. See docs/workflow-decisions.md D13.
 */
export function resolveOriginalPickupTime(
  inputs: OriginalPickupTimeInputs,
): OriginalPickupTime {
  const fromOffset = defaultPickupTime(inputs);
  const isAsap = inputs.deliveryTimeType === "asap";

  if (isAsap && inputs.minimumTodayMinutes !== null) {
    const floor = new Date(
      inputs.sourceCreatedAt.getTime() + inputs.minimumTodayMinutes * MINUTE_MS,
    );
    if (floor.getTime() > fromOffset.getTime()) {
      return {
        pickupTimeOriginal: floor,
        offsetMinutes: inputs.pickupOffsetMinutes,
        basis: "asap",
        minimumApplied: true,
      };
    }
  }

  return {
    pickupTimeOriginal: fromOffset,
    offsetMinutes: inputs.pickupOffsetMinutes,
    basis: isAsap ? "asap" : "scheduled",
    minimumApplied: false,
  };
}

/**
 * How long the customer gave us: checkout to the delivery time they were shown.
 *
 * Pure observation — no estimate, no assumption, entirely source data. A short
 * lead time means something happened upstream that a coordinator may want to
 * look into. It is not a gate and nothing acts on it.
 */
export function leadTimeMinutes(inputs: {
  sourceCreatedAt: Date;
  requestedDeliveryTime: Date;
}): number {
  return Math.round(
    (inputs.requestedDeliveryTime.getTime() - inputs.sourceCreatedAt.getTime()) /
      MINUTE_MS,
  );
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
