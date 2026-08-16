/**
 * "Has a new day started?" in a specific timezone.
 *
 * The in-the-moment pickup estimate describes today's conditions, so it must
 * not survive into tomorrow. The boundary is 03:00 Europe/Amsterdam — late
 * enough that a coordinator working past midnight is still on the same
 * operational day.
 *
 * Amsterdam observes DST, so "03:00 local" is not a fixed UTC offset and the
 * gap between two resets is not always 24 hours. Everything here goes through
 * `Intl` rather than arithmetic on UTC hours, which would drift twice a year.
 */

export const RESET_TIME_ZONE = "Europe/Amsterdam";
export const RESET_HOUR = 3;

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: RESET_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The wall-clock reading in Amsterdam at a given instant. */
export function wallClockAt(instant: Date): WallClock {
  const parts: Record<string, string> = {};
  for (const part of FORMATTER.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    // Intl can render midnight as "24" in some environments.
    hour: Number(parts["hour"]) % 24,
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
  };
}

/** Amsterdam's offset from UTC, in milliseconds, at a given instant. */
function offsetMsAt(instant: Date): number {
  const w = wallClockAt(instant);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which Amsterdam's clock reads the given wall time.
 *
 * Solved by iteration because the offset depends on the answer: guess with the
 * offset at the naive instant, then correct once using the offset that actually
 * applies there. Two passes settle every case including DST transitions.
 */
export function instantForWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0);
  let instant = new Date(naive - offsetMsAt(new Date(naive)));
  instant = new Date(naive - offsetMsAt(instant));
  return instant;
}

/**
 * The most recent reset boundary at or before `now`.
 *
 * A value written before this belongs to a previous operational day.
 */
export function lastResetBefore(now: Date): Date {
  const w = wallClockAt(now);
  const todaysReset = instantForWallClock(w.year, w.month, w.day, RESET_HOUR);
  if (todaysReset.getTime() <= now.getTime()) return todaysReset;
  // Before 03:00 — still on yesterday's operational day. Step back a calendar
  // day in Amsterdam terms rather than subtracting 24 hours, which would land
  // an hour off across a DST change.
  const yesterday = wallClockAt(new Date(now.getTime() - 24 * 60 * 60_000));
  return instantForWallClock(
    yesterday.year,
    yesterday.month,
    yesterday.day,
    RESET_HOUR,
  );
}

/**
 * Whether a value written at `setAt` has been carried past a reset boundary.
 * A missing timestamp counts as stale: we cannot show it belongs to today, and
 * the safe failure is to fall back to the default rather than apply an
 * unknown-age adjustment.
 */
export function isStale(setAt: Date | null, now: Date): boolean {
  if (!setAt) return true;
  return setAt.getTime() < lastResetBefore(now).getTime();
}
