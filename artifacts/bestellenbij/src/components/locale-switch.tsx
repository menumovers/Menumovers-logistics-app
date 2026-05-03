import { useTranslation } from "react-i18next";
import {
  useUpdateMyLocale,
  getGetCurrentUserQueryKey,
  UpdateLocaleRequestPreferredLocale,
  type CurrentUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function LocaleSwitch() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const updateLocale = useUpdateMyLocale();
  const { toast } = useToast();
  const lang = i18n.resolvedLanguage ?? i18n.language ?? "nl";

  function pick(target: "nl" | "en") {
    if (target === lang) return;
    // Always update the in-app locale immediately for snappy UX. Auth path
    // additionally persists the choice on the user profile so it survives
    // device changes; localStorage gets written by the i18n languageChanged
    // listener as a fallback for unauthed contexts.
    void i18n.changeLanguage(target);
    if (user) {
      const preferredLocale =
        target === "nl"
          ? UpdateLocaleRequestPreferredLocale.nl
          : UpdateLocaleRequestPreferredLocale.en;
      updateLocale.mutate(
        { data: { preferredLocale } },
        {
          onSuccess: () => {
            // Synchronously reflect the new locale on the cached /auth/me so
            // any subsequent read sees it without a refetch race. We also
            // invalidate to pull fresh state in the background.
            qc.setQueryData<CurrentUser | undefined>(
              getGetCurrentUserQueryKey(),
              (prev) => (prev ? { ...prev, preferredLocale: target } : prev),
            );
            void qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
            toast({ title: t("settings.languageSaved", "Language saved") });
          },
          onError: (err) => {
            const msg =
              err && typeof err === "object" && "message" in err
                ? String((err as { message?: unknown }).message)
                : "unknown";
            // eslint-disable-next-line no-console
            console.error("[locale-switch] PATCH /users/me/locale failed:", msg, err);
            toast({
              variant: "destructive",
              title: t("settings.languageSaveFailed", "Could not save language"),
              description: msg,
            });
          },
        },
      );
    }
  }

  return (
    <div
      className="inline-flex rounded-md border border-border overflow-hidden text-xs"
      data-testid="locale-switch"
    >
      {(["nl", "en"] as const).map((l) => (
        <Button
          key={l}
          type="button"
          variant={lang === l ? "default" : "ghost"}
          size="sm"
          className="rounded-none px-3 h-8"
          data-testid={`button-locale-${l}`}
          onClick={() => pick(l)}
        >
          {l.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}
