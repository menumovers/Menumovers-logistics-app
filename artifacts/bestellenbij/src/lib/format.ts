import type { Order, PickupTimeSource } from "@workspace/api-client-react";

export type AnyOrder = Pick<
  Order,
  | "pickupTimeOriginal"
  | "pickupTimeRider"
  | "pickupTimeRestaurant"
  | "pickupTimeOverride"
> &
  Partial<Pick<Order, "effectivePickupTime" | "effectivePickupSource">>;

const localeMap: Record<string, string> = { nl: "nl-NL", en: "en-GB" };

export function uiLocale(lang: string): string {
  return localeMap[lang] ?? "nl-NL";
}

/** Always render the price string AS-IS, just swap the decimal separator for nl. */
export function formatCurrency(amount: string | null | undefined, lang: string): string {
  if (amount == null || amount === "") return "—";
  const cleaned = amount.trim();
  // Normalize: backend always sends "12.50". For nl render as "12,50".
  const display = lang === "nl" ? cleaned.replace(".", ",") : cleaned;
  return `€ ${display}`;
}

/**
 * Parse a money string to integer cents. Returns null if unparseable.
 *
 * Amounts travel as strings ("12.50") specifically to avoid float math, so
 * arithmetic on them is done in cents rather than by parsing to a Number and
 * hoping. Accepts a comma decimal separator too, defensively.
 */
export function moneyToCents(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0") || "0", 10);
  return negative ? -cents : cents;
}

/** Render integer cents back to the "12.50" string shape the backend uses. */
export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** `a - b` in cents, returned in the same string shape. Null if either is unparseable. */
export function subtractMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const ac = moneyToCents(a);
  const bc = moneyToCents(b);
  if (ac === null || bc === null) return null;
  return centsToMoney(ac - bc);
}

export function formatTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(uiLocale(lang), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(uiLocale(lang), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Returns minutes (signed): positive = future, negative = past. */
export function minutesUntil(iso: string, now: Date = new Date()): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
}

/**
 * Effective pickup time. If the backend already provides effectivePickupTime/Source,
 * use it; otherwise compute by priority override > restaurant > rider > original.
 */
export function effectivePickup(o: AnyOrder): {
  iso: string;
  source: PickupTimeSource | "original";
} {
  if (o.effectivePickupTime) {
    return {
      iso: o.effectivePickupTime,
      source: (o.effectivePickupSource as PickupTimeSource | undefined) ?? "original",
    };
  }
  if (o.pickupTimeOverride) return { iso: o.pickupTimeOverride, source: "override" };
  if (o.pickupTimeRestaurant) return { iso: o.pickupTimeRestaurant, source: "restaurant" };
  if (o.pickupTimeRider) return { iso: o.pickupTimeRider, source: "rider" };
  return { iso: o.pickupTimeOriginal, source: "original" };
}

/**
 * Local-time parts for `<input type="date">` / `<input type="time">`.
 *
 * Deliberately local, not UTC: the operator is typing a wall-clock time in
 * their own timezone, so `toISOString().slice(0, 10)` would land on the wrong
 * day either side of midnight.
 */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combine a `YYYY-MM-DD` and an `HH:mm` into an ISO instant, interpreting both
 * in the operator's local timezone. Returns null if either part is unusable.
 *
 * This exists because three screens previously took a time alone, applied it to
 * *today*, and rolled forward a day if that had already passed — which made a
 * correct pickup time unreachable for any order scheduled beyond tomorrow. See
 * docs/todo-bugs.md B1.
 */
export function combineDateAndTime(
  dateValue: string,
  timeValue: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim());
  if (!dateMatch || !timeMatch) return null;
  const [, y, mo, d] = dateMatch;
  const [, h, mi] = timeMatch;
  const hours = Number(h);
  const minutes = Number(mi);
  if (hours > 23 || minutes > 59) return null;
  const combined = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hours,
    minutes,
    0,
    0,
  );
  if (Number.isNaN(combined.getTime())) return null;
  return combined.toISOString();
}

export type Urgency = "neutral" | "warn" | "danger" | "late";

export function urgencyFor(iso: string, now: Date = new Date()): Urgency {
  const m = minutesUntil(iso, now);
  if (m < 0) return "late";
  if (m < 5) return "danger";
  if (m < 20) return "warn";
  return "neutral";
}

/**
 * Within ±60 min show relative phrasing (in / ago / now) — a countdown.
 * Outside that window show the absolute clock time HH:mm in the active locale.
 * Returns the i18n key + interpolation values so the consumer can call t().
 */
export type PickupLabelDescriptor =
  | { kind: "key"; key: "common.now" }
  | { kind: "key"; key: "pickup.in" | "pickup.late"; values: { minutes: number } }
  | { kind: "literal"; text: string };

export function pickupCountdownLabel(
  iso: string,
  lang: string,
  now: Date = new Date(),
): PickupLabelDescriptor {
  const m = minutesUntil(iso, now);
  const absM = Math.abs(m);
  if (absM >= 60) return { kind: "literal", text: formatTime(iso, lang) };
  if (m === 0) return { kind: "key", key: "common.now" };
  if (m < 0) return { kind: "key", key: "pickup.late", values: { minutes: absM } };
  return { kind: "key", key: "pickup.in", values: { minutes: m } };
}
