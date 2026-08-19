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
 */
export function AcceptanceStatusBadge({
  acceptedAt,
}: {
  acceptedAt: string | null | undefined;
}) {
  const { t } = useTranslation();
  const state = acceptedAt ? "accepted" : "new";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-foreground",
        ACCEPTANCE_BG[state],
      )}
      data-testid={`badge-acceptance-${state}`}
    >
      {t(`restaurant.status.${state}`)}
    </span>
  );
}
