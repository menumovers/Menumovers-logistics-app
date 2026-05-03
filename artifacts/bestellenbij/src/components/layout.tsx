import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Bike,
  Store,
  Settings as SettingsIcon,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import type { UserRole } from "@workspace/api-client-react";
import { useAuth, ROLE_HOMES } from "@/lib/auth";
import { LocaleSwitch } from "./locale-switch";
import { PushOptInPrompt } from "./push-opt-in";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ROLE_NAV: Record<UserRole, Array<{ to: string; key: string; icon: typeof Bike }>> = {
  admin: [
    { to: "/admin", key: "admin", icon: ShieldCheck },
    { to: "/coordinator", key: "coordinator", icon: LayoutDashboard },
    { to: "/settings", key: "settings", icon: SettingsIcon },
  ],
  coordinator: [
    { to: "/coordinator", key: "coordinator", icon: LayoutDashboard },
    { to: "/settings", key: "settings", icon: SettingsIcon },
  ],
  rider: [
    { to: "/rider", key: "rider", icon: Bike },
    { to: "/settings", key: "settings", icon: SettingsIcon },
  ],
  restaurant_staff: [
    { to: "/restaurant", key: "restaurant", icon: Store },
    { to: "/settings", key: "settings", icon: SettingsIcon },
  ],
};

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [loc] = useLocation();
  if (!user) return <>{children}</>;
  const items = ROLE_NAV[user.role];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto max-w-[1600px] px-4 h-14 flex items-center gap-4">
          <Link href={ROLE_HOMES[user.role]} className="flex items-center gap-2 font-semibold tracking-tight" data-testid="link-home">
            <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-sm font-bold">
              BB
            </div>
            <span className="hidden sm:inline">{t("app.name")}</span>
          </Link>
          <nav className="flex items-center gap-1 ml-2">
            {items.map((item) => {
              const Icon = item.icon;
              const active = loc === item.to || loc.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                  data-testid={`link-nav-${item.key}`}
                >
                  <Icon className="size-4" />
                  <span className="hidden md:inline">{t(`nav.${item.key}`)}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitch />
            <div className="hidden md:block text-right text-xs leading-tight">
              <div className="font-medium" data-testid="text-user-name">{user.name}</div>
              <div className="text-muted-foreground">{t(`roles.${user.role}`)}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              data-testid="button-logout"
              aria-label={t("nav.logout")}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-[1600px] w-full px-4 py-6">{children}</main>
      <PushOptInPrompt />
    </div>
  );
}
