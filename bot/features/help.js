import { config } from '../config.js';
import { getGroup } from '../lib/store.js';
import { FEATURES } from '../lib/features.js';
import { ctx, frame, renderFeaturePanel, THEMES } from '../lib/render.js';

/** হেল্প মেসেজের টেক্সট: গ্রুপের নিজস্ব থিম/ফন্ট, নিয়ম, ফিচার-প্যানেল ও কমান্ড তালিকা। */
export function helpText(jid) {
  const p = config.prefix;
  const isGroup = jid?.endsWith('@g.us');
  const st = isGroup ? getGroup(jid).settings : config.defaults;
  const { th, f } = ctx(st);
  const sec = (title, lines) => frame(th, f(title), lines);

  return [
    `📌 *${f(config.botName)} • ${f('Help Center')}*`,
    '',
    sec('Rules', String(st.rules).split('\n')),
    '',
    renderFeaturePanel(st, FEATURES),
    `⚙️ অ্যাডমিন: ${p}help <নম্বর/নাম> on|off`,
    `    যেমন ${p}help 1 on • ${p}help antilink off • ${p}help all off`,
    '',
    sec('Security (Admin)', [
      `${p}mute [বার্তা] / ${p}close — গ্রুপ বন্ধ`,
      `${p}unmute / ${p}open — গ্রুপ খোলা`,
      `${p}antilink | ${p}antisticker | ${p}antimention on|off`,
    ]),
    '',
    sec('Manage (Admin)', [
      `${p}tagall [বার্তা] — সবাইকে ট্যাগ`,
      `${p}kickall — সব সাধারণ সদস্য রিমুভ (ক্রিয়েটর/মালিক)`,
      `${p}setwelcome | ${p}setgoodbye | ${p}setrules <টেক্সট> (reset = ডিফল্ট)`,
      `${p}adminlog [সংখ্যা] — অ্যাডমিন অ্যাক্টিভিটি`,
      `${p}preview welcome|goodbye|tagall|mute — ডিজাইন প্রিভিউ`,
    ]),
    '',
    sec('Design (Admin)', [
      `🎨 ${THEMES[st.theme]?.label || st.theme} • Font: ${st.font} • Lang: ${st.lang}`,
      `${p}theme [নাম] • ${p}font [নাম] • ${p}lang en|bn`,
    ]),
    '',
    sec('Everyone', [
      `${p}top [সংখ্যা] — সবচেয়ে সক্রিয় সদস্য`,
      `${p}highlights — জনপ্রিয় মেসেজ`,
      `${p}play <গান> • ${p}yts <গান> • ${p}spotify <গান>`,
      `${p}help — এই তালিকা`,
    ]),
  ].join('\n');
}

/**
 * হেল্প নোটিশ পাঠায়। externalAdReply দিয়ে "কার্ড"-এর মতো দেখায়।
 * এটি অনানুষ্ঠানিক ফিচার — কোনো ভার্সনে না দেখালে সাধারণ টেক্সটে ফলব্যাক হয়।
 */
export async function sendHelp(sock, jid, quoted) {
  const text = helpText(jid);
  const card = {
    title: `${config.botName} • Help`,
    body: 'Rules, features & commands',
    mediaType: 1,
    renderLargerThumbnail: false,
    ...(config.helpLink ? { sourceUrl: config.helpLink } : {}),
  };
  try {
    await sock.sendMessage(
      jid,
      { text, contextInfo: { externalAdReply: card } },
      quoted ? { quoted } : undefined,
    );
  } catch {
    await sock.sendMessage(jid, { text });
  }
        }
