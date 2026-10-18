import { getGroup } from '../lib/store.js';
import { applyFont } from '../lib/fonts.js';
import { renderRanking } from '../lib/render.js';

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const DAY = 86_400_000;
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];

/** `.top [n]` — মেসেজ সংখ্যা অনুযায়ী সবচেয়ে সক্রিয় সদস্য (সর্বোচ্চ ২০ জন)। */
export function topMembers(jid, limit = 5, prefix = '.') {
  const g = getGroup(jid);
  const n = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const top = Object.entries(g.members)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([id, v]) => ({ id, count: v.count }));
  return { text: renderRanking(g.settings, top, n, prefix), mentions: top.map((r) => r.id) };
}

/**
 * `.highlights` — জনপ্রিয় মেসেজ = রিয়্যাকশন সংখ্যা + (রিপ্লাই সংখ্যা × ২)।
 * স্কোর বদলাতে চাইলে নিচের `score` লাইনটি এডিট করুন।
 */
export function topMessages(jid, limit = 5, days = 7) {
  const g = getGroup(jid);
  const f = (s) => applyFont(g.settings.font, s);
  const since = Date.now() - days * DAY;

  const ranked = Object.values(g.messages)
    .map((m) => {
      const reactions = Object.keys(m.r).length;
      return { ...m, reactions, score: reactions + m.q * 2 };
    })
    .filter((m) => m.ts >= since && m.score > 0)
    .sort((a, b) => b.score - a.score || b.ts - a.ts)
    .slice(0, Math.min(Math.max(limit, 1), 10));

  if (!ranked.length) {
    return { text: `📭 শেষ ${days} দিনে কোনো মেসেজ রিয়্যাকশন বা রিপ্লাই পায়নি।`, mentions: [] };
  }

  const mentions = new Set();
  const lines = ranked.map((m, i) => {
    mentions.add(m.s);
    const emojis = [...new Set(Object.values(m.r))].slice(0, 3).join('');
    return (
      `${NUM[i]} @${num(m.s)}: "${m.t}"\n` +
      `    ${emojis} ${m.reactions} রিয়্যাকশন • 💬 ${m.q} রিপ্লাই`
    );
  });

  return {
    text: `🔥 *${f('Highlights')}* (শেষ ${days} দিন)\n\n${lines.join('\n\n')}`,
    mentions: [...mentions],
  };
}
