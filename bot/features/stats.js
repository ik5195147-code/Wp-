import { getGroup } from '../lib/store.js';
import { numberOf } from '../lib/utils.js';

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const DAY = 86_400_000;

/**
 * জনপ্রিয় মেসেজ = রিয়্যাকশন সংখ্যা + (রিপ্লাই সংখ্যা × ২)।
 * স্কোর বদলাতে চাইলে নিচের `score` লাইনটি এডিট করুন।
 */
export function topMessages(jid, limit = 5, days = 7) {
  const g = getGroup(jid);
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
      `${NUM[i]} @${numberOf(m.s)}: "${m.t}"\n` +
      `    ${emojis} ${m.reactions} রিয়্যাকশন • 💬 ${m.q} রিপ্লাই`
    );
  });

  return {
    text: `🏆 *টপ মেসেজেস* (শেষ ${days} দিন)\n\n${lines.join('\n\n')}`,
    mentions: [...mentions],
  };
}

/** সবচেয়ে বেশি মেসেজ পাঠানো সদস্যদের তালিকা। */
export function activeMembers(jid, limit = 5) {
  const g = getGroup(jid);
  const top = Object.entries(g.members)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, Math.min(Math.max(limit, 1), 10));

  if (!top.length) return { text: '📭 এখনো কোনো অ্যাক্টিভিটি রেকর্ড হয়নি।', mentions: [] };

  const lines = top.map(([id, v], i) => `${NUM[i]} @${numberOf(id)} — ${v.count}টি মেসেজ`);
  return {
    text: `🔥 *সবচেয়ে সক্রিয় সদস্য*\n\n${lines.join('\n')}`,
    mentions: top.map(([id]) => id),
  };
}
