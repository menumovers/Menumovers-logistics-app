import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, AlertTriangle } from "lucide-react";
import {
  effectivePickup,
  pickupCountdownLabel,
  urgencyFor,
  type AnyOrder,
} from "@/lib/format";
import { URGENCY_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";

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
  const urgency = urgencyFor(eff.iso, now);
  const desc = pickupCountdownLabel(eff.iso, lang, now);
  const label =
    desc.kind === "literal"
      ? desc.text
      : "values" in desc
        ? t(desc.key, desc.values)
        : t(desc.key);

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
        URGENCY_CLASS[urgency],
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
