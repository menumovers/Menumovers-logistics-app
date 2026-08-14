import { SETTINGS, readSetting } from "./settings-registry";

/**
 * Cross-route readers for system_settings. The Settings route owns writes; any
 * route that needs to read a setting at request time imports from here so we
 * have a single resolution rule per setting (defaults included).
 *
 * Resolution itself lives in `settings-registry.ts` — these are named
 * conveniences over it, not separate implementations.
 */
export async function getAllowRiderSelfClaim(): Promise<boolean> {
  return readSetting(SETTINGS.allowRiderSelfClaim);
}
