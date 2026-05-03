import type { PickupTimeSource } from "@workspace/db";

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
