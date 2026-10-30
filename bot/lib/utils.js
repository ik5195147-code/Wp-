import {
  jidNormalizedUser,
  normalizeMessageContent,
  areJidsSameUser,
} from '@whiskeysockets/baileys';
import { config } from '../config.js';

/** ব্যবহারকারীকে সরাসরি দেখানোর মতো এরর (লগে স্ট্যাক ট্রেস লাগে না)। */
export class UserError extends Error {}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** URL থেকে ছবি/ফাইল Buffer হিসেবে আনে (৮ সেকেন্ড টাইমআউট)। ব্যর্থ হলে null। */
export async function fetchBuffer(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
export const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export const norm = (jid) => (jid ? jidNormalizedUser(jid) : '');
export const numberOf = (jid) => String(jid || '').split('@')[0].split(':')[0];
/** Baileys 6.x এ participants স্ট্রিং, 7.x এ অবজেক্ট — দুটোই সামলায়। */
export const pid = (p) => (typeof p === 'string' ? p : p.id);

/* ---------- মেসেজ কনটেন্ট ---------- */

/** ephemeral / viewOnce র‍্যাপার খুলে আসল কনটেন্ট দেয়। */
export const unwrap = (msg) => normalizeMessageContent(msg.message) || {};

export function getText(content) {
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  );
}

export function getContextInfo(content) {
  for (const v of Object.values(content)) {
    if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  }
  return {};
}

/* ---------- লিঙ্ক ডিটেকশন ---------- */

const LINK_RE =
  /(?:https?:\/\/|www\.)[^\s]+|chat\.whatsapp\.com\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|xyz|info|link|ly|gg|tk|ru|cn|bd|co|app|site|online|top)\b(?:\/[^\s]*)?/gi;

export const findLinks = (text) => text.match(LINK_RE) || [];

/** হোয়াইটলিস্টে নেই এমন লিঙ্ক থাকলে true। */
export function hasBlockedLink(text) {
  return findLinks(text).some((l) => {
    const low = l.toLowerCase();
    return !config.linkWhitelist.some((d) => low.includes(d));
  });
}

/* ---------- গ্রুপ মেটাডেটা ও অ্যাডমিন চেক ---------- */

const cache = new Map();
const TTL = 5 * 60_000;

export const groupCache = {
  get: (jid) => {
    const e = cache.get(jid);
    return e && Date.now() - e.at < TTL ? e.meta : undefined;
  },
  set: (jid, meta) => cache.set(jid, { meta, at: Date.now() }),
  del: (jid) => cache.delete(jid),
};

export async function getMeta(sock, jid, fresh = false) {
  if (!fresh) {
    const hit = groupCache.get(jid);
    if (hit) return hit;
  }
  const meta = await sock.groupMetadata(jid);
  groupCache.set(jid, meta);
  return meta;
}

/**
 * JID (PN বা LID যেটাই হোক) দিয়ে participant খোঁজে।
 * Baileys 7 এ participant এর id, phoneNumber ও lid আলাদা ফিল্ডে থাকতে পারে।
 */
export function findParticipant(meta, jid) {
  if (!jid) return undefined;
  return meta.participants.find(
    (p) =>
      areJidsSameUser(p.id, jid) ||
      (p.phoneNumber && areJidsSameUser(p.phoneNumber, jid)) ||
      (p.lid && areJidsSameUser(p.lid, jid)) ||
      (p.jid && areJidsSameUser(p.jid, jid)),
  );
}

export const isBotOwner = (...jids) =>
  jids.some((j) => j && config.owners.includes(numberOf(j)));

/** নির্দিষ্ট টাইমজোনে বর্তমান তারিখ-সময়: { date: 'YYYY-MM-DD', hhmm: 'HH:MM', hour: 0-23 } */
export function tzNow(tz, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date, hhmm, hour: Number(hhmm.slice(0, 2)) };
}

/** "30m", "2h", "1d", "45s" → মিলিসেকেন্ড (ভুল হলে null) */
export function parseDuration(tok) {
  const m = /^(\d{1,4})(s|m|h|d)$/i.exec(String(tok || '').trim());
  if (!m) return null;
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2].toLowerCase()];
}

/** মিলিসেকেন্ড → "2h 5m" */
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
