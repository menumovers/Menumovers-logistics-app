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

export type Urgency = "neutral" | "warn" | "danger" | "late";

export function urgencyFor(iso: string, now: Date = new Date()): Urgency {
  const m = minutesUntil(iso, now);
  if (m < 0) return "late";
  if (m < 5) return "danger";
  if (m < 20) return "warn";
  return "neutral";
}

/**
 * Within ±30 min show relative phrasing (in / ago / now).
 * Outside that window show the absolute clock time HH:mm in the active locale.
 * Returns the i18n key + interpolation values so the consumer can call t().
 */
export type PickupLabelDescriptor =
  | { kind: "key"; key: "common.now" }
  | { kind: "key"; key: "pickup.in" | "pickup.ago"; values: { minutes: number } }
  | { kind: "literal"; text: string };

export function pickupCountdownLabel(
  iso: string,
  lang: string,
  now: Date = new Date(),
): PickupLabelDescriptor {
  const m = minutesUntil(iso, now);
  const absM = Math.abs(m);
  if (absM > 30) return { kind: "literal", text: formatTime(iso, lang) };
  if (m === 0) return { kind: "key", key: "common.now" };
  if (m < 0) return { kind: "key", key: "pickup.ago", values: { minutes: absM } };
  return { kind: "key", key: "pickup.in", values: { minutes: m } };
}
