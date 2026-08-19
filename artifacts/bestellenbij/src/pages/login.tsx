import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { getHomeForRoles } from "@/lib/role-homes";
import {
  type AppContext,
  getAllowedRolesForContext,
  getLoginPath,
} from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitch } from "@/components/locale-switch";
import { Spinner } from "@/components/ui/spinner";
import { motion } from "framer-motion";
import { ArrowLeft, Bike, Store } from "lucide-react";
import { setToken } from "@/lib/api";

const RIDER_DEMO = [
  { roleKey: "admin", username: "admin" },
  { roleKey: "coordinator", username: "coordinator" },
  { roleKey: "rider", username: "rider1" },
] as const;

const RESTAURANT_DEMO = [
  { roleKey: "restaurant_staff", username: "restaurant1" },
] as const;

type Props = { variant: AppContext };

export default function LoginPage({ variant }: Props) {
  const { t } = useTranslation();
  const { applyToken, user, isLoading, signOut } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  // If already signed in with a role that fits this app, go straight to their
  // dashboard. If signed in with a role that does NOT fit (e.g. a rider
  // landed on /restaurant/login), keep them here so they can sign in fresh.
  useEffect(() => {
    if (isLoading || !user) return;
    const allowed = getAllowedRolesForContext(variant);
    if (allowed.some((r) => user.roles.includes(r))) {
      navigate(getHomeForRoles(user.roles, variant));
    }
  }, [user, isLoading, variant, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate(
      { data: { username, password } },
      {
        onSuccess: async (session) => {
          const allowed = getAllowedRolesForContext(variant);
          if (!allowed.some((r) => session.user.roles.includes(r))) {
            // Logged in successfully but with roles that don't fit this app.
            // Discard the token and tell them to use the other app.
            setToken(null);
            setError(t("login.wrongApp"));
            return;
          }
          await applyToken(session.token);
          navigate(getHomeForRoles(session.user.roles, variant));
        },
        onError: () => setError(t("login.invalid")),
      },
    );
  }

  const isRider = variant === "rider";
  const demos = isRider ? RIDER_DEMO : RESTAURANT_DEMO;
  const Icon = isRider ? Bike : Store;
  const otherCtx: AppContext = isRider ? "restaurant" : "rider";
  const otherLabel = isRider
    ? t("login.switchToRestaurant")
    : t("login.switchToRider");

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-60" aria-hidden>
        <div className="absolute -top-32 -left-32 size-[420px] rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[480px] rounded-full bg-accent/30 blur-3xl" />
      </div>
      <div className="flex items-center justify-between p-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-back-to-landing"
        >
          <ArrowLeft className="size-4" />
          {t("login.back")}
        </Link>
        <LocaleSwitch />
      </div>
      <div className="flex-1 grid place-items-center px-4 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 size-12 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-primary/30">
              <Icon className="size-6" />
            </div>
            <h1
              className="text-3xl font-bold tracking-tight"
              data-testid="text-login-heading"
            >
              {isRider ? t("login.riderHeading") : t("login.restaurantHeading")}
            </h1>
            <p className="mt-1 text-muted-foreground">
              {isRider ? t("login.riderSub") : t("login.restaurantSub")}
            </p>
          </div>
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-border bg-card p-6 shadow-xl shadow-primary/5 space-y-4"
            data-testid="form-login"
          >
            <div className="space-y-2">
              <Label htmlFor="username">{t("login.username")}</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" data-testid="text-login-error">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={login.isPending}
              data-testid="button-login-submit"
            >
              {login.isPending ? (
                <>
                  <Spinner className="size-4 mr-2" />
                  {t("login.submitting")}
                </>
              ) : (
                t("login.submit")
              )}
            </Button>
          </form>
          {user && !getAllowedRolesForContext(variant).some((r) => user.roles.includes(r)) ? (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={signOut}
                className="underline-offset-4 hover:underline"
                data-testid="button-sign-out-other"
              >
                {t("login.signOutOther")}
              </button>
            </div>
          ) : null}
          <div className="mt-6 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium">{t("login.demo")}</span>
              <span className="text-xs text-muted-foreground">
                {t("login.demoHint")}
              </span>
            </div>
            <div
              className={
                demos.length > 1
                  ? "grid grid-cols-3 gap-2"
                  : "grid grid-cols-1 gap-2"
              }
            >
              {demos.map((d) => (
                <button
                  type="button"
                  key={d.username}
                  onClick={() => {
                    setUsername(d.username);
                    setPassword("password");
                  }}
                  className="rounded-md border border-border bg-background hover:bg-muted px-3 py-2 text-xs text-left transition-colors"
                  data-testid={`button-demo-${d.roleKey}`}
                >
                  <div className="font-medium">{t(`roles.${d.roleKey}`)}</div>
                  <div className="text-muted-foreground truncate">{d.username}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("login.footer")}
            </p>
          </div>
          <div className="mt-4 text-center">
            <Link
              href={getLoginPath(otherCtx)}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              data-testid="link-other-login"
            >
              {otherLabel}
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
