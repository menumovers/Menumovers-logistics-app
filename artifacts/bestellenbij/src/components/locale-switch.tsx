import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function LocaleSwitch() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? i18n.language ?? "nl";
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" data-testid="locale-switch">
      {(["nl", "en"] as const).map((l) => (
        <Button
          key={l}
          type="button"
          variant={lang === l ? "default" : "ghost"}
          size="sm"
          className="rounded-none px-3 h-8"
          data-testid={`button-locale-${l}`}
          onClick={() => i18n.changeLanguage(l)}
        >
          {l.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}
