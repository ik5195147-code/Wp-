import { config } from '../config.js';
import { getGroup } from '../lib/store.js';

/** হেল্প মেসেজের টেক্সট বানায় (গ্রুপের নিজস্ব নিয়ম ও চালু/বন্ধ অবস্থা সহ)। */
export function helpText(jid) {
  const p = config.prefix;
  const isGroup = jid?.endsWith('@g.us');
  const s = isGroup ? getGroup(jid).settings : config.defaults;
  const flag = (k) => (s[k] ? '✅' : '❌');

  return [
    `📌 *${config.botName} • হেল্প সেন্টার*`,
    '━━━━━━━━━━━━━━━━━━',
    '📜 *গ্রুপের নিয়মাবলী*',
    s.rules,
    '',
    '🛡️ *সিকিউরিটি (অ্যাডমিন)*',
    `• ${p}antilink on|off ${flag('antilink')} — লিঙ্ক ডিলিট + অটো-কিক`,
    `• ${p}antisticker on|off ${flag('antisticker')} — স্টিকার ডিলিট`,
    `• ${p}antimention on|off ${flag('antimention')} — মাস-মেনশন ডিলিট`,
    `• ${p}mute / ${p}unmute — গ্রুপ মিউট / আনমিউট`,
    '',
    '📣 *গ্রুপ ম্যানেজমেন্ট (অ্যাডমিন)*',
    `• ${p}tagall [বার্তা] — সবাইকে ট্যাগ`,
    `• ${p}kickall — সব সাধারণ সদস্য রিমুভ (শুধু ক্রিয়েটর/মালিক, কনফার্মেশন লাগে)`,
    `• ${p}welcome on|off ${flag('welcome')} • ${p}goodbye on|off ${flag('goodbye')}`,
    `• ${p}setwelcome <টেক্সট> — প্লেসহোল্ডার: {user} {group} {count}`,
    `• ${p}setgoodbye <টেক্সট> • ${p}setrules <নিয়ম>`,
    `• ${p}adminlog [সংখ্যা] — অ্যাডমিন অ্যাক্টিভিটি লগ`,
    `• ${p}adminnotify on|off ${flag('adminlog')} — অ্যাডমিন ইভেন্ট নোটিফিকেশন`,
    '',
    '🏆 *সবার জন্য*',
    `• ${p}top [সংখ্যা] — জনপ্রিয় মেসেজ (শেষ ৭ দিন)`,
    `• ${p}active — সবচেয়ে সক্রিয় সদস্য`,
    `• ${p}play <গান> — YouTube এ গান খুঁজে লিঙ্ক ও কভার পাঠায়`,
    `• ${p}yts <গান> — YouTube এর ৫টি ফলাফল`,
    `• ${p}spotify <গান> — Spotify ট্র্যাক সার্চ`,
    `• ${p}help — এই তালিকা`,
  ].join('\n');
}

/**
 * হেল্প নোটিশ পাঠায়। externalAdReply দিয়ে "কার্ড"-এর মতো দেখায়।
 * এটি অনানুষ্ঠানিক ফিচার — কোনো ভার্সনে না দেখালে সাধারণ টেক্সটে ফলব্যাক হয়।
 */
export async function sendHelp(sock, jid, quoted) {
  const text = helpText(jid);
  const card = {
    title: `${config.botName} • হেল্প`,
    body: 'গ্রুপের নিয়ম ও কমান্ড তালিকা',
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
