import { applyFont, styled } from './fonts.js';
import { LANG } from './i18n.js';

/* ------------------------------------------------------------------ */
/* থিম: ফ্রেমের আকৃতি + ইমোজি। নতুন থিম যোগ করতে THEMES-এ একটি এন্ট্রি দিন।   */
/*  tag: 'info' = GROUP/MEMBERS/MESSAGE বক্স সহ | 'numbered' = নম্বর-তালিকা      */
/* ------------------------------------------------------------------ */
const BULLETS = ['🎈', '🐳', '🍧', '🚩', '🌻', '🍦', '🏳️‍🌈', '💋', '🌸', '🦋', '🍀', '🌙'];

export const THEMES = {
  blossom: {
    label: '🌸 Blossom',
    tag: 'info',
    accent: '🌺',
    tail: '🎀',
    info: '▢',
    side: '│',
    top: (t) => `╭── 「 ${t} 」 ┄┄○`,
    row: (s, i) => `│ ${BULLETS[i % BULLETS.length]} ${s}`,
    bottom: '╰────────────────○',
  },
  classic: {
    label: '📋 Classic',
    tag: 'numbered',
    accent: '✅',
    tail: '👋',
    info: '▫️',
    side: '│',
    top: (t) => `╭─「 ${t} 」`,
    row: (s, i) => `│ ${i + 1}. ${s}`,
    bottom: '╰─────────────',
  },
  royal: {
    label: '👑 Royal',
    tag: 'numbered',
    accent: '👑',
    tail: '✨',
    info: '♦️',
    side: '♚',
    top: (t) => `♛━━「 ${t} 」━━♛`,
    row: (s, i) => `♚ ${i + 1}. ${s}`,
    bottom: '♛━━━━━━━━━━━━━━♛',
  },
  neon: {
    label: '⚡ Neon',
    tag: 'info',
    accent: '⚡',
    tail: '🔥',
    info: '▣',
    side: '▌',
    top: (t) => `▛▀▀「 ${t} 」▀▀▜`,
    row: (s) => `▌⚡ ${s}`,
    bottom: '▙▄▄▄▄▄▄▄▄▄▄▄▄▟',
  },
  minimal: {
    label: '▫️ Minimal',
    tag: 'numbered',
    accent: '✨',
    tail: '💫',
    info: '•',
    side: '•',
    top: (t) => `— ${t} —`,
    row: (s) => `• ${s}`,
    bottom: '',
  },
};
export const THEME_NAMES = Object.keys(THEMES);

/* ------------------------------ হেল্পার ------------------------------ */
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** গ্রুপ সেটিংস থেকে থিম, ফন্ট-ফাংশন ও ভাষা বের করে। */
export function ctx(st = {}) {
  return {
    th: THEMES[st.theme] || THEMES.blossom,
    L: LANG[st.lang] || LANG.en,
    font: st.font || 'normal',
    f: (s) => applyFont(st.font || 'normal', s),
  };
}

/** ফ্রেম: উপরের শিরোনাম, মাঝের লাইনগুলো, নিচের বর্ডার। list=true হলে থিমের bullet/নম্বর ব্যবহার করে। */
export function frame(th, title, lines, { list = false, offset = 0 } = {}) {
  const body = lines.map((s, i) => (list ? th.row(s, offset + i) : `${th.side} ${s}`));
  return [th.top(title), ...body, th.bottom].filter(Boolean).join('\n');
}

/* ------------------------------ ট্যাগ অল ------------------------------ */
/** ফেরত দেয় [{ text, mentions }, …] — বড় গ্রুপে একাধিক মেসেজ। */
export function renderTagAll(st, { group, total, note, ids, size = 80 }) {
  const { th, f, L } = ctx(st);
  return chunk(ids, size).map((part, ci) => {
    const lines = [];
    if (ci === 0) {
      const msg = note || L.tagDefault;
      if (th.tag === 'info') {
        lines.push(
          `${th.info} ${f(L.group)} : ${f(group)}`,
          `${th.info} ${f(L.membersCaps)} : ${total}`,
          `${th.info} ${f(L.message)} : ${f(msg)}`,
          '',
        );
      } else {
        lines.push(`📢 ${f(msg)}`, '');
      }
    }
    const title = th.tag === 'info' ? f(L.tagTitle) : f(L.listTitle);
    lines.push(
      frame(
        th,
        title,
        part.map((id) => `@${num(id)}`),
        { list: true, offset: ci * size },
      ),
    );
    return { text: lines.join('\n'), mentions: part };
  });
}

/* ------------------------- ওয়েলকাম / গুডবাই ------------------------- */
export function renderWelcome(st, { ids, group, count }) {
  const { th, f, L } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.welcomeCustom) return styled(st.welcomeCustom, { user, group, count }, st.font);

  const [quote, body] = pick(L.quotes);
  return [
    `${th.accent} ${user} ${th.tail}`,
    `${f(L.welcomeHead)} ${th.accent}`,
    `${f(group)} ✨`,
    '',
    `❝ ${f(quote)} ❞`,
    f(body),
    '',
    `${f(L.membersLabel)}:> ${count} ${th.tail}`,
  ].join('\n');
}

export function renderGoodbye(st, { ids, group, count }) {
  const { f, L } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.goodbyeCustom) return styled(st.goodbyeCustom, { user, group, count }, st.font);
  return [
    `🥀 ${user}`,
    `${f(L.goodbyeHead)} 👋`,
    f(L.goodbyeBody),
    '',
    `${f(L.membersLabel)}:> ${count} 🍂`,
  ].join('\n');
}

/* ------------------------- মিউট / ওপেন নোটিশ ------------------------- */
export function renderClosed(st, note = '') {
  const { f, L } = ctx(st);
  return ['🔒 *' + f(L.closedTitle) + '*', '', f(L.closedBody), ...(note ? ['', f(note)] : [])].join('\n');
}
export function renderOpened(st) {
  const { f, L } = ctx(st);
  return ['🔓 *' + f(L.openedTitle) + '*', '', f(L.openedBody)].join('\n');
}

/* ------------------------- মডারেশন নোটিশ ------------------------- */
export const renderLinkKick = (st, user) => `🚫 ${styled(ctx(st).L.linkKick, { user }, st.font)}`;
export const renderLinkWarn = (st, user, n, max) =>
  `🚫 ${styled(ctx(st).L.linkWarn, { user, n, max }, st.font)}`;
export const renderMentionWarn = (st, user) => `🚫 ${styled(ctx(st).L.mentionWarn, { user }, st.font)}`;

/* ------------------------- র‍্যাঙ্কিং (.top) ------------------------- */
const MEDALS = ['🥇', '🥈', '🥉'];

export function renderRanking(st, rows, limit, prefix) {
  const { th, f, L } = ctx(st);
  if (!rows.length) return `📭 ${f(L.rankEmpty)}`;
  const lines = rows.map(
    (r, i) =>
      `${MEDALS[i] || `${i + 1}.`} ${styled(L.rankRow, { user: `@${num(r.id)}`, c: r.count }, st.font)}`,
  );
  return [
    `🏆 *${styled(L.rankTitle, { n: rows.length }, st.font)}*`,
    '',
    frame(th, f(L.boardTitle), lines),
    '',
    styled(L.rankHint, { p: prefix }, st.font),
  ].join('\n');
}

/* ------------------------- ফিচার প্যানেল (.help) ------------------------- */
export function renderFeaturePanel(st, features) {
  const { th, f } = ctx(st);
  const lines = features.map((ft, i) => `${i + 1}. ${f(ft.label)} ${st[ft.key] ? '✅' : '❌'}`);
  return frame(th, f('Features'), lines);
}
