import { areJidsSameUser } from '@whiskeysockets/baileys';
import { getGroup } from '../lib/store.js';
import { ctx } from '../lib/render.js';
import { levelOf } from '../lib/xp.js';
import { renderRanking, renderXpBoard } from '../lib/render.js';

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

/** `.leaderboard [n]` — XP অনুযায়ী সেরা সদস্য (সর্বোচ্চ ২০ জন)। */
export function topXp(jid, limit = 10) {
  const g = getGroup(jid);
  const n = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const rows = Object.entries(g.members)
    .filter(([, v]) => (v.xp || 0) > 0)
    .sort((a, b) => b[1].xp - a[1].xp)
    .slice(0, n)
    .map(([id, v]) => ({ id, xp: v.xp, level: levelOf(v.xp) }));
  return { text: renderXpBoard(g.settings, rows), mentions: rows.map((r) => r.id) };
}

/** একজনের র‍্যাঙ্ক-তথ্য: XP অনুযায়ী অবস্থান / মোট র‍্যাঙ্কড সদস্য / মেসেজ সংখ্যা। */
export function rankOf(jid, who) {
  const g = getGroup(jid);
  const ranked = Object.entries(g.members)
    .filter(([, v]) => (v.xp || 0) > 0)
    .sort((a, b) => b[1].xp - a[1].xp);
  const idx = ranked.findIndex(([id]) => areJidsSameUser(id, who));
  const mine = Object.entries(g.members).find(([id]) => areJidsSameUser(id, who))?.[1];
  return {
    rank: idx === -1 ? ranked.length + 1 : idx + 1,
    total: Math.max(ranked.length, 1),
    xp: mine?.xp || 0,
    count: mine?.count || 0,
  };
}

/**
 * `.highlights` — জনপ্রিয় মেসেজ = রিয়্যাকশন সংখ্যা + (রিপ্লাই সংখ্যা × ২)।
 * স্কোর বদলাতে চাইলে নিচের `score` লাইনটি এডিট করুন।
 */
export function topMessages(jid, limit = 5, days = 7) {
  const g = getGroup(jid);
  const { ft } = ctx(g.settings);
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
    return { text: `📭 No message got a reaction or reply in the last ${days} days.`, mentions: [] };
  }

  const mentions = new Set();
  const lines = ranked.map((m, i) => {
    mentions.add(m.s);
    const emojis = [...new Set(Object.values(m.r))].slice(0, 3).join('');
    return `${NUM[i]} @${num(m.s)}: "${m.t}"\n    ${emojis} ${m.reactions} reactions • 💬 ${m.q} replies`;
  });

  return {
    text: `🔥 *${ft('Highlights')}* (last ${days} days)\n\n${lines.join('\n\n')}`,
    mentions: [...mentions],
  };
}
