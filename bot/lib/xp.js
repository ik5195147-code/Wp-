/** লেভেল/XP গণিত: লেভেল n পেতে 100 × n² XP লাগে। */
export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100));
export const xpFor = (level) => 100 * level * level;

export function progress(xp) {
  const level = levelOf(xp);
  const base = xpFor(level);
  const next = xpFor(level + 1);
  return {
    level,
    xp,
    next,
    pct: Math.min(100, Math.floor(((xp - base) / (next - base)) * 100)),
  };
}

/** ▰▰▰▰▱▱▱▱▱▱ ধরনের প্রগ্রেস বার */
export function bar(pct, n = 10) {
  const filled = Math.round((pct / 100) * n);
  return '▰'.repeat(filled) + '▱'.repeat(n - filled);
}
