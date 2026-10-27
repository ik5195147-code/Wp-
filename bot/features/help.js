import { config } from '../config.js';
import { getGroup } from '../lib/store.js';
import { FEATURES } from '../lib/features.js';
import { ctx, frame, renderFeaturePanel, THEMES } from '../lib/render.js';

/** হেল্প মেসেজের টেক্সট: গ্রুপের নিজস্ব থিম/ফন্ট, নিয়ম, ফিচার-প্যানেল ও কমান্ড তালিকা। */
export function helpText(jid) {
  const p = config.prefix;
  const isGroup = jid?.endsWith('@g.us');
  const st = isGroup ? getGroup(jid).settings : config.defaults;
  const { th, f, ft } = ctx(st);
  const sec = (title, lines) => frame(th, ft(title), lines);

  return [
    `📌 *${ft(config.botName)} • ${ft('Help Center')}*`,
    '',
    sec('Rules', String(st.rules).split('\n')),
    '',
    renderFeaturePanel(st, FEATURES),
    `⚙️ Admins: ${p}help <number|name> on|off`,
    `    e.g. ${p}help 1 on • ${p}help antilink off • ${p}help all off`,
    '',
    sec('Security (Admin)', [
      `${p}mute [note] / ${p}close — close the group`,
      `${p}unmute / ${p}open — open the group`,
      `${p}autoclose 23:00 06:00 — daily close/open times (off to stop)`,
      `${p}warn @user [reason] • ${p}resetwarn @user`,
      `${p}addword <words> • ${p}delword <word> • ${p}words`,
      `${p}kick @user • ${p}promote @user • ${p}demote @user`,
    ]),
    '',
    sec('Manage (Admin)', [
      `${p}tagall [message] — tag everyone`,
      `${p}hidetag <text> — tag everyone silently`,
      `${p}kickall — remove all regular members (creator/owner)`,
      `${p}setwelcome | ${p}setgoodbye | ${p}setrules <text> (reset = default)`,
      `${p}adminlog [n] — recent admin activity`,
      `${p}link — group invite link`,
    ]),
    '',
    sec('Design (Admin)', [
      `🎨 ${THEMES[st.theme]?.label || st.theme} • Font: ${st.font} • Lang: ${st.lang} • Welcome: ${st.welcomeStyle}`,
      `${p}theme [name] • ${p}font [name] • ${p}lang en|bn`,
      `${p}welcomestyle card|photo|text`,
      `${p}preview welcome|goodbye|tagall|mute|rank|warn|levelup`,
    ]),
    '',
    sec('Everyone', [
      `${p}rank [@user] — your level card`,
      `${p}leaderboard — XP ranking`,
      `${p}top [n] — most active members`,
      `${p}highlights — popular messages`,
      `${p}warns — your warnings • ${p}rules • ${p}info • ${p}ping`,
      `${p}verify <answer> — new-member check`,
      `${p}play <song> • ${p}yts <song> • ${p}spotify <song>`,
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
