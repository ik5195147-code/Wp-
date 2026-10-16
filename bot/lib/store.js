import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * খুব হালকা JSON ডাটাবেস (data/db.json)।
 * ছোট/মাঝারি বটের জন্য যথেষ্ট; বড় স্কেলে SQLite/Postgres ব্যবহার করুন।
 *
 * গঠন:
 * groups[jid] = {
 *   settings: { antilink, antisticker, ... , welcomeText, rules },
 *   adminLog: [{ ts, type, by, targets, ... }],
 *   messages: { [msgId]: { s, t, ts, r: {reactor: emoji}, q: replyCount } },
 *   members:  { [jid]: { count, last } },
 *   warns:    { [jid]: number }
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

export function getGroup(jid) {
  const g = (db.groups[jid] ??= {});
  g.settings ??= {};
  for (const [k, v] of Object.entries(config.defaults)) g.settings[k] ??= v;
  g.adminLog ??= [];
  g.messages ??= {};
  g.members ??= {};
  g.warns ??= {};
  return g;
}

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
