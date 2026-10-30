import { config } from '../config.js';
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

// ফ্রেমের ভেতরের ডিভাইডার লাইন (নোটিশের দুই অংশ আলাদা করতে)
const DIVS = {
  blossom: '┈┈┈┈┈┈┈┈┈┈┈┈',
  classic: '┈┈┈┈┈┈┈┈┈┈┈┈',
  royal: '✦ ✦ ✦ ✦ ✦ ✦',
  neon: '▁▁▁▁▁▁▁▁▁▁▁▁',
  galaxy: '✧ ✦ ✧ ✦ ✧ ✦',
  cyber: '▪ ▪ ▪ ▪ ▪ ▪',
  candy: '🍬 🍭 🍬 🍭',
  minimal: '· · · · · ·',
};
for (const [k, v] of Object.entries(DIVS)) THEMES[k].div = v;
THEMES.minimal.noBanner = true;

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

/* ------------------------------------------------------------------ */
/* নোটিশ-কার্ড: সব নোটিশের এক ছাঁচ                                       */
/*   ইমোজি-ব্যানার (নোটিশের ধরন অনুযায়ী) → থিম-ফ্রেম → ডিভাইডার → ফুটার     */
/*   নতুন ধরন চাইলে DECO-তে [ইমোজি১, ইমোজি২, প্যাটার্ন] যোগ করুন।            */
/* ------------------------------------------------------------------ */
const DECO = {
  lock: ['🔒', '🔐', 'ABABA'],
  unlock: ['🔓', '🌿', 'ABABA'],
  warn: ['⚠️', '🚧', 'AAAAA'],
  ban: ['🚫', '⛔', 'ABBBA'],
  link: ['🔗', '🚫', 'ABABA'],
  level: ['🎉', '⭐', 'ABABA'],
  verify: ['🛡️', '🔐', 'ABA'],
  ok: ['✅', '🌟', 'ABBBA'],
  bye: ['🥀', '🍂', 'ABABA'],
  welcome: ['🌸', '✨', 'ABABA'],
  admin: ['👑', '💎', 'ABA'],
  info: ['📌', '✨', 'ABA'],
  gift: ['🎁', '🎉', 'ABABA'],
  quiz: ['🧠', '❓', 'ABABA'],
  ai: ['🤖', '✨', 'ABA'],
  afk: ['💤', '🌙', 'ABA'],
  report: ['🚨', '📣', 'ABABA'],
  announce: ['📢', '✨', 'ABABA'],
  daily: ['🎁', '🔥', 'ABA'],
  mute: ['🔇', '🤫', 'ABABA'],
  birthday: ['🎂', '🎈', 'ABABA'],
  translate: ['🌐', '🔤', 'ABA'],
  slow: ['⏱️', '🐢', 'ABA'],
};

/** st.bannerEmoji = [ইমোজি১, ইমোজি২] (.banner দিয়ে সেট) থাকলে সব নোটিশে সেটিই ব্যবহৃত হয়; st.bannerOff = ব্যানার বন্ধ */
function banner(st, th, kind) {
  const custom = Array.isArray(st.bannerEmoji) && st.bannerEmoji.length ? st.bannerEmoji : null;
  if (st.bannerOff || (th.noBanner && !custom)) return '';
  const [a0, b0, pat] = DECO[kind] || DECO.info;
  const [a, b] = custom ? [custom[0], custom[1] || custom[0]] : [a0, b0];
  return [...pat].map((ch) => (ch === 'A' ? a : b)).join(' ');
}

/** lines = ওপরের অংশ, extra = ডিভাইডারের নিচের অংশ, foot = ফ্রেমের বাইরের শেষ লাইন */
export function card(st, { kind = 'info', icon = '', title, lines = [], extra = [], foot = '' }) {
  const { th, ft } = ctx(st);
  const body = extra.length ? [...lines, th.div || '┈┈┈┈┈┈┈┈', ...extra] : lines;
  return [banner(st, th, kind), frame(th, `${icon ? `${icon} ` : ''}${ft(title)}`, body), foot]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------ ট্যাগ অল ------------------------------ */
/** ফেরত দেয় [{ text, mentions }, …] — বড় গ্রুপে একাধিক মেসেজ। */
export function renderTagAll(st, { group, total, note, ids, size = Number.MAX_SAFE_INTEGER }) {
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
export function renderWelcome(st, { ids, group, count, about = '' }) {
  const { th, f, ft, fl, L, fonts } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.welcomeCustom) return styled(st.welcomeCustom, { user, group, count }, fonts.body);

  const [quote, body] = pick(L.quotes);
  return card(st, {
    kind: 'welcome',
    icon: th.accent,
    title: L.welcomeTitle,
    lines: [
      `🙋 ${user}`,
      // একজন যোগ দিলে তার প্রোফাইল ডিটেইলস (নম্বর + About)
      ...(ids.length === 1 ? [`📱 ${fl(L.numberLabel)} : +${num(ids[0])}`] : []),
      ...(ids.length === 1 && about ? [`💬 ${fl(L.aboutLabel)} : ${f(about)}`] : []),
      `🏠 ${fl(L.groupLabel)} : ${ft(group)}`,
      `👥 ${fl(L.memberLabel)} : #${count}`,
      `🕒 ${fl(L.joinedLabel)} : ${stamp()}`,
    ],
    foot: `❝ ${f(quote)} ❞\n${f(body)} ${th.tail}`,
  });
}

export function renderGoodbye(st, { ids, group, count }) {
  const { f, ft, fl, L, fonts } = ctx(st);
  const user = ids.map((i) => `@${num(i)}`).join(' ');
  if (st.goodbyeCustom) return styled(st.goodbyeCustom, { user, group, count }, fonts.body);
  return card(st, {
    kind: 'bye',
    icon: '🥀',
    title: L.goodbyeTitle,
    lines: [
      `🚶 ${user}`,
      `🏠 ${fl(L.groupLabel)} : ${ft(group)}`,
      `👥 ${fl(L.membersLabel)} : ${count}`,
      `🕒 ${fl(L.leftLabel)} : ${stamp()}`,
    ],
    foot: `${f(L.goodbyeBody)} 🍂`,
  });
}

/** ওয়েলকাম-কার্ডের (externalAdReply) শিরোনাম ও সাবটাইটেল */
export function welcomeCardText(st, { group, count, phone = '' }) {
  const { ft, fl, L } = ctx(st);
  return {
    title: `${ft(L.welcomeTitle)}${phone ? ` • +${phone}` : ''}`,
    body: `${ft(group)} • ${fl(L.membersLabel)} ${count}`,
  };
}

/* ------------------------- মিউট / ওপেন নোটিশ ------------------------- */
/** o = { by: যে অ্যাডমিন করেছে, scheduled: true, at: 'HH:MM' } */
function gateCard(st, closed, note, o = {}) {
  const { f, fl, L } = ctx(st);
  const lines = [
    `${closed ? '🔒' : '🔓'} ${fl(L.statusLabel)} : ${f(closed ? L.closedStatus : L.openedStatus)}`,
    ...(o.by ? [`🛡️ ${fl(L.byLabel)} : @${num(o.by)}`] : []),
    o.scheduled ? `⏰ ${fl(L.scheduleLabel)} : ${o.at || stamp()}` : `🕒 ${fl(L.timeLabel)} : ${stamp()}`,
  ];
  return card(st, {
    kind: closed ? 'lock' : 'unlock',
    icon: closed ? '🔒' : '🔓',
    title: closed ? L.closedTitle : L.openedTitle,
    lines,
    extra: note ? [`📝 ${fl(L.noteLabel)} : ${f(note)}`] : [],
    foot: `💬 ${f(closed ? L.closedBody : L.openedBody)}`,
  });
}
export const renderClosed = (st, note = '', o) => gateCard(st, true, note, o);
export const renderOpened = (st, note = '', o) => gateCard(st, false, note, o);

/* ------------------------- মডারেশন নোটিশ ------------------------- */
/** আসল ফোন নম্বর হলে "+8801…", নইলে খালি (LID আইডি ফোন নম্বর নয়, তাই দেখানো হয় না) */
const phoneOf = (jid) => (String(jid || '').endsWith('@s.whatsapp.net') ? `+${num(jid)}` : '');
/** ▰▰▱ — n/max অনুযায়ী প্রগ্রেস */
const dots = (n, max) => '▰'.repeat(Math.min(n, max)) + '▱'.repeat(Math.max(max - n, 0));
/** "28 Oct • 15:40" (TIMEZONE অনুযায়ী) */
export const stamp = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(',', ' •');

/* ------------------------- অ্যান্টি-লিঙ্ক নোটিশ ------------------------- */
/** সদস্য-পরিচয় লাইন: নাম + (আসল ফোন নম্বর থাকলে) নম্বর */
function who(L, fl, user, jid) {
  const phone = phoneOf(jid);
  return [`👤 ${fl(L.userLabel)} : ${user}`, ...(phone ? [`📱 ${fl(L.numberLabel)} : ${phone}`] : [])];
}

/** প্রথম/মাঝের সতর্কতা: মেসেজ ডিলিট হয়েছে, সদস্য এখনো গ্রুপে আছে */
export function renderLinkWarn(st, { user, jid, n, max }) {
  const { f, fl, L, fonts } = ctx(st);
  return card(st, {
    kind: 'link',
    icon: '🚫',
    title: L.linkTitle,
    lines: who(L, fl, user, jid),
    extra: [
      `⚠️ ${fl(L.warningLabel)} : ${n}/${max}  ${dots(n, max)}`,
      `📛 ${fl(L.reasonLabel)} : ${f(L.linkReason)}`,
      `🗑️ ${fl(L.actionLabel)} : ${f(L.linkActionWarn)}`,
    ],
    foot: `❌ ${styled(L.linkWarnFoot, { left: Math.max(max - n, 1) }, fonts.body)}`,
  });
}

/** সীমা পূর্ণ: সদস্যকে রিমুভ করার পর (removed=false হলে রিমুভ ব্যর্থ — অ্যাডমিনকে জানানো হয়) */
export function renderLinkKick(st, { user, jid, n, max, removed = true }) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'ban',
    icon: removed ? '🚪' : '🚨',
    title: removed ? L.linkKickTitle : L.linkFailTitle,
    lines: who(L, fl, user, jid),
    extra: [
      `⚠️ ${fl(L.warningLabel)} : ${n}/${max}  ${dots(n, max)}`,
      `📛 ${fl(L.reasonLabel)} : ${f(L.linkReason)}`,
      `🗑️ ${fl(L.actionLabel)} : ${f(removed ? L.linkActionKick : L.linkActionFail)}`,
    ],
    foot: `${removed ? '🚫' : '⚠️'} ${f(removed ? L.linkKickFoot : L.linkFailFoot)}`,
  });
}

/* ------------------------- অ্যাডমিন ইভেন্ট (promote / demote) ------------------------- */
export function renderAdminEvent(st, { kind, ids, by, adminCount, time }) {
  const { f, fl, L } = ctx(st);
  const up = kind === 'promote';
  const shown = ids.slice(0, 10).map((i) => `${up ? '👑' : '🔻'} @${num(i)}`);
  if (ids.length > shown.length) shown.push(`➕ +${ids.length - shown.length}`);
  return card(st, {
    kind: 'admin',
    icon: up ? '🎉' : '📉',
    title: up ? L.adminNewTitle : L.adminOldTitle,
    lines: shown,
    extra: [
      ...(by ? [`${up ? '⬆️' : '⬇️'} ${fl(up ? L.adminPromotedBy : L.adminDemotedBy)} : @${num(by)}`] : []),
      ...(adminCount > 0 ? [`🛡️ ${fl(L.adminCountLabel)} : ${adminCount}`] : []),
      ...(time ? [`🕒 ${fl(L.timeLabel)} : ${time}`] : []),
    ],
    foot: `${up ? '🌟' : '🙏'} ${f(up ? L.adminNewFoot : L.adminOldFoot)}`,
  });
}

/* ------------------------- মেনশন / ওয়ার্ন নোটিশ ------------------------- */
export function renderMentionWarn(st, user, jid) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'warn',
    icon: '🚫',
    title: L.mentionTitle,
    lines: who(L, fl, user, jid),
    extra: [`📛 ${fl(L.reasonLabel)} : ${f(L.mentionReason)}`, `🗑️ ${fl(L.actionLabel)} : ${f(L.linkActionWarn)}`],
    foot: `❌ ${f(L.mentionFoot)}`,
  });
}

export function renderGroupStatusWarn(st, user, jid) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'warn',
    icon: '🚫',
    title: L.gstatusTitle,
    lines: who(L, fl, user, jid),
    extra: [`📛 ${fl(L.reasonLabel)} : ${f(L.gstatusReason)}`, `🗑️ ${fl(L.actionLabel)} : ${f(L.linkActionWarn)}`],
    foot: `❌ ${f(L.gstatusFoot)}`,
  });
}

/** auto = বট নিজে দিয়েছে (ফ্লাড/ব্যাড-ওয়ার্ড); নইলে `by` অ্যাডমিন */
export function renderWarn(st, { user, jid, by, auto = false, n, max, reason = '', limitHit = false }) {
  const { f, fl, L, fonts } = ctx(st);
  const why = reason ? applyFont(fonts.body, L.reasons?.[reason] ?? reason) : '';
  return card(st, {
    kind: 'warn',
    icon: '⚠️',
    title: L.warnTitle,
    lines: who(L, fl, user, jid),
    extra: [
      `⚠️ ${fl(L.warningLabel)} : ${n}/${max}  ${dots(n, max)}`,
      ...(why ? [`📛 ${fl(L.reasonLabel)} : ${why}`] : []),
      ...(auto ? [`🤖 ${fl(L.byLabel)} : ${f(L.autoMod)}`] : by ? [`👮 ${fl(L.byLabel)} : @${num(by)}`] : []),
    ],
    foot: `⚠️ ${limitHit ? f(L.warnLimitFoot) : styled(L.warnFoot, { left: Math.max(max - n, 1) }, fonts.body)}`,
  });
}

export function renderWarnKick(st, { user, jid, max }) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'ban',
    icon: '🚪',
    title: L.warnKickTitle,
    lines: who(L, fl, user, jid),
    extra: [`⚠️ ${fl(L.warningLabel)} : ${max}/${max}  ${dots(max, max)}`, `🗑️ ${fl(L.actionLabel)} : ${f(L.actRemoved)}`],
    foot: `🚫 ${f(L.warnKickFoot)}`,
  });
}

export function renderSlowMode(st, { user, wait, gap }) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'slow',
    icon: '⏱️',
    title: 'Slow Mode',
    lines: [`👤 ${fl(L.userLabel)} : ${user}`],
    extra: [`⏳ ${fl('Wait')} : ${wait}s`, `🐢 ${fl('Limit')} : 1 message / ${gap}s`, `🗑️ ${fl(L.actionLabel)} : ${f(L.linkActionWarn)}`],
    foot: `⏱️ ${f('Please slow down a little.')}`,
  });
}

/* ------------------------- লেভেল / র‍্যাঙ্ক ------------------------- */
export function renderLevelUp(st, { user, level, xp }) {
  const { f, fl, L } = ctx(st);
  const extra = [];
  if (xp != null) {
    const pr = progress(xp);
    extra.push(`✨ ${fl(L.xpLabel)} : ${xp} / ${pr.next}`, `${bar(pr.pct)} ${pr.pct}%`);
  }
  return card(st, {
    kind: 'level',
    icon: '🎉',
    title: L.levelTitle,
    lines: [`👤 ${fl(L.userLabel)} : ${user}`, `⭐ ${fl(L.levelNew)} : ${level}`],
    extra,
    foot: `🚀 ${f(L.levelFoot)}`,
  });
}

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
export function renderVerify(st, { user, a, b, minutes, prefix }) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'verify',
    icon: '🛡️',
    title: L.verifyTitle,
    lines: [`👤 ${fl(L.userLabel)} : ${user}`],
    extra: [
      `❓ ${fl(L.questionLabel)} : ${a} + ${b} = ?`,
      `⏳ ${fl(L.limitLabel)} : ${minutes} min`,
      `✍️ ${fl(L.replyLabel)} : ${prefix}verify <answer>`,
    ],
    foot: `🛡️ ${f(L.verifyFoot)}`,
  });
}

export function renderVerified(st, user) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'ok',
    icon: '✅',
    title: L.verifiedTitle,
    lines: [`👤 ${fl(L.userLabel)} : ${user}`],
    extra: [`✅ ${fl(L.statusLabel)} : ${f(L.statusVerified)}`],
    foot: `🌟 ${f(L.verifiedFoot)}`,
  });
}

export function renderVerifyKick(st, user) {
  const { f, fl, L } = ctx(st);
  return card(st, {
    kind: 'ban',
    icon: '🚪',
    title: L.verifyKickTitle,
    lines: [`👤 ${fl(L.userLabel)} : ${user}`],
    extra: [`📛 ${fl(L.reasonLabel)} : ${f(L.verifyFailReason)}`, `🗑️ ${fl(L.actionLabel)} : ${f(L.actRemoved)}`],
  });
}

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
