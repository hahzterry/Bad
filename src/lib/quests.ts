// Shyft Quests — season points config + pure helpers.
//
// Client-safe: no server deps here. The tally/award engine lives in
// quests-engine.ts (server only). Weights are deliberately skewed toward
// trading — social actions are capped daily so grinding them earns dust,
// while volume (which pays the 1% fee) always wins.

/** Season metadata — bump SEASON_ID to reset the race (state is namespaced by season). */
export const SEASON_ID = 1;

/** Social actions: base points + hard daily cap (per wallet, UTC days). */
export const SOCIAL_ACTIONS: Record<
  string,
  { points: number; dailyCap: number; label: string }
> = {
  post:    { points: 10, dailyCap: 3,  label: "Create a post" },
  comment: { points: 5,  dailyCap: 5,  label: "Comment on a post" },
  like:    { points: 1,  dailyCap: 20, label: "Like a post" },
  follow:  { points: 2,  dailyCap: 10, label: "Follow someone" },
  vote:    { points: 2,  dailyCap: 5,  label: "Vote in a poll" },
  join:    { points: 5,  dailyCap: 3,  label: "Join a community" },
};

/** Trading: 1 pt per $1 of volume (floor, min 1 per verified trade). */
export const TRADE_POINTS_PER_USD = 1;
/** Bonus for the first verified trade of the day. */
export const FIRST_TRADE_BONUS = 25;
/** Bonus for trading 3+ distinct tokens in one day. */
export const MULTI_TOKEN_BONUS = 50;
export const MULTI_TOKEN_COUNT = 3;

/** Streak multiplier: consecutive UTC days with ≥1 counted action. */
export function streakMultiplier(streak: number): number {
  if (streak >= 30) return 2;
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.2;
  return 1;
}

/** UTC day key, e.g. "2026-07-23". */
export function dayKey(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/**
 * Current streak from a set of active day-keys: consecutive days ending
 * today (or yesterday — today's action hasn't happened yet, streak not
 * broken until the day is actually missed).
 */
export function computeStreak(activeDays: Set<string>, nowMs = Date.now()): number {
  const DAY = 86_400_000;
  let cursor = nowMs;
  // Streak may start today or yesterday
  if (!activeDays.has(dayKey(cursor))) {
    cursor -= DAY;
    if (!activeDays.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (activeDays.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}
