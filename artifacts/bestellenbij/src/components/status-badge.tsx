import { useTranslation } from "react-i18next";
import type { OrderStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { STATUS_CLASS, statusI18nKey } from "@/lib/status";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_CLASS[status],
      )}
      data-testid={`badge-status-${status}`}
    >
      {t(statusI18nKey(status))}
    </span>
  );
}
