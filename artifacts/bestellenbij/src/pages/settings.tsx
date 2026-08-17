import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useUpdateUser } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocaleSwitch } from "@/components/locale-switch";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const updateUser = useUpdateUser();
  const [pwd, setPwd] = useState("");
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("bb_theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  if (!user) return null;

  function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user || pwd.length < 8) return;
    updateUser.mutate(
      { id: user.id, data: { password: pwd } },
      {
        onSuccess: () => {
          setPwd("");
          toast({ title: t("settings.passwordChanged") });
        },
      },
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
      </div>

      {user.role === "admin" ? (
        <Card className="md:hidden">
          <CardContent className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {t("settings.adminPanel")}
            </div>
            <Button asChild variant="outline" size="sm" data-testid="link-settings-admin">
              <Link href="/admin">{t("nav.admin")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("settings.languageNl")} / {t("settings.languageEn")}
          </div>
          <LocaleSwitch />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <Label htmlFor="dark" className="text-sm">{t("settings.darkMode")}</Label>
          <Switch id="dark" checked={dark} onCheckedChange={setDark} data-testid="switch-dark-mode" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-1">
            <div><span className="text-muted-foreground">{t("common.name")}: </span><span data-testid="text-account-name">{user.name}</span></div>
            <div><span className="text-muted-foreground">{t("common.email")}: </span><span data-testid="text-account-email">{user.email}</span></div>
            <div><span className="text-muted-foreground">{t("common.role")}: </span><span>{t(`roles.${user.role}`)}</span></div>
          </div>
          <form onSubmit={changePassword} className="space-y-2 pt-2 border-t border-border">
            <Label htmlFor="pwd">{t("settings.newPassword")}</Label>
            <div className="flex gap-2">
              <Input
                id="pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                minLength={8}
                placeholder="••••••••"
                data-testid="input-new-password"
              />
              <Button type="submit" disabled={pwd.length < 8 || updateUser.isPending} data-testid="button-change-password">
                {t("settings.changePassword")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Button variant="destructive" onClick={signOut} data-testid="button-settings-logout">
        {t("settings.logout")}
      </Button>
    </div>
  );
}
