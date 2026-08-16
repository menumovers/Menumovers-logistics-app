import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { combineDateAndTime, toDateInputValue, toTimeInputValue } from "@/lib/format";

/**
 * Date + time entry for a pickup time.
 *
 * The date field is the point of this component. Three screens previously
 * collected a time alone, applied it to today, and rolled forward one day if
 * that moment had passed — so an order scheduled for later in the week could
 * never be given a correct pickup time, and because restaurant and override
 * outrank the original in the priority chain, the wrong value won. See
 * docs/todo-bugs.md B1.
 *
 * Both fields default to the order's current effective pickup time, so the
 * common case (nudge today's order by ten minutes) is still two taps.
 */
export function PickupTimeInput({
  currentIso,
  onSubmit,
  pending = false,
  submitLabel,
  className,
}: {
  /** The pickup time in force now — seeds both fields. */
  currentIso: string | null | undefined;
  onSubmit: (iso: string) => void;
  pending?: boolean;
  submitLabel: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(() => toDateInputValue(currentIso));
  const [time, setTime] = useState(() => toTimeInputValue(currentIso));

  const iso = combineDateAndTime(date, time);

  return (
    <form
      className={className ?? "flex flex-wrap items-end gap-2"}
      onSubmit={(e) => {
        e.preventDefault();
        if (iso) onSubmit(iso);
      }}
    >
      <div>
        <Label className="text-xs">{t("pickup.date")}</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="tabular-nums"
          data-testid="input-pickup-date"
        />
      </div>
      <div>
        <Label className="text-xs">{t("pickup.time")}</Label>
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="tabular-nums"
          data-testid="input-pickup-time"
        />
      </div>
      <Button type="submit" disabled={pending || !iso} data-testid="button-save-pickup-time">
        {submitLabel}
      </Button>
    </form>
  );
}
