import type { UserRole } from "@workspace/api-client-react";

// Bestellenbij ships as two installable PWAs from one codebase:
//   - "rider" (internal): admin, coordinator, rider — scope = "/"
//   - "restaurant" (external): restaurant_staff — scope = "/restaurant/"
// `AppContext` is the runtime view of which side the user is on. It drives
// login routing, signOut redirects, and which web app manifest is linked.

export type AppContext = "rider" | "restaurant";

export const RIDER_ROLES: UserRole[] = ["admin", "coordinator", "rider"];
export const RESTAURANT_ROLES: UserRole[] = ["restaurant_staff"];

export function getContextForRole(role: UserRole): AppContext {
  return role === "restaurant_staff" ? "restaurant" : "rider";
}

export function getContextForPath(pathname: string): AppContext {
  // Restaurant scope is the only narrow one; everything else is rider scope.
  return pathname === "/restaurant" || pathname.startsWith("/restaurant/")
    ? "restaurant"
    : "rider";
}

export function getLoginPath(ctx: AppContext): string {
  return ctx === "restaurant" ? "/restaurant/login" : "/rider/login";
}

export function getAllowedRolesForContext(ctx: AppContext): UserRole[] {
  return ctx === "restaurant" ? RESTAURANT_ROLES : RIDER_ROLES;
}
