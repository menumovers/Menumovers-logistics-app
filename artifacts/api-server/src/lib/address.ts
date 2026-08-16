/**
 * The one place a display address is built from the structured components.
 *
 * The components are canonical (D12) — they are what a coordinator edits and
 * what any future area grouping, sorting or geocoding will query. But people
 * read an address as a line of text, so screens get one built from them rather
 * than assembling their own and drifting.
 *
 * This is deliberately *not* `deliveryAddressOriginal`. That column holds what
 * the source sent, verbatim and immutable, for audit. This is what the order
 * currently says, corrections included.
 */

export type AddressComponents = {
  street: string;
  houseNumber: string | null;
  addition: string | null;
  postalCode: string;
  city: string;
  country: string;
};

/** Netherlands. Every order is Dutch, so the country is noise on screen. */
const IMPLIED_COUNTRY = "nl";

function isImplied(country: string): boolean {
  const c = country.trim().toLowerCase();
  return c === IMPLIED_COUNTRY || c === "nederland" || c === "netherlands";
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Dutch convention: `Hoofdstraat 12 A, 1011 AB Amsterdam`.
 *
 * Every part is defensive about being blank. `houseNumber` and `addition` are
 * nullable in the schema, and the rest are `NOT NULL` but that constrains the
 * column, not the contents — an empty string would still get through. Blank
 * parts drop out rather than leaving stray separators.
 */
export function formatAddress(a: AddressComponents): string {
  const streetLine = [clean(a.street), clean(a.houseNumber), clean(a.addition)]
    .filter(Boolean)
    .join(" ");
  const cityLine = [clean(a.postalCode), clean(a.city)].filter(Boolean).join(" ");
  const country = clean(a.country);
  const parts = [streetLine, cityLine];
  if (country && !isImplied(country)) parts.push(country);
  return parts.filter(Boolean).join(", ");
}
