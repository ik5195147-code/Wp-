import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * খুব হালকা JSON ডাটাবেস (data/db.json)।
 * ছোট/মাঝারি বটের জন্য যথেষ্ট; বড় স্কেলে SQLite/Postgres ব্যবহার করুন।
 *
 * গঠন:
 * groups[jid] = {
 *   settings: { antilink, antisticker, ..., theme, font, lang, welcomeCustom, rules },
 *   adminLog: [{ ts, type, by, targets, ... }],
 *   messages: { [msgId]: { s, t, ts, r: {reactor: emoji}, q: replyCount } },
 *   members:  { [jid]: { count, last, xp, xpAt } },
 *   warns:    { [jid]: number },            // অ্যান্টি-লিঙ্ক স্ট্রাইক
 *   warnings: { [jid]: [{ ts, by, reason }] }, // .warn / ফ্লাড / ব্যাড-ওয়ার্ড
 *   badwords: [string],
 *   schedule: { close: 'HH:MM', open: 'HH:MM', lastClose, lastOpen },
 *   pending:  { [jid]: { a, b, ts } }       // ভেরিফিকেশনের অপেক্ষায়
 *   name: string                              // গ্রুপের নাম (ড্যাশবোর্ডে দেখানোর জন্য)
 *   blacklist: [{ n, ts, by, reason }]        // নিষিদ্ধ নম্বর
 *   countryCodes: ['880']                     // নম্বর-ফিল্টারে অনুমোদিত কোড
 *   tmutes: { [jid]: untilTimestamp }         // সাময়িক মিউট
 *   announcements: [{ id, at, text, last }]   // প্রতিদিনের শিডিউল মেসেজ
 *   autoreplies: [{ k, r }]                   // কীওয়ার্ড → উত্তর
 *   afk: { [jid]: { at, reason } }
 *   birthdays: { [jid]: 'DD-MM' }
 *   giveaway: { prize, winners, endsAt, entries, by } | null
 *   quiz: { q, o, a, endsAt, tried } | null
 * }
 */
const FILE = path.join(config.dataDir, 'db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });

let db = { groups: {} };
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  /* প্রথমবার চালালে ফাইল থাকে না — সমস্যা নেই */
}

let timer = null;

/** পরিবর্তনের পর কল করুন; ৩ সেকেন্ড পর ডিস্কে লিখবে (ব্যাচ করে)। */
export function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const tmp = `${FILE}.tmp`;
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (!err) fs.rename(tmp, FILE, () => {});
    });
  }, 3000);
}

/** প্রোগ্রাম বন্ধ হওয়ার আগে সঙ্গে সঙ্গে সেভ করতে। */
export function flush() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(db));
  } catch (e) {
    console.error('flush failed', e.message);
  }
}

// সংস্করণ ২ এর আগের ডিফল্ট (বাংলা নিয়ম, bold ফন্ট) — পুরনো সেভ-করা গ্রুপগুলো এখানে নতুন ডিফল্টে আসে
const OLD_RULES_BN =
  '1️⃣ কোনো লিঙ্ক বা স্প্যাম পাঠানো যাবে না\n2️⃣ সবাইকে সম্মান করুন\n3️⃣ অপ্রয়োজনীয় স্টিকার ও মাস-মেনশন নিষিদ্ধ';

export function getGroup(jid) {
  const g = (db.groups[jid] ??= {});
  g.settings ??= {};
  const st = g.settings;
  if (!st._v || st._v < 2) {
    if (st.font === 'bold') st.font = 'auto';
    if (st.rules === OLD_RULES_BN) st.rules = config.defaults.rules;
    st._v = 2;
  }
  for (const [k, v] of Object.entries(config.defaults)) st[k] ??= v;
  g.adminLog ??= [];
  g.messages ??= {};
  g.members ??= {};
  g.warns ??= {};
  g.warnings ??= {};
  g.badwords ??= [];
  g.schedule ??= {};
  g.pending ??= {};
  g.blacklist ??= [];
  g.countryCodes ??= [...config.allowedCodes];
  g.tmutes ??= {};
  g.announcements ??= [];
  g.autoreplies ??= [];
  g.afk ??= {};
  g.birthdays ??= {};
  g.giveaway ??= null;
  g.quiz ??= null;
  return g;
}

/** প্রাইভেট মোড (সব গ্রুপ ও চ্যাটের জন্য এক): সংরক্ষিত মান থাকলে সেটি, নইলে PRIVATE_MODE */
export const isPrivate = () => db.bot?.private ?? config.privateMode;
export function setPrivate(on) {
  db.bot = { ...(db.bot || {}), private: !!on };
  persist();
}

/** সব গ্রুপের jid (শিডিউলার ব্যবহার করে) */
export const groupIds = () => Object.keys(db.groups);

export function logAdmin(jid, entry) {
  const g = getGroup(jid);
  g.adminLog.push({ ts: Date.now(), ...entry });
  if (g.adminLog.length > 300) g.adminLog.splice(0, g.adminLog.length - 300);
  persist();
}

export function rememberMessage(jid, id, rec) {
  const g = getGroup(jid);
  g.messages[id] = { ...rec, r: {}, q: 0 };
  const keys = Object.keys(g.messages); // ইনসার্শন অর্ডারে — পুরনোগুলো আগে
  const over = keys.length - config.maxStoredMessages;
  if (over > 200) keys.slice(0, over).forEach((k) => delete g.messages[k]);
}
