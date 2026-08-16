import type { PickupTimeSource } from "@workspace/db";

const MINUTE_MS = 60_000;

/**
 * How long before pickup an order needs, in minutes, when the payload gives us
 * nothing usable and for every scheduled order. Ours, not the source's — see
 * the note on `scheduledEstimateMinutes` below.
 */
export const DEFAULT_PICKUP_ESTIMATE_MINUTES = 20;

export type OriginalPickupTimeInputs = {
  /** `asap` | `later_today` | `other_day`. Anything else is treated as scheduled. */
  deliveryTimeType: string;
  /** When checkout completed at the source. The ASAP anchor. */
  sourceCreatedAt: Date;
  /** The customer's checkout selection, parsed to a timestamp. */
  requestedDeliveryTime: Date;
  /**
   * Minimum lead time either party needs, in minutes from checkout. Nullable;
   * the larger of the two binds, because it is whichever party needs longer
   * that decides when the order can actually be collected.
   */
  restaurantMinPickupTime: number | null;
  deliveryTeamMinPickupTime: number | null;
  /** Admin setting: our baseline estimate. Used for every scheduled order. */
  defaultEstimateMinutes: number;
  /**
   * Admin setting: today's conditions, set by a coordinator in absolute terms
   * ("we need 45 minutes today"), not as an adjustment. ASAP only — how busy we
   * are right now says nothing about an order scheduled for next Tuesday.
   * Cleared each day at 03:00 Europe/Amsterdam.
   */
  inTheMomentMinutes: number | null;
};

export type OriginalPickupTime = {
  pickupTimeOriginal: Date;
  /** Minutes used, and where they came from. Surfaced for logging. */
  estimateMinutes: number;
  estimateSource: "in_the_moment" | "source_min_pickup" | "default";
  /** Which branch produced the result. */
  basis: "asap" | "scheduled";
};

/**
 * The lead time an ASAP order needs, in minutes from checkout.
 *
 * `inTheMoment` replaces rather than adjusts: a coordinator thinks "we need 45
 * minutes today", not "+15 on whatever the restaurant said". Absolute also
 * handles both directions without a sign.
 *
 * Otherwise the source's own figure, taking the larger of the restaurant's and
 * the delivery team's — whichever party needs longer is the one that binds.
 * The default only catches the case where the payload supplied neither.
 */
export function resolveAsapLeadMinutes(
  inputs: Pick<
    OriginalPickupTimeInputs,
    | "restaurantMinPickupTime"
    | "deliveryTeamMinPickupTime"
    | "defaultEstimateMinutes"
    | "inTheMomentMinutes"
  >,
): { minutes: number; source: OriginalPickupTime["estimateSource"] } {
  if (inputs.inTheMomentMinutes !== null) {
    return { minutes: inputs.inTheMomentMinutes, source: "in_the_moment" };
  }
  const supplied = [
    inputs.restaurantMinPickupTime,
    inputs.deliveryTeamMinPickupTime,
  ].filter((n): n is number => typeof n === "number");
  if (supplied.length > 0) {
    return { minutes: Math.max(...supplied), source: "source_min_pickup" };
  }
  return { minutes: inputs.defaultEstimateMinutes, source: "default" };
}

/**
 * Minutes between the requested delivery time and when a rider should collect,
 * for a scheduled order.
 *
 * **This is ours, and it is an estimate.** The payload has no trustworthy
 * travel figure: `*MinDeliveryTime` is checkout-to-doorstep — the whole journey
 * including prep, and a rough coordinator-set number that often sits stale — so
 * deriving travel from it would produce a figure with a false pedigree.
 *
 * `inTheMoment` deliberately does not apply here. It describes conditions right
 * now, and a scheduled order is not happening now.
 */
export function resolveScheduledEstimateMinutes(
  inputs: Pick<OriginalPickupTimeInputs, "defaultEstimateMinutes">,
): number {
  return inputs.defaultEstimateMinutes;
}

/**
 * Compute `pickup_time_original` at ingestion. IMMUTABLE afterwards — only ever
 * called on insert, never on replay.
 *
 * **Nothing here reads the clock.** An ASAP pickup time counts forward from
 * `sourceCreatedAt`, the moment checkout completed, not from when our API
 * happened to process the request — so an ingestion delay no longer pushes the
 * pickup time later. That was the original question behind this whole audit.
 *
 * `sourceRestaurantReadyTime` is deliberately *not* an input. The source
 * calculates it only for ASAP orders, so depending on it would mean two code
 * paths where one will do, and we can compute the same thing ourselves. It is
 * retained on the order as a cross-check: if it and our ASAP figure disagree,
 * that is worth seeing.
 *
 * Deliberately not clamped. An order that arrives too late to fulfil is a fact
 * about what happened upstream, not something for us to repair — Bestellenbij
 * owns feasibility. We surface the lead time and let a coordinator go and ask.
 * See docs/workflow-decisions.md D4 and D13.
 */
export function resolveOriginalPickupTime(
  inputs: OriginalPickupTimeInputs,
): OriginalPickupTime {
  if (inputs.deliveryTimeType === "asap") {
    const { minutes, source } = resolveAsapLeadMinutes(inputs);
    return {
      pickupTimeOriginal: new Date(
        inputs.sourceCreatedAt.getTime() + minutes * MINUTE_MS,
      ),
      estimateMinutes: minutes,
      estimateSource: source,
      basis: "asap",
    };
  }

  const minutes = resolveScheduledEstimateMinutes(inputs);
  return {
    pickupTimeOriginal: new Date(
      inputs.requestedDeliveryTime.getTime() - minutes * MINUTE_MS,
    ),
    estimateMinutes: minutes,
    estimateSource: "default",
    basis: "scheduled",
  };
}

/**
 * How long the customer gave us: checkout to requested delivery.
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
