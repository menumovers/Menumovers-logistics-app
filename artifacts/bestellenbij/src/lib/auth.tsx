import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  type CurrentUser,
  type UserRole,
} from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { setToken, getToken } from "./api";
import { applyProfileLocale } from "./i18n";
import { getHomeForRoles } from "./role-homes";
import { getContextForPath, getLoginPath } from "./app-context";
import { Spinner } from "@/components/ui/spinner";

type AuthContextValue = {
  user: CurrentUser | null;
  isLoading: boolean;
  signOut: () => void;
  applyToken: (token: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function hasUsableRoles(user: CurrentUser | undefined): user is CurrentUser {
  return Array.isArray(user?.roles) && user.roles.length > 0;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const hasToken = !!getToken();
  const [, navigate] = useLocation();

  const meQuery = useGetCurrentUser({
    query: {
      enabled: hasToken,
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  });

  // Sessions issued before the multi-role migration do not contain `roles`.
  // Treat them as signed out instead of passing an incomplete user into role
  // checks, which would otherwise crash the protected route and landing page.
  useEffect(() => {
    if (meQuery.data && !hasUsableRoles(meQuery.data)) {
      setToken(null);
      queryClient.clear();
    }
  }, [meQuery.data, queryClient]);

  useEffect(() => {
    if (meQuery.isError && (meQuery.error as ApiError | undefined)?.status === 401) {
      setToken(null);
      queryClient.clear();
    }
  }, [meQuery.isError, meQuery.error, queryClient]);

  // Profile-driven locale: when /auth/me returns a preferredLocale, apply it
  // without writing to localStorage (storage stays as the unauthed-default
  // / cross-account fallback). Generated openapi types make preferredLocale
  // optional + nullable, so handle both shapes.
  useEffect(() => {
    const loc = meQuery.data?.preferredLocale;
    if (loc === "nl" || loc === "en") applyProfileLocale(loc);
  }, [meQuery.data?.preferredLocale]);

  const signOut = useCallback(() => {
    setToken(null);
    queryClient.clear();
    // Send the user back to the login page of the app they were using, so
    // each PWA stays self-contained after sign-out (rider PWA → /rider/login,
    // restaurant PWA → /restaurant/login).
    // Settings is shared by both apps and currently lives at /settings, so a
    // restaurant-only account needs its role to disambiguate that route.
    const pathContext = getContextForPath(window.location.pathname);
    const isRestaurantOnly =
      meQuery.data?.roles.length === 1 &&
      meQuery.data.roles[0] === "restaurant_staff";
    const ctx = isRestaurantOnly ? "restaurant" : pathContext;
    navigate(getLoginPath(ctx));
  }, [meQuery.data?.roles, queryClient, navigate]);

  const applyToken = useCallback(
    async (token: string) => {
      setToken(token);
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: hasUsableRoles(meQuery.data) ? meQuery.data : null,
      isLoading: hasToken && meQuery.isLoading,
      signOut,
      applyToken,
    }),
    [meQuery.data, meQuery.isLoading, hasToken, signOut, applyToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function FullScreenLoader() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

export function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[];
  children: ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const ctx = getContextForPath(window.location.pathname);
      navigate(getLoginPath(ctx));
      return;
    }
    if (!roles.some((r) => user.roles.includes(r))) {
      navigate(getHomeForRoles(user.roles, getContextForPath(window.location.pathname)));
    }
  }, [isLoading, user, roles, navigate]);

  if (isLoading || !user || !roles.some((r) => user.roles.includes(r))) {
    return <FullScreenLoader />;
  }
  return <>{children}</>;
}
