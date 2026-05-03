import type { UserRole } from "@workspace/api-client-react";

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
