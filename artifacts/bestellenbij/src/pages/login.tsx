import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth, ROLE_HOMES } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitch } from "@/components/locale-switch";
import { Spinner } from "@/components/ui/spinner";
import { motion } from "framer-motion";

const DEMO = [
  { roleKey: "admin", email: "admin@bestellenbij.nl" },
  { roleKey: "coordinator", email: "coordinator@bestellenbij.nl" },
  { roleKey: "rider", email: "rider1@bestellenbij.nl" },
] as const;

export default function LoginPage() {
  const { t } = useTranslation();
  const { applyToken } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate(
      { data: { email, password } },
      {
        onSuccess: async (session) => {
          await applyToken(session.token);
          navigate(ROLE_HOMES[session.user.role]);
        },
        onError: () => setError(t("login.invalid")),
      },
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-60" aria-hidden>
        <div className="absolute -top-32 -left-32 size-[420px] rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[480px] rounded-full bg-accent/30 blur-3xl" />
      </div>
      <div className="flex justify-end p-4">
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
            <div className="mx-auto mb-4 size-12 rounded-xl bg-primary text-primary-foreground grid place-items-center text-lg font-bold shadow-lg shadow-primary/30">
              BB
            </div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-login-heading">
              {t("login.heading")}
            </h1>
            <p className="mt-1 text-muted-foreground">{t("login.sub")}</p>
          </div>
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-border bg-card p-6 shadow-xl shadow-primary/5 space-y-4"
            data-testid="form-login"
          >
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
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
          <div className="mt-6 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium">{t("login.demo")}</span>
              <span className="text-xs text-muted-foreground">{t("login.demoHint")}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO.map((d) => (
                <button
                  type="button"
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("password");
                  }}
                  className="rounded-md border border-border bg-background hover:bg-muted px-3 py-2 text-xs text-left transition-colors"
                  data-testid={`button-demo-${d.roleKey}`}
                >
                  <div className="font-medium">{t(`roles.${d.roleKey}`)}</div>
                  <div className="text-muted-foreground truncate">{d.email}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("login.footer")}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
