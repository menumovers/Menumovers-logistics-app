import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Bike, Store, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getHomeForRoles } from "@/lib/role-homes";
import { getContextForPath } from "@/lib/app-context";
import { LocaleSwitch } from "@/components/locale-switch";

export default function LandingPage() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  // If already signed in, send the user straight to their dashboard. The
  // landing buttons are only useful when the user is choosing where to log in.
  useEffect(() => {
    if (isLoading) return;
    if (user) navigate(getHomeForRoles(user.roles, getContextForPath(window.location.pathname)));
  }, [user, isLoading, navigate]);

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
          <div className="mb-10 text-center">
            <img
              src="/bestellenbij-logo.svg"
              alt={t("app.name")}
              className="mx-auto mb-4 h-14 w-auto"
            />
            <h1
              className="text-3xl font-bold tracking-tight"
              data-testid="text-landing-heading"
            >
              {t("landing.heading")}
            </h1>
            <p className="mt-2 text-muted-foreground">{t("landing.sub")}</p>
          </div>
          <div className="grid gap-3">
            <Link
              href="/rider/login"
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-md shadow-primary/5 hover:border-primary hover:shadow-lg transition-all"
              data-testid="link-landing-rider"
            >
              <div className="size-12 rounded-lg bg-primary/10 text-primary grid place-items-center">
                <Bike className="size-6" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold">{t("landing.rider.title")}</div>
                <div className="text-sm text-muted-foreground">
                  {t("landing.rider.sub")}
                </div>
              </div>
              <ArrowRight className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
            <Link
              href="/restaurant/login"
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-md shadow-primary/5 hover:border-primary hover:shadow-lg transition-all"
              data-testid="link-landing-restaurant"
            >
              <div className="size-12 rounded-lg bg-accent/20 text-accent-foreground grid place-items-center">
                <Store className="size-6" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold">
                  {t("landing.restaurant.title")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t("landing.restaurant.sub")}
                </div>
              </div>
              <ArrowRight className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("landing.footer")}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
