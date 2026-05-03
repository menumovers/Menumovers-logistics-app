import type { OrderStatus, UserRole } from "@workspace/db";

export type PushAudience = {
  roles: ReadonlyArray<UserRole>;
  /** When true, also notify the assigned rider (if any) for this order. */
  notifyAssignedRider?: boolean;
  /** When true, also notify staff of the order's restaurant. */
  notifyOrderRestaurantStaff?: boolean;
};

export function audienceForNewOrder(): PushAudience {
  return {
    roles: ["coordinator", "admin"],
    notifyOrderRestaurantStaff: true,
  };
}

export function audienceForAssignment(): PushAudience {
  return {
    roles: [],
    notifyAssignedRider: true,
    notifyOrderRestaurantStaff: true,
  };
}

export function audienceForStatus(toStatus: OrderStatus): PushAudience | null {
  switch (toStatus) {
    case "picked_up":
    case "delivered":
      return { roles: ["coordinator", "admin"] };
    case "failed":
      return { roles: ["coordinator", "admin"] };
    case "postponed":
      return {
        roles: ["coordinator", "admin"],
        notifyOrderRestaurantStaff: true,
      };
    case "driver_assigned":
      return audienceForAssignment();
    default:
      return null;
  }
}

/**
 * Audience for trip-level events. Coordinators always get notified; the
 * assigned rider gets a personal push when one is assigned.
 */
export function audienceForTripAssigned(): PushAudience {
  return {
    roles: ["coordinator", "admin"],
    notifyAssignedRider: true,
  };
}

export function audienceForTripDissolved(): PushAudience {
  return {
    roles: ["coordinator", "admin"],
    notifyAssignedRider: true,
    notifyOrderRestaurantStaff: true,
  };
}

export function audienceForOpenTrip(): PushAudience {
  // Open (unclaimed) trips are surfaced to coordinators; rider-side discovery
  // is via the regular list (and self-claim flag).
  return { roles: ["coordinator", "admin"] };
}
