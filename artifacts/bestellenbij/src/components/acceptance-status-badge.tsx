import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const ACCEPTANCE_BG: Record<"new" | "accepted", string> = {
  new: "bg-[#A0CFD7]",
  accepted: "bg-[#E2F0D9]",
};

/**
 * Whether the restaurant has acknowledged the order yet — distinct from the
 * order's lifecycle status (see StatusBadge). Visual only, mirrors the
 * AVAILABILITY_BG pill pattern on the rider dashboard.
 *
 * `compact` trims the label to its first two characters — the coordinator
 * board packs a lot into a small card, and with only two possible states
 * (each its own color) the abbreviation is still unambiguous.
 */
export function AcceptanceStatusBadge({
  acceptedAt,
  compact = false,
}: {
  acceptedAt: string | null | undefined;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const state = acceptedAt ? "accepted" : "new";
  const label = t(`restaurant.status.${state}`);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold text-foreground",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        ACCEPTANCE_BG[state],
      )}
      data-testid={`badge-acceptance-${state}`}
      title={compact ? label : undefined}
    >
      {compact ? label.slice(0, 2) : label}
    </span>
  );
}
