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
import { Spinner } from "@/components/ui/spinner";

type AuthContextValue = {
  user: CurrentUser | null;
  isLoading: boolean;
  signOut: () => void;
  applyToken: (token: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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
    navigate("/login");
  }, [queryClient, navigate]);

  const applyToken = useCallback(
    async (token: string) => {
      setToken(token);
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
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

export const ROLE_HOMES: Record<UserRole, string> = {
  admin: "/admin",
  coordinator: "/coordinator",
  rider: "/rider",
  restaurant_staff: "/restaurant",
};

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
      navigate("/login");
      return;
    }
    if (!roles.includes(user.role)) {
      navigate(ROLE_HOMES[user.role]);
    }
  }, [isLoading, user, roles, navigate]);

  if (isLoading || !user || !roles.includes(user.role)) {
    return <FullScreenLoader />;
  }
  return <>{children}</>;
}
