import type { UserRole } from "@workspace/api-client-react";
import type { AppContext } from "./app-context";

// Default landing route per role. Lives in its own module (not auth.tsx) so
// the auth module only exports React components/hooks — required for Vite
// React Fast Refresh to work; mixing component and non-component exports
// invalidates HMR and produces duplicate React contexts at runtime
// (manifesting as "useAuth must be used within AuthProvider").
export const ROLE_HOMES: Record<UserRole, string> = {
  admin: "/admin",
  coordinator: "/coordinator",
  rider: "/rider",
  restaurant_staff: "/restaurant",
};

// A user can hold several roles at once. Since a session can only land on one
// screen, pick the highest-priority role present within the PWA the user is
// currently in (rider-side: admin > coordinator > rider; restaurant-side:
// restaurant_staff is the only option there). No explicit "acting as" role
// switcher yet — see docs/architecture notes on multi-role accounts.
const HOME_PRIORITY: Record<AppContext, UserRole[]> = {
  rider: ["admin", "coordinator", "rider"],
  restaurant: ["restaurant_staff"],
};

export function getHomeForRoles(roles: UserRole[], ctx: AppContext): string {
  const priority = HOME_PRIORITY[ctx];
  const best = priority.find((r) => roles.includes(r)) ?? roles[0];
  return best ? ROLE_HOMES[best] : "/";
}
