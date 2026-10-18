import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, logAdmin } from '../lib/store.js';
import { groupCache, getMeta, norm, numberOf, pid } from '../lib/utils.js';
import { renderWelcome, renderGoodbye } from '../lib/render.js';
import { sendHelp } from './help.js';

/* ------------------------------------------------------------------ */
/* group-participants.update: join / leave / add / remove / promote / demote */
/* ------------------------------------------------------------------ */
export async function onParticipants(sock, ev) {
  const { id: jid, action, author } = ev;
  const ids = ev.participants.map(pid);
  groupCache.del(jid);

  const botId = norm(sock.user.id);
  const botInvolved = ids.some((i) => areJidsSameUser(i, botId));

  // বটকেই গ্রুপে যোগ করা হলে — হেল্প নোটিশ পাঠাও
  if (action === 'add' && botInvolved) {
    await sendHelp(sock, jid).catch(() => {});
    return;
  }
  if (action === 'remove' && botInvolved) return; // বটকে সরানো হয়েছে, কিছু করার নেই

  const g = getGroup(jid);
  const s = g.settings;
  const by = author ? norm(author) : null;
  // যে নিজেই এসেছে/চলে গেছে (লিঙ্কে জয়েন বা লিভ)
  const selfAction = !!by && ids.length === 1 && areJidsSameUser(by, ids[0]);

  const type =
    selfAction && action === 'add' ? 'join' : selfAction && action === 'remove' ? 'leave' : action;
  const entry = { type, by: selfAction ? null : by, targets: ids };
  logAdmin(jid, entry);

  const meta = await getMeta(sock, jid, true).catch(() => null);
  const subject = meta?.subject || 'গ্রুপ';

  // --- অ্যাডমিন ইভেন্ট নোটিফিকেশন ---
  const byBot = by && areJidsSameUser(by, botId);
  if (
    config.adminLogNotify &&
    s.adminlog &&
    ['promote', 'demote', 'remove'].includes(type) &&
    !byBot
  ) {
    const mentions = new Set();
    const text = formatLog(entry, mentions, false);
    await sock.sendMessage(jid, { text, mentions: [...mentions] }).catch(() => {});
  }

  // --- ওয়েলকাম (থিম/ফন্ট/ভাষা অনুযায়ী; ছবি: নতুন সদস্যের প্রোফাইল, না থাকলে গ্রুপের ছবি) ---
  if (action === 'add' && s.welcome) {
    const shown = ids.slice(0, 15); // বাল্ক-অ্যাডে স্প্যাম এড়াতে সীমা
    const text = renderWelcome(s, { ids: shown, group: subject, count: meta?.participants?.length ?? '' });
    let pic = null;
    if (ids.length === 1) pic = await sock.profilePictureUrl(ids[0], 'image').catch(() => null);
    pic ||= await sock.profilePictureUrl(jid, 'image').catch(() => null);
    const payload = pic
      ? { image: { url: pic }, caption: text, mentions: shown }
      : { text, mentions: shown };
    await sock.sendMessage(jid, payload).catch(() => {});
  }

  // --- গুডবাই: শুধু স্বেচ্ছায় লিভ করলে (কিক/কিক-অল-এ স্প্যাম এড়াতে) ---
  if (type === 'leave' && s.goodbye) {
    const text = renderGoodbye(s, { ids, group: subject, count: meta?.participants?.length ?? '' });
    await sock.sendMessage(jid, { text, mentions: ids }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* groups.update: নাম, ডেসক্রিপশন, মিউট (announce), ইনফো-এডিট ইত্যাদি     */
/* ------------------------------------------------------------------ */
export async function onGroupSettings(sock, updates) {
  const botId = norm(sock.user.id);
  for (const u of updates) {
    const jid = u.id;
    if (!jid?.endsWith('@g.us')) continue;
    groupCache.del(jid);

    const by = u.author ? norm(u.author) : null;
    const changed = [];
    // ফিল্ডের অর্থ Baileys ভার্সনভেদে সামান্য বদলাতে পারে — প্রয়োজনে এখানে মিলিয়ে নিন
    for (const key of ['subject', 'desc', 'announce', 'restrict', 'memberAddMode', 'joinApprovalMode']) {
      if (u[key] !== undefined) changed.push({ key, value: u[key] });
    }

    const s = getGroup(jid).settings;
    for (const ch of changed) {
      const entry = { type: 'setting', by, key: ch.key, value: ch.value };
      logAdmin(jid, entry);

      if (config.adminLogNotify && s.adminlog && !(by && areJidsSameUser(by, botId))) {
        const mentions = new Set();
        const text = formatLog(entry, mentions, false);
        await sock.sendMessage(jid, { text, mentions: [...mentions] }).catch(() => {});
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* লগ লাইন ফরম্যাটার (.adminlog কমান্ড ও নোটিফিকেশন দুটোতেই ব্যবহৃত)     */
/* ------------------------------------------------------------------ */
export function formatLog(e, mentions = new Set(), withTime = true) {
  const m = (jid) => {
    if (!jid) return 'কেউ';
    mentions.add(jid);
    return `@${numberOf(jid)}`;
  };
  const who = (e.targets || []).map(m).join(', ');
  const by = m(e.by);

  let line;
  switch (e.type) {
    case 'promote':
      line = `⬆️ ${by} ${who}-কে অ্যাডমিন বানিয়েছেন`;
      break;
    case 'demote':
      line = `⬇️ ${by} ${who}-কে অ্যাডমিন থেকে সরিয়েছেন`;
      break;
    case 'add':
      line = `➕ ${by} ${who}-কে গ্রুপে যোগ করেছেন`;
      break;
    case 'remove':
      line = `🚪 ${by} ${who}-কে গ্রুপ থেকে রিমুভ করেছেন`;
      break;
    case 'join':
      line = `👋 ${who} লিঙ্কের মাধ্যমে জয়েন করেছেন`;
      break;
    case 'leave':
      line = `🚶 ${who} গ্রুপ ছেড়েছেন`;
      break;
    case 'setting':
      line = `⚙️ ${by} ${describeSetting(e.key, e.value)}`;
      break;
    default:
      line = `ℹ️ ${e.type}`;
  }

  if (!withTime) return line;
  const time = new Date(e.ts).toLocaleString('bn-BD', {
    timeZone: config.timeZone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `[${time}] ${line}`;
}

function describeSetting(key, value) {
  switch (key) {
    case 'subject':
      return `গ্রুপের নাম বদলেছেন: "${String(value).slice(0, 60)}"`;
    case 'desc':
      return 'গ্রুপ ডেসক্রিপশন বদলেছেন';
    case 'announce':
      return value ? 'গ্রুপ মিউট করেছেন (শুধু অ্যাডমিন মেসেজ দিতে পারবেন)' : 'গ্রুপ আনমিউট করেছেন';
    case 'restrict':
      return value ? 'গ্রুপ-ইনফো এডিট শুধু অ্যাডমিনদের জন্য করেছেন' : 'গ্রুপ-ইনফো এডিট সবার জন্য খুলেছেন';
    case 'memberAddMode':
      return value ? 'সদস্য যোগ করার অনুমতি সবাইকে দিয়েছেন' : 'সদস্য যোগ করা শুধু অ্যাডমিনদের জন্য করেছেন';
    case 'joinApprovalMode':
      return value ? 'জয়েন অ্যাপ্রুভাল চালু করেছেন' : 'জয়েন অ্যাপ্রুভাল বন্ধ করেছেন';
    default:
      return `সেটিং বদলেছেন (${key})`;
  }
}
