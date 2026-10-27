import { applyFont, styled, FONTS } from './fonts.js';
import { LANG } from './i18n.js';
import { bar, progress } from './xp.js';

/* ------------------------------------------------------------------ */
/* থিম: ফ্রেমের আকৃতি + ইমোজি + ফন্ট-মিশ্রণ (title / label / body)         */
/*  tag: 'info' = GROUP/MEMBERS/MESSAGE বক্স সহ | 'numbered' = নম্বর-তালিকা   */
/*  নতুন থিম বানাতে এখানে একটি এন্ট্রি যোগ করুন।                            */
/* ------------------------------------------------------------------ */
export const THEMES = {
  blossom: {
    label: '🌸 Blossom',
    tag: 'info',
    accent: '🌺',
    tail: '🎀',
    spark: '✨',
    info: '▢',
    side: '│',
    top: (t) => `╭── 「 ${t} 」 ┄┄○`,
    bottom: '╰────────────────○',
    bullets: ['🎈', '🐳', '🍧', '🚩', '🌻', '🍦', '🏳️‍🌈', '💋', '🌸', '🦋', '🍀', '🌙'],
    fonts: { title: 'script', label: 'smallcaps', body: 'bold' },
  },
  classic: {
    label: '📋 Classic',
    tag: 'numbered',
    accent: '✅',
    tail: '👋',
    spark: '✔️',
    info: '▫️',
    side: '│',
    top: (t) => `╭─「 ${t} 」`,
    bottom: '╰─────────────',
    numbered: true,
    fonts: { title: 'bold', label: 'bold', body: 'normal' },
  },
  royal: {
    label: '👑 Royal',
    tag: 'numbered',
    accent: '👑',
    tail: '✨',
    spark: '💎',
    info: '♦️',
    side: '♚',
    top: (t) => `♛━━「 ${t} 」━━♛`,
    bottom: '♛━━━━━━━━━━━━━━♛',
    numbered: true,
    fonts: { title: 'boldfraktur', label: 'smallcaps', body: 'italic' },
  },
  neon: {
    label: '⚡ Neon',
    tag: 'info',
    accent: '⚡',
    tail: '🔥',
    spark: '💥',
    info: '▣',
    side: '▌',
    top: (t) => `▛▀▀「 ${t} 」▀▀▜`,
    bottom: '▙▄▄▄▄▄▄▄▄▄▄▄▄▟',
    bullets: ['⚡'],
    fonts: { title: 'mono', label: 'mono', body: 'bold' },
  },
  galaxy: {
    label: '🌌 Galaxy',
    tag: 'info',
    accent: '🪐',
    tail: '🌠',
    spark: '🔮',
    info: '✦',
    side: '✧',
    top: (t) => `✦━━━ ✧ ${t} ✧ ━━━✦`,
    bottom: '✦━━━━━━━━━━━━━━━━✦',
    bullets: ['🔮', '💜', '🌌', '⭐', '🪐', '💫', '🌙', '✨'],
    fonts: { title: 'bolditalic', label: 'smallcaps', body: 'sansitalic' },
  },
  cyber: {
    label: '🤖 Cyber',
    tag: 'info',
    accent: '🤖',
    tail: '⚙️',
    spark: '🧬',
    info: '◆',
    side: '┃',
    top: (t) => `┏━━【 ${t} 】━━┓`,
    bottom: '┗━━━━━━━━━━━━━━━┛',
    bullets: ['◈'],
    fonts: { title: 'mono', label: 'smallcaps', body: 'serifbold' },
  },
  candy: {
    label: '🍬 Candy',
    tag: 'info',
    accent: '🍓',
    tail: '🍬',
    spark: '🍭',
    info: '🍭',
    side: '│',
    top: (t) => `╭─ 🍭 ${t} 🍭 ─╮`,
    bottom: '╰─ 🍬 🍬 🍬 🍬 🍬 ─╯',
    bullets: ['🍭', '🍬', '🧁', '🍓', '🍩', '🍰', '🍒', '🍪'],
    fonts: { title: 'script', label: 'double', body: 'bold' },
  },
  minimal: {
    label: '▫️ Minimal',
    tag: 'numbered',
    accent: '✨',
    tail: '💫',
    spark: '·',
    info: '•',
    side: '•',
    top: (t) => `— ${t} —`,
    bottom: '',
    fonts: { title: 'bold', label: 'smallcaps', body: 'normal' },
  },
};
export const THEME_NAMES = Object.keys(THEMES);

/* ------------------------------ হেল্পার ------------------------------ */
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * গ্রুপ সেটিংস থেকে থিম, ভাষা ও ফন্ট-ফাংশন বের করে।
 * st.font = 'auto' হলে থিমের নিজস্ব মিশ্রণ; অন্য কিছু হলে সব লেখায় সেই একই ফন্ট।
 *   f = বডি, ft = শিরোনাম, fl = লেবেল
 */
export function ctx(st = {}) {
  const th = THEMES[st.theme] || THEMES.blossom;
  const single = st.font && st.font !== 'auto' && FONTS[st.font] ? st.font : null;
  const fonts = single ? { title: single, label: single, body: single } : th.fonts;
  return {
    th,
    fonts,
    L: LANG[st.lang] || LANG.en,
    f: (s) => applyFont(fonts.body, s),
    ft: (s) => applyFont(fonts.title, s),
    fl: (s) => applyFont(fonts.label, s),
  };
}

/** এক সারি: নম্বর / ইমোজি-বুলেট / সাধারণ — থিম অনুযায়ী */
function row(th, s, i) {
  if (th.numbered) return `${th.side} ${i + 1}. ${s}`;
  return th.bullets ? `${th.side} ${th.bullets[i % th.bullets.length]} ${s}` : `${th.side} ${s}`;
}

/** ফ্রেম: উপরের শিরোনাম, মাঝের লাইনগুলো, নিচের বর্ডার। list=true হলে থিমের bullet/নম্বর ব্যবহার করে। */
export function frame(th, title, lines, { list = false, offset = 0 } = {}) {
  const body = lines.map((s, i) => (list ? row(th, s, offset + i) : `${th.side} ${s}`));
  return [th.top(title), ...body, th.bottom].filter(Boolean).join('\n');
}

/** টেমপ্লেট স্ট্রিং + ভ্যারিয়েবল, বডি-ফন্টে */
const S = (st, key, vars) => {
  const { L, fonts } = ctx(st);
  return styled(L[key], vars, fonts.body);
};

/* ------------------------------ ট্যাগ অল ------------------------------ */
/** ফেরত দেয় [{ text, mentions }, …] — বড় গ্রুপে একাধিক মেসেজ। */
export function renderTagAll(st, { group, total, note, ids, size = 80 }) {
  const { th, f, ft, fl, L } = ctx(st);
  return chunk(ids, size).map((part, ci) => {
    const lines = [];
    if (ci === 0) {
      const msg = note || L.tagDefault;
      if (th.tag === 'info') {
        lines.push(
          `${th.info} ${fl(L.group)} : ${ft(group)}`,
          `${th.info} ${fl(L.membersCaps)} : ${total}`,
          `${th.info} ${fl(L.message)} : ${f(msg)}`,
          '',
        );
      } else {
        lines.push(`📢 ${f(msg)}`, '');
      }
    }
    const title = th.tag === 'info' ? ft(L.tagTitle) : ft(L.listTitle);
    lines.push(
      frame(th, title, part.map((id) => `@${num(id)}`), { list: true, offset: ci * size }),
    );
    return { text: lines.join('\n'), mentions: part };
  });
}

/* ------------------------- ওয়েলকাম / গুডবাই ------------------------- */
export function renderWelcome(st, { ids, group, count }) {
  const { th, f, ft, fl, L, fonts } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.welcomeCustom) return styled(st.welcomeCustom, { user, group, count }, fonts.body);

  const [quote, body] = pick(L.quotes);
  return [
    `${th.accent} ${user} ${th.tail}`,
    `${ft(L.welcomeHead)} ${th.accent}`,
    `${ft(group)} ${th.spark}`,
    '',
    `❝ ${f(quote)} ❞`,
    f(body),
    '',
    `${fl(L.membersLabel)}:> ${count} ${th.tail}`,
  ].join('\n');
}

export function renderGoodbye(st, { ids, group, count }) {
  const { f, ft, fl, L, fonts } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.goodbyeCustom) return styled(st.goodbyeCustom, { user, group, count }, fonts.body);
  return [
    `🥀 ${user}`,
    `${ft(L.goodbyeHead)} 👋`,
    f(L.goodbyeBody),
    '',
    `${fl(L.membersLabel)}:> ${count} 🍂`,
  ].join('\n');
}

/** ওয়েলকাম-কার্ডের (externalAdReply) শিরোনাম ও সাবটাইটেল */
export function welcomeCardText(st, { group, count }) {
  const { ft, fl, L } = ctx(st);
  return { title: ft(group), body: `${fl(L.membersLabel)} • ${count}` };
}

/* ------------------------- মিউট / ওপেন নোটিশ ------------------------- */
export function renderClosed(st, note = '') {
  const { f, ft, L } = ctx(st);
  return ['🔒 *' + ft(L.closedTitle) + '*', '', f(L.closedBody), ...(note ? ['', f(note)] : [])].join('\n');
}
export function renderOpened(st, note = '') {
  const { f, ft, L } = ctx(st);
  return ['🔓 *' + ft(L.openedTitle) + '*', '', f(L.openedBody), ...(note ? ['', f(note)] : [])].join('\n');
}

/* ------------------------- মডারেশন নোটিশ ------------------------- */
export const renderLinkKick = (st, user) => `🚫 ${S(st, 'linkKick', { user })}`;
export const renderLinkWarn = (st, user, n, max) => `🚫 ${S(st, 'linkWarn', { user, n, max })}`;
export const renderMentionWarn = (st, user) => `🚫 ${S(st, 'mentionWarn', { user })}`;

export function renderWarn(st, { user, n, max, reason = '', limitHit = false }) {
  const { L, fonts } = ctx(st);
  const why = reason ? applyFont(fonts.body, L.reasons?.[reason] ?? reason) : '';
  return [
    `⚠️ ${S(st, limitHit ? 'warnLimitHit' : 'warnLine', { user, n, max })}`,
    ...(why ? [`📝 ${styled(L.warnReason, { reason: why }, fonts.body)}`] : []),
  ].join('\n');
}
export const renderWarnKick = (st, { user, max }) => `🚫 ${S(st, 'warnKick', { user, max })}`;

/* ------------------------- লেভেল / র‍্যাঙ্ক ------------------------- */
export const renderLevelUp = (st, { user, level }) => `🎉 ${S(st, 'levelUp', { user, lvl: level })}`;

export function renderRankCard(st, { user, rank, total, xp, count }) {
  const { th, ft, fl, L } = ctx(st);
  const pr = progress(xp);
  return [
    `🎖️ *${ft(L.cardTitle)}*`,
    frame(th, user, [
      `🏅 ${fl(L.rankLabel)} : #${rank} / ${total}`,
      `⭐ ${fl(L.levelLabel)} : ${pr.level}`,
      `✨ ${fl(L.xpLabel)} : ${xp} / ${pr.next}`,
      `${bar(pr.pct)} ${pr.pct}%`,
      `💬 ${fl(L.msgLabel)} : ${count}`,
    ]),
  ].join('\n');
}

export function renderXpBoard(st, rows) {
  const { th, ft, L, fonts } = ctx(st);
  if (!rows.length) return `📭 ${ctx(st).f(L.rankEmpty)}`;
  const lines = rows.map(
    (r, i) =>
      `${MEDALS[i] || `${i + 1}.`} ${styled(L.xpRow, { user: `@${num(r.id)}`, lvl: r.level, xp: r.xp }, fonts.body)}`,
  );
  return [`🏆 *${styled(L.xpTitle, { n: rows.length }, fonts.title)}*`, '', frame(th, ft(L.boardTitle), lines)].join('\n');
}

/* ------------------------- ভেরিফিকেশন ------------------------- */
export const renderVerify = (st, { user, a, b, minutes, prefix }) =>
  `🛡️ ${S(st, 'verifyAsk', { user, a, b, m: minutes, p: prefix })}`;
export const renderVerified = (st, user) => `✅ ${S(st, 'verifyOk', { user })}`;
export const renderVerifyKick = (st, user) => `🚪 ${S(st, 'verifyKick', { user })}`;

/* ------------------------- র‍্যাঙ্কিং (.top) ------------------------- */
const MEDALS = ['🥇', '🥈', '🥉'];

export function renderRanking(st, rows, limit, prefix) {
  const { th, f, ft, L, fonts } = ctx(st);
  if (!rows.length) return `📭 ${f(L.rankEmpty)}`;
  const lines = rows.map(
    (r, i) =>
      `${MEDALS[i] || `${i + 1}.`} ${styled(L.rankRow, { user: `@${num(r.id)}`, c: r.count }, fonts.body)}`,
  );
  return [
    `🏆 *${styled(L.rankTitle, { n: rows.length }, fonts.title)}*`,
    '',
    frame(th, ft(L.boardTitle), lines),
    '',
    styled(L.rankHint, { p: prefix }, fonts.body),
  ].join('\n');
}

/* ------------------------- ফিচার প্যানেল (.help) ------------------------- */
export function renderFeaturePanel(st, features) {
  const { th, f, ft } = ctx(st);
  const lines = features.map((ft2, i) => `${i + 1}. ${f(ft2.label)} ${st[ft2.key] ? '✅' : '❌'}`);
  return frame(th, ft('Features'), lines);
}
