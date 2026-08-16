import { eq, inArray } from "drizzle-orm";
import { db, systemSettingsTable, SETTING_KEYS } from "@workspace/db";
import { httpError } from "./errors";
import { DEFAULT_PICKUP_OFFSET_MINUTES } from "./pickup-time";

/**
 * Declarative registry for `system_settings`.
 *
 * A setting is declared once — key, type, default, optional environment
 * fallback, optional validation — and everything else derives from that
 * declaration: typed reads, the admin API payload, and write validation.
 *
 * Rationale: settings are the standing answer to "we don't know the right
 * value yet" (see docs/workflow-decisions.md D8), so they get added often.
 * Before this existed, each one cost a key constant, a reader, a duplicate
 * reader in the route, an API field and a UI control — and the duplication
 * was already real at two settings, with the webhook URL resolved in both
 * `webhook.ts` and `routes/settings.ts`.
 *
 * To add a setting: declare it in `SETTINGS` below. Reads and the admin
 * payload follow automatically; only the UI control is still hand-written.
 */

/** Where a resolved value came from. Surfaced so an admin can tell whether their UI change took effect. */
export type SettingSource = "settings" | "env" | "unset";

export type SettingDefinition<T> = {
  key: string;
  /** Stored (or env) string → typed value. */
  parse: (raw: string) => T;
  /** Typed value → stored string. `null` deletes the row, restoring the fallback. */
  serialize: (value: T) => string | null;
  /** Value when neither a row nor an environment variable is present. */
  fallback: T;
  /** Environment variable consulted when no row exists. Boot-time fallback for fresh installs. */
  envVar?: string;
  /** Throws to reject a write. */
  validate?: (value: T) => void;
};

export type Resolved<T> = { value: T; source: SettingSource };

function defineBoolean(
  key: string,
  opts: { fallback: boolean; envVar?: string },
): SettingDefinition<boolean> {
  return {
    key,
    parse: (raw) => raw === "true",
    serialize: (value) => (value ? "true" : "false"),
    fallback: opts.fallback,
    ...(opts.envVar !== undefined ? { envVar: opts.envVar } : {}),
  };
}

function defineString(
  key: string,
  opts: {
    fallback: string | null;
    envVar?: string;
    validate?: (value: string | null) => void;
  },
): SettingDefinition<string | null> {
  return {
    key,
    parse: (raw) => raw,
    // Empty string and null both mean "unset" — delete the row so the env
    // fallback and default can apply again.
    serialize: (value) => (value === null || value === "" ? null : value),
    fallback: opts.fallback,
    ...(opts.envVar !== undefined ? { envVar: opts.envVar } : {}),
    ...(opts.validate !== undefined ? { validate: opts.validate } : {}),
  };
}

function defineInteger(
  key: string,
  opts: {
    fallback: number | null;
    envVar?: string;
    validate?: (value: number | null) => void;
  },
): SettingDefinition<number | null> {
  return {
    key,
    parse: (raw) => {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : opts.fallback;
    },
    // null means "unset" — delete the row so the declared default applies again.
    serialize: (value) => (value === null ? null : String(value)),
    fallback: opts.fallback,
    ...(opts.envVar !== undefined ? { envVar: opts.envVar } : {}),
    ...(opts.validate !== undefined ? { validate: opts.validate } : {}),
  };
}

/**
 * An integer setting that always resolves to a number, because its fallback is
 * one. Distinct from `defineInteger` so consumers of a setting with a real
 * default don't have to null-check a value that can never be null.
 */
function defineRequiredInteger(
  key: string,
  opts: {
    fallback: number;
    envVar?: string;
    validate?: (value: number) => void;
  },
): SettingDefinition<number> {
  return {
    key,
    parse: (raw) => {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : opts.fallback;
    },
    // null is not expressible here: clearing the row restores the fallback.
    serialize: (value) => String(value),
    fallback: opts.fallback,
    ...(opts.envVar !== undefined ? { envVar: opts.envVar } : {}),
    ...(opts.validate !== undefined ? { validate: opts.validate } : {}),
  };
}

function assertNonNegativeInteger(field: string) {
  return (value: number | null): void => {
    if (value === null) return;
    if (!Number.isInteger(value) || value < 0) {
      throw httpError(400, "INVALID_SETTING", `${field} must be a whole number of minutes, or null`);
    }
  };
}

function assertHttpUrl(field: string) {
  return (value: string | null): void => {
    if (value === null || value === "") return;
    try {
      new URL(value);
    } catch {
      throw httpError(400, "INVALID_URL", `${field} is not a valid URL`);
    }
  };
}

/**
 * Every operator-configurable setting. Keys come from `SETTING_KEYS` so the
 * canonical list stays in the schema package alongside the table.
 */
export const SETTINGS = {
  outboundWebhookUrl: defineString(SETTING_KEYS.OUTBOUND_WEBHOOK_URL, {
    fallback: null,
    envVar: "WEBHOOK_URL",
    validate: assertHttpUrl("outboundWebhookUrl"),
  }),
  /**
   * Default OFF. The receiving end (babeldish) has not been built, so nothing
   * is listening; dispatching and retrying events at it would be pure waste.
   * Turning this on is also gated on adding request signing — see
   * docs/workflow-decisions.md D7.
   */
  outboundWebhookEnabled: defineBoolean(SETTING_KEYS.OUTBOUND_WEBHOOK_ENABLED, {
    fallback: false,
  }),
  /**
   * Default ON: matches the original product spec where riders can claim
   * unassigned orders. Operators flip this OFF to require coordinator dispatch.
   */
  allowRiderSelfClaim: defineBoolean(SETTING_KEYS.ALLOW_RIDER_SELF_CLAIM, {
    fallback: true,
  }),
  /**
   * Minutes from leaving the restaurant to reaching the customer, used to
   * derive `pickup_time_original`. Null means "use the per-order estimates";
   * setting it overrides them outright, so an operator can correct bad
   * upstream figures without waiting on the source. See workflow-decisions D4.
   */
  /**
   * The standing gap between pickup and the delivery time the customer was
   * shown. Applies to every order. Not travel time — a chosen offset.
   */
  pickupOffsetMinutes: defineRequiredInteger(SETTING_KEYS.PICKUP_OFFSET_MINUTES, {
    fallback: DEFAULT_PICKUP_OFFSET_MINUTES,
    validate: assertNonNegativeInteger("pickupOffsetMinutes"),
  }),
  /**
   * How quickly we can collect right now, in minutes from the order arriving —
   * "it's quiet, we can be there in ten". Counted forwards from arrival, unlike
   * the offset above which counts backwards from delivery; they are different
   * quantities and never combine. When set it *is* the ASAP pickup time, so a
   * small value moves pickup earlier and a large one later. ASAP only; cleared
   * at 03:00 Europe/Amsterdam.
   */
  pickupWithinMinutes: defineInteger(SETTING_KEYS.PICKUP_WITHIN_MINUTES, {
    fallback: null,
    validate: assertNonNegativeInteger("pickupWithinMinutes"),
  }),
  /**
   * Internal companion to the above: when it was last written, so the janitor
   * can tell whether it belongs to a previous day. Not a knob.
   */
  pickupWithinSetAt: defineString(SETTING_KEYS.PICKUP_WITHIN_SET_AT, {
    fallback: null,
  }),
} as const;

export type SettingName = keyof typeof SETTINGS;

function resolveFrom<T>(
  def: SettingDefinition<T>,
  row: { value: string | null } | undefined,
): Resolved<T> {
  if (row?.value) return { value: def.parse(row.value), source: "settings" };
  if (def.envVar) {
    const fromEnv = process.env[def.envVar];
    if (fromEnv) return { value: def.parse(fromEnv), source: "env" };
  }
  return { value: def.fallback, source: "unset" };
}

/** Resolve one setting, with its source. */
export async function resolveSetting<T>(
  def: SettingDefinition<T>,
): Promise<Resolved<T>> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, def.key));
  return resolveFrom(def, row);
}

/** Resolve one setting's value, discarding the source. */
export async function readSetting<T>(def: SettingDefinition<T>): Promise<T> {
  return (await resolveSetting(def)).value;
}

/**
 * Resolve every declared setting in a single query. Used by the admin
 * endpoints so adding a setting doesn't add a round trip.
 */
export async function resolveAllSettings(): Promise<{
  [K in SettingName]: Resolved<
    (typeof SETTINGS)[K] extends SettingDefinition<infer T> ? T : never
  >;
}> {
  const names = Object.keys(SETTINGS) as SettingName[];
  const keys = names.map((n) => SETTINGS[n].key);
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const out = {} as Record<string, Resolved<unknown>>;
  for (const name of names) {
    const def = SETTINGS[name] as SettingDefinition<unknown>;
    out[name] = resolveFrom(def, byKey.get(def.key));
  }
  return out as never;
}

/**
 * Validate and persist a setting. Serializing to `null` deletes the row so the
 * environment fallback and declared default apply again.
 */
export async function writeSetting<T>(
  def: SettingDefinition<T>,
  value: T,
): Promise<void> {
  def.validate?.(value);
  const serialized = def.serialize(value);
  if (serialized === null) {
    await db
      .delete(systemSettingsTable)
      .where(eq(systemSettingsTable.key, def.key));
    return;
  }
  await db
    .insert(systemSettingsTable)
    .values({ key: def.key, value: serialized })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: serialized },
    });
}
