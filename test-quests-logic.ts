import { computeStreak, dayKey, streakMultiplier, SOCIAL_ACTIONS } from "./src/lib/quests";
import { awardSocial, emptySocialWallet, mergedStreak, emptyTradeWallet } from "./src/lib/quests-engine";

let fails = 0;
const eq = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${name}: got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const DAY = 86_400_000;
const now = Date.now();
const today = dayKey(now);

// streaks
eq("streak empty", computeStreak(new Set(), now), 0);
eq("streak today only", computeStreak(new Set([today]), now), 1);
eq("streak yesterday only (not broken yet)", computeStreak(new Set([dayKey(now - DAY)]), now), 1);
eq("streak 3 consecutive", computeStreak(new Set([today, dayKey(now - DAY), dayKey(now - 2 * DAY)]), now), 3);
eq("streak gap breaks", computeStreak(new Set([today, dayKey(now - 2 * DAY)]), now), 1);
eq("streak 2-day-old breaks", computeStreak(new Set([dayKey(now - 2 * DAY)]), now), 0);

// multipliers
eq("mult 0", streakMultiplier(0), 1);
eq("mult 3", streakMultiplier(3), 1.2);
eq("mult 7", streakMultiplier(7), 1.5);
eq("mult 30", streakMultiplier(30), 2);

// caps: like = 1pt, cap 20
const w = emptySocialWallet();
let total = 0;
for (let i = 0; i < 25; i++) total += awardSocial(w, "like", today, 1);
eq("like capped at 20/day", total, 20);
eq("wallet points", w.points, 20);
eq("day count recorded", w.dayCounts[today].like, 20);

// post 10pts ×1.5 multiplier rounds
const w2 = emptySocialWallet();
eq("post with 1.5x", awardSocial(w2, "post", today, 1.5), 15);
eq("unknown action ignored", awardSocial(w2, "yolo", today, 1), 0);

// cap is per-day — next day resets
const tomorrow = dayKey(now + DAY);
const w3 = emptySocialWallet();
for (let i = 0; i < 3; i++) awardSocial(w3, "post", today, 1);
eq("post cap hit", awardSocial(w3, "post", today, 1), 0);
eq("cap resets next day", awardSocial(w3, "post", tomorrow, 1), 10);
eq("activeDays tracks both", w3.activeDays, [today, tomorrow]);

// merged streak across namespaces
const sw = emptySocialWallet(); sw.activeDays = [dayKey(now - DAY)];
const tw = emptyTradeWallet(); tw.activeDays = [today];
eq("merged streak social+trade", mergedStreak(sw, tw, now), 2);

// sanity: config table
eq("actions configured", Object.keys(SOCIAL_ACTIONS), ["post","comment","like","follow","vote","join"]);

process.exit(fails ? 1 : 0);
