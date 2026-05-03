import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, AlertTriangle } from "lucide-react";
import { effectivePickup, formatTime, minutesUntil, urgencyFor, type AnyOrder } from "@/lib/format";
import { cn } from "@/lib/utils";

const URGENCY_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-foreground",
  warn: "bg-accent/15 text-accent-foreground border border-accent/40",
  danger: "bg-destructive/15 text-destructive border border-destructive/40",
  late: "bg-destructive text-destructive-foreground",
};

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function PickupCountdown({
  order,
  size = "md",
}: {
  order: AnyOrder;
  size?: "sm" | "md" | "lg";
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const now = useNow(15_000);
  const eff = effectivePickup(order);
  const m = minutesUntil(eff.iso, now);
  const urgency = urgencyFor(eff.iso, now);
  const absM = Math.abs(m);

  let label: string;
  if (absM > 30) {
    label = formatTime(eff.iso, lang);
  } else if (m < 0) {
    label = t("pickup.late", { minutes: absM });
  } else if (m === 0) {
    label = t("common.now");
  } else {
    label = t("pickup.in", { minutes: m });
  }

  const sizeCls =
    size === "lg"
      ? "px-4 py-2 text-lg font-semibold"
      : size === "sm"
        ? "px-2 py-0.5 text-xs"
        : "px-3 py-1 text-sm font-medium";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full",
        URGENCY_CLASSES[urgency],
        sizeCls,
      )}
      data-testid="badge-pickup-countdown"
      data-urgency={urgency}
    >
      {urgency === "late" || urgency === "danger" ? (
        <AlertTriangle className="size-3.5" />
      ) : (
        <Clock className="size-3.5" />
      )}
      {label}
    </span>
  );
}

export function PickupSourceBadge({ source }: { source: string }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
      data-testid={`badge-pickup-source-${source}`}
    >
      {t(`pickup.source_${source}`)}
    </span>
  );
}
