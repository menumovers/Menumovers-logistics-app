import type { PickupTimeSource } from "@workspace/db";

const MINUTE_MS = 60_000;

/**
 * The standing gap between pickup and the delivery time the customer was shown.
 *
 * **Not travel time.** Nothing measures the journey; this is a chosen offset. It
 * says where pickup sits relative to delivery and makes no claim about what
 * fills the space.
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
   * restaurant's opening hours and prep times already applied, which is why we
   * anchor to it: recomputing from checkout would redo their work with less
   * information than they had.
   */
  requestedDeliveryTime: Date;
  /**
   * Admin setting: the standing gap, counted **backwards from the delivery
   * time**.
   */
  pickupOffsetMinutes: number;
  /**
   * Admin setting: how quickly the delivery team can collect right now,
   * counted **forwards from the order arriving** — "it's quiet, we can be
   * there in ten".
   *
   * A different quantity from `pickupOffsetMinutes`, with a different anchor,
   * so the two never combine: when this is set it simply *is* the answer for an
   * ASAP order. Both directions fall out with no comparison — a small value
   * moves pickup earlier (rider moving, not sitting idle), a large one moves it
   * later (swamped, cannot get there yet).
   *
   * ASAP only: "we can be there in ten" says nothing about an order placed
   * today for next Tuesday. Cleared at 03:00 Europe/Amsterdam.
   */
  pickupWithinMinutes: number | null;
};

export type OriginalPickupTime = {
  pickupTimeOriginal: Date;
  /** Which rule produced the result. */
  basis: "within" | "offset";
  /** The minutes used, and which anchor they were counted from. */
  minutes: number;
  anchor: "order_arrival" | "delivery_time";
};

/**
 * Compute `pickup_time_original` at ingestion. IMMUTABLE afterwards — only ever
 * called on insert, never on replay.
 *
 * **Nothing here reads the clock.** The default rule anchors to
 * `requestedDeliveryTime`, which already carries the restaurant's opening hours
 * and prep time because the source applied them before telling the customer
 * when to expect delivery. Counting forward from checkout instead — which an
 * earlier version did — reconstructs that calculation without the opening
 * hours, and gets it wrong every time someone orders while a kitchen is shut.
 *
 * `pickupWithinMinutes` overrides that for ASAP orders because it is a person
 * saying what is true right now. It is deliberately **not** clamped: the
 * figures we could clamp against are all guesstimates, and a coordinator
 * setting this can see whether restaurants are open. Feasibility is
 * Bestellenbij's; ours is to show what was decided.
 *
 * See docs/workflow-decisions.md D13.
 */
export function resolveOriginalPickupTime(
  inputs: OriginalPickupTimeInputs,
): OriginalPickupTime {
  if (inputs.deliveryTimeType === "asap" && inputs.pickupWithinMinutes !== null) {
    return {
      pickupTimeOriginal: new Date(
        inputs.sourceCreatedAt.getTime() + inputs.pickupWithinMinutes * MINUTE_MS,
      ),
      basis: "within",
      minutes: inputs.pickupWithinMinutes,
      anchor: "order_arrival",
    };
  }

  return {
    pickupTimeOriginal: new Date(
      inputs.requestedDeliveryTime.getTime() - inputs.pickupOffsetMinutes * MINUTE_MS,
    ),
    basis: "offset",
    minutes: inputs.pickupOffsetMinutes,
    anchor: "delivery_time",
  };
}

/**
 * How long the customer gave us: order arrival to the delivery time they were
 * shown.
 *
 * Pure observation — no estimate, no assumption, entirely source data. A short
 * lead time means something happened upstream that a coordinator may want to
 * look into. It is not a gate and nothing acts on it.
 *
 * This is the only thing called "lead time" here. The phrase can also mean
 * order-to-pickup, which is why nothing else uses it.
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
