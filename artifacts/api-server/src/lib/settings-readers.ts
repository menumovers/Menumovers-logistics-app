import { eq } from "drizzle-orm";
import { db, systemSettingsTable, SETTING_KEYS } from "@workspace/db";

/**
 * Cross-route readers for system_settings. The Settings route owns writes; any
 * route that needs to read a setting at request time imports from here so we
 * have a single resolution rule per setting (defaults included).
 */
export async function getAllowRiderSelfClaim(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SETTING_KEYS.ALLOW_RIDER_SELF_CLAIM));
  if (!row?.value) return true;
  return row.value === "true";
}
