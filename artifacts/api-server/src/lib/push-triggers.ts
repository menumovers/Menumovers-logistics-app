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
    case "driver_assigned":
      return audienceForAssignment();
    default:
      return null;
  }
}
