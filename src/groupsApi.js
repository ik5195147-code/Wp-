import express from 'express';
import { config } from '../bot/config.js';
import { getGroup, groupIds, persist, isPrivate, setPrivate } from '../bot/lib/store.js';
import { FEATURES } from '../bot/lib/features.js';
import { FONT_NAMES, applyFont } from '../bot/lib/fonts.js';
import { LANG_NAMES } from '../bot/lib/i18n.js';
import {
  THEMES,
  THEME_NAMES,
  stamp,
  renderWelcome,
  renderGoodbye,
  renderClosed,
  renderOpened,
  renderWarn,
  renderWarnKick,
  renderLinkWarn,
  renderLinkKick,
  renderMentionWarn,
  renderLevelUp,
  renderVerify,
  renderVerified,
  renderAdminEvent,
} from '../bot/lib/render.js';

/**
 * ড্যাশবোর্ডের গ্রুপ-সেটিং API (সবই লগইন-সুরক্ষিত — server.js এ requireAuth এর পরে মাউন্ট করা)।
 * বট ও ড্যাশবোর্ড একই প্রসেসে চলে, তাই এখানে বদলালে বটে সাথে সাথে কার্যকর হয়।
 * শুধু নির্দিষ্ট (হোয়াইটলিস্ট করা) ফিল্ড বদলানো যায়, প্রতিটির মান যাচাই করা হয়।
 */
export const groupsRouter = express.Router();

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const h = (fn) => (req, res) => {
  try {
    res.json(fn(req, res));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};

const JID_RE = /^[0-9]+(-[0-9]+)?@g\.us$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WELCOME_STYLES = ['card', 'photo', 'text'];
const FEATURE_KEYS = FEATURES.map((f) => f.key);
const TEXT_KEYS = ['theme', 'font', 'lang', 'welcomeStyle', 'slowSeconds', 'rules', 'welcomeCustom', 'goodbyeCustom', 'bannerOff', 'bannerEmoji'];

/** শুধু বট যে গ্রুপ চেনে সেটিই; getGroup() অচেনা jid-এর জন্য নতুন এন্ট্রি বানিয়ে ফেলত */
function groupOf(jid) {
  if (!JID_RE.test(jid) || !groupIds().includes(jid)) throw fail('গ্রুপটি পাওয়া যায়নি', 404);
  return getGroup(jid);
}

/* ----------------------------- যাচাই ----------------------------- */
function text(v, max, name, { allowEmpty = true } = {}) {
  if (typeof v !== 'string') throw fail(`${name}: লেখা দিতে হবে`);
  const t = v.trim();
  if (t.length > max) throw fail(`${name}: সর্বোচ্চ ${max} অক্ষর`);
  if (!allowEmpty && !t) throw fail(`${name}: ফাঁকা রাখা যাবে না`);
  return t;
}

/** settings অবজেক্টের প্রতিটি কী যাচাই করে শুধু ঠিক মানগুলো ফেরত দেয় */
function cleanSettings(input = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw fail('settings ভুল ফরম্যাটে');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (FEATURE_KEYS.includes(k)) {
      if (typeof v !== 'boolean') throw fail(`${k}: true/false হতে হবে`);
      out[k] = v;
      continue;
    }
    switch (k) {
      case 'theme':
        if (!THEME_NAMES.includes(v)) throw fail('অচেনা থিম');
        out.theme = v;
        break;
      case 'font':
        if (v !== 'auto' && !FONT_NAMES.includes(v)) throw fail('অচেনা ফন্ট');
        out.font = v;
        break;
      case 'lang':
        if (!LANG_NAMES.includes(v)) throw fail('অচেনা ভাষা');
        out.lang = v;
        break;
      case 'welcomeStyle':
        if (!WELCOME_STYLES.includes(v)) throw fail('অচেনা ওয়েলকাম স্টাইল');
        out.welcomeStyle = v;
        break;
      case 'slowSeconds':
        if (!Number.isInteger(v) || v < 2 || v > 600) throw fail('স্লো-মোড: ২–৬০০ সেকেন্ড');
        out.slowSeconds = v;
        break;
      case 'rules':
        out.rules = text(v, 600, 'নিয়ম') || config.defaults.rules;
        break;
      case 'welcomeCustom':
      case 'goodbyeCustom':
        out[k] = text(v, 500, k);
        break;
      case 'bannerOff':
        if (typeof v !== 'boolean') throw fail('bannerOff: true/false হতে হবে');
        out.bannerOff = v;
        break;
      case 'bannerEmoji': {
        if (!Array.isArray(v) || v.length > 2) throw fail('ব্যানার: সর্বোচ্চ ২টি ইমোজি');
        const ok = v.every((e) => typeof e === 'string' && e.length <= 16 && /\p{Extended_Pictographic}/u.test(e));
        if (!ok) throw fail('ব্যানারে শুধু ইমোজি দিন');
        out.bannerEmoji = v;
        break;
      }
      default:
        throw fail(`অনুমোদিত নয়: ${k}`);
    }
  }
  return out;
}

const list = (v, max, name) => {
  if (!Array.isArray(v) || v.length > max) throw fail(`${name}: সর্বোচ্চ ${max}টি`);
  return v;
};

/* ----------------------------- স্ন্যাপশট ----------------------------- */
function snapshot(jid) {
  const g = groupOf(jid);
  const s = g.settings;
  const settings = {};
  for (const k of [...FEATURE_KEYS, ...TEXT_KEYS]) if (s[k] !== undefined) settings[k] = s[k];
  return {
    jid,
    name: g.name || jid.split('@')[0],
    settings,
    badwords: g.badwords,
    countryCodes: g.countryCodes,
    blacklist: g.blacklist.map((b) => ({ n: b.n, reason: b.reason || '', ts: b.ts })),
    autoreplies: g.autoreplies.map((x) => ({ k: x.k, r: x.r })),
    announcements: g.announcements.map((x) => ({ at: x.at, text: x.text })),
    schedule: { close: g.schedule?.close || '', open: g.schedule?.open || '' },
    stats: {
      members: Object.keys(g.members).length,
      warned: Object.keys(g.warnings).length,
      afk: Object.keys(g.afk).length,
      tmuted: Object.keys(g.tmutes).length,
    },
  };
}

/* ----------------------------- নোটিশ প্রিভিউ ----------------------------- */
const U = '8801700000001@s.whatsapp.net';
const PREVIEWS = {
  welcome: (st) => renderWelcome(st, { ids: [U], group: 'Blooming Vibes', count: 712 }),
  goodbye: (st) => renderGoodbye(st, { ids: [U], group: 'Blooming Vibes', count: 711 }),
  closed: (st) => renderClosed(st, 'Night break', { by: U }),
  opened: (st) => renderOpened(st, '', { by: U }),
  warn: (st) => renderWarn(st, { user: '@8801700000001', jid: U, auto: true, n: 1, max: config.warnLimit, reason: 'flood' }),
  warnkick: (st) => renderWarnKick(st, { user: '@8801700000001', jid: U, max: config.warnLimit }),
  linkwarn: (st) => renderLinkWarn(st, { user: '@8801700000001', jid: U, n: 1, max: 3 }),
  linkkick: (st) => renderLinkKick(st, { user: '@8801700000001', jid: U, n: 3, max: 3 }),
  mention: (st) => renderMentionWarn(st, '@8801700000001', U),
  levelup: (st) => renderLevelUp(st, { user: '@8801700000001', level: 5, xp: 2640 }),
  verify: (st) => renderVerify(st, { user: '@8801700000001', a: 4, b: 7, minutes: config.verifyMinutes, prefix: config.prefix }),
  verified: (st) => renderVerified(st, '@8801700000001'),
  promote: (st) => renderAdminEvent(st, { kind: 'promote', ids: [U], by: '8801700000002@s.whatsapp.net', adminCount: 4, time: stamp() }),
  demote: (st) => renderAdminEvent(st, { kind: 'demote', ids: [U], by: '8801700000002@s.whatsapp.net', adminCount: 3, time: stamp() }),
};

/* ----------------------------- রুট ----------------------------- */
groupsRouter.get(
  '/meta',
  h(() => ({
    features: FEATURES.map(({ key, label, desc, needsBotAdmin }) => ({ key, label, desc, needsBotAdmin: !!needsBotAdmin })),
    themes: THEME_NAMES.map((id) => ({ id, label: THEMES[id].label })),
    fonts: ['auto', ...FONT_NAMES].map((id) => ({ id, sample: id === 'auto' ? "Each theme's own mix" : applyFont(id, 'Blooming Vibes 123') })),
    langs: LANG_NAMES,
    welcomeStyles: WELCOME_STYLES,
    previews: Object.keys(PREVIEWS),
    bot: { private: isPrivate(), prefix: config.prefix, timeZone: config.timeZone, owners: config.owners.length },
    ai: { ready: Boolean(config.geminiKey), model: config.geminiModel },
  })),
);

groupsRouter.post(
  '/bot-mode',
  h((req) => {
    if (typeof req.body?.private !== 'boolean') throw fail('private: true/false হতে হবে');
    setPrivate(req.body.private);
    return { private: isPrivate() };
  }),
);

groupsRouter.get(
  '/groups',
  h(() => ({
    groups: groupIds()
      .filter((j) => JID_RE.test(j))
      .map((jid) => {
        const g = getGroup(jid);
        return {
          jid,
          name: g.name || jid.split('@')[0],
          members: Object.keys(g.members).length,
          enabled: FEATURES.filter((f) => g.settings[f.key]).length,
          total: FEATURES.length,
          theme: g.settings.theme,
        };
      }),
  })),
);

groupsRouter.get('/groups/:jid', h((req) => snapshot(req.params.jid)));

groupsRouter.post(
  '/groups/:jid',
  h((req) => {
    const g = groupOf(req.params.jid);
    const b = req.body || {};
    const known = ['settings', 'badwords', 'countryCodes', 'blacklistRemove', 'blacklistAdd', 'autoreplies', 'announcements', 'schedule'];
    for (const k of Object.keys(b)) if (!known.includes(k)) throw fail(`অনুমোদিত নয়: ${k}`);

    // ১) সব যাচাই আগে — কোনোটা ভুল হলে কিছুই বদলাবে না
    const settings = b.settings !== undefined ? cleanSettings(b.settings) : null;

    let badwords = null;
    if (b.badwords !== undefined) {
      badwords = [...new Set(list(b.badwords, 200, 'নিষিদ্ধ শব্দ').map((w) => text(w, 40, 'শব্দ').toLowerCase()).filter(Boolean))];
    }

    let codes = null;
    if (b.countryCodes !== undefined) {
      codes = [...new Set(list(b.countryCodes, 10, 'দেশের কোড').map((c) => String(c).replace(/\D/g, '')))];
      if (!codes.every((c) => /^\d{1,4}$/.test(c))) throw fail('দেশের কোড ১–৪ অঙ্কের সংখ্যা হতে হবে (যেমন 880)');
    }

    let blacklist = null;
    if (b.blacklistRemove !== undefined || b.blacklistAdd !== undefined) {
      const rm = new Set(list(b.blacklistRemove ?? [], 200, 'ব্ল্যাকলিস্ট').map((n) => String(n).replace(/\D/g, '')));
      const add = list(b.blacklistAdd ?? [], 50, 'ব্ল্যাকলিস্ট').map((n) => String(n).replace(/\D/g, ''));
      if (!add.every((n) => /^\d{6,15}$/.test(n))) throw fail('নম্বর ৬–১৫ অঙ্কের হতে হবে (দেশের কোডসহ)');
      blacklist = g.blacklist.filter((x) => !rm.has(x.n));
      for (const n of add) if (!blacklist.some((x) => x.n === n)) blacklist.push({ n, ts: Date.now(), by: 'dashboard', reason: '' });
      if (blacklist.length > 500) throw fail('ব্ল্যাকলিস্ট: সর্বোচ্চ ৫০০টি');
    }

    let replies = null;
    if (b.autoreplies !== undefined) {
      replies = list(b.autoreplies, 50, 'অটো-রিপ্লাই').map((x) => ({
        k: text(x?.k, 40, 'কীওয়ার্ড', { allowEmpty: false }).toLowerCase(),
        r: text(x?.r, 500, 'উত্তর', { allowEmpty: false }),
      }));
    }

    let ann = null;
    if (b.announcements !== undefined) {
      ann = list(b.announcements, 5, 'শিডিউল-মেসেজ').map((x, i) => {
        if (!HHMM.test(String(x?.at))) throw fail('শিডিউলের সময় HH:MM (২৪ ঘণ্টা) ফরম্যাটে দিন');
        const old = g.announcements.find((o) => o.at === x.at && o.text === String(x.text).trim());
        return { id: i + 1, at: x.at, text: text(x.text, 500, 'ঘোষণা', { allowEmpty: false }), last: old?.last || '' };
      });
    }

    let schedule = null;
    if (b.schedule !== undefined) {
      const { close = '', open = '' } = b.schedule || {};
      if (close === '' && open === '') schedule = {};
      else if (!HHMM.test(close) || !HHMM.test(open) || close === open) throw fail('অটো-ক্লোজ: দুটো আলাদা সময় দিন (HH:MM) অথবা দুটোই ফাঁকা রাখুন');
      else schedule = { close, open };
    }

    // ২) সব ঠিক থাকলে প্রয়োগ
    if (settings) {
      Object.assign(g.settings, settings);
      if (settings.bannerEmoji && !settings.bannerEmoji.length) delete g.settings.bannerEmoji;
    }
    if (badwords) g.badwords = badwords;
    if (codes) g.countryCodes = codes;
    if (blacklist) g.blacklist = blacklist;
    if (replies) g.autoreplies = replies;
    if (ann) g.announcements = ann;
    if (schedule) g.schedule = schedule;
    persist();
    return snapshot(req.params.jid);
  }),
);

/** লাইভ প্রিভিউ: ফর্মের (এখনো সেভ না-করা) মান দিয়ে নোটিশের চেহারা। কিছু সংরক্ষণ হয় না। */
groupsRouter.post(
  '/preview',
  h((req) => {
    const { kind, jid, settings } = req.body || {};
    if (!PREVIEWS[kind]) throw fail('অচেনা নোটিশ');
    const base = jid ? groupOf(jid).settings : config.defaults;
    const st = { ...base, ...cleanSettings(settings || {}) };
    return { text: PREVIEWS[kind](st) };
  }),
);
