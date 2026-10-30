import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, logAdmin, persist } from '../lib/store.js';
import { groupCache, getMeta, findParticipant, norm, numberOf, pid, fetchBuffer } from '../lib/utils.js';
import { renderWelcome, renderGoodbye, renderVerify, welcomeCardText, renderAdminEvent, stamp } from '../lib/render.js';
import { sendHelp } from './help.js';
import { screenJoin } from './automation.js';

/* ------------------------------------------------------------------ */
/* ওয়েলকাম পাঠানো — স্টাইল: card (সাইডে প্রোফাইল ছবি সহ কার্ড) | photo | text */
/* ------------------------------------------------------------------ */
export async function sendWelcome(sock, jid, s, ids, subject, count) {
  const shown = ids; // মেনশন আনলিমিটেড — যতজন যোগ হবে সবাইকে মেনশন
  // প্রোফাইল ডিটেইলস: একজন যোগ দিলে তার About (বায়ো) আনি
  let about = '';
  if (ids.length === 1) {
    const st = await sock.fetchStatus(ids[0]).catch(() => null);
    const raw = Array.isArray(st) ? st[0]?.status : st?.status;
    about = String(raw?.status ?? raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  const text = renderWelcome(s, { ids: shown, group: subject, count, about });
  const style = s.welcomeStyle || 'card';

  // ছবি: নতুন সদস্যের প্রোফাইল, না থাকলে (বা লুকানো থাকলে) গ্রুপের ছবি
  let pic = null;
  if (style !== 'text') {
    if (ids.length === 1) pic = await sock.profilePictureUrl(ids[0], 'image').catch(() => null);
    pic ||= await sock.profilePictureUrl(jid, 'image').catch(() => null);
  }

  if (style === 'photo' && pic) {
    return sock.sendMessage(jid, { image: { url: pic }, caption: text, mentions: shown });
  }

  if (style === 'card') {
    const thumb = pic ? await fetchBuffer(pic) : null;
    const { title, body } = welcomeCardText(s, { group: subject, count, phone: ids.length === 1 ? numberOf(ids[0]) : '' });
    try {
      return await sock.sendMessage(jid, {
        text,
        mentions: shown,
        contextInfo: {
          externalAdReply: {
            title,
            body,
            mediaType: 1,
            renderLargerThumbnail: false,
            showAdAttribution: false,
            ...(config.cardLink ? { sourceUrl: config.cardLink } : {}),
            ...(thumb ? { thumbnail: thumb } : {}),
          },
        },
      });
    } catch {
      /* কার্ড ব্যর্থ হলে সাধারণ টেক্সটে ফলব্যাক */
    }
  }
  return sock.sendMessage(jid, { text, mentions: shown });
}

/* ------------------------------------------------------------------ */
/* নতুন সদস্যের ভেরিফিকেশন চ্যালেঞ্জ (যোগফল) — সময় পেরোলে scheduler.js রিমুভ করে */
/* ------------------------------------------------------------------ */
async function sendChallenges(sock, jid, g, ids) {
  for (const id of ids.slice(0, 5)) {
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    g.pending[id] = { a, b, ts: Date.now() };
    await sock
      .sendMessage(jid, {
        text: renderVerify(g.settings, {
          user: `@${numberOf(id)}`,
          a,
          b,
          minutes: config.verifyMinutes,
          prefix: config.prefix,
        }),
        mentions: [id],
      })
      .catch(() => {});
  }
  persist();
}

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

  // কেউ চলে গেলে বা সরানো হলে তার পেন্ডিং ভেরিফিকেশন মুছে দাও
  if (action === 'remove') {
    for (const id of ids) for (const k of Object.keys(g.pending)) if (areJidsSameUser(k, id)) delete g.pending[k];
  }

  const meta = await getMeta(sock, jid, true).catch(() => null);
  const subject = meta?.subject || 'Group';
  const count = meta?.participants?.length ?? '';

  // --- অ্যাডমিন ইভেন্ট নোটিফিকেশন ---
  const byBot = by && areJidsSameUser(by, botId);
  if (
    config.adminLogNotify &&
    s.adminlog &&
    ['promote', 'demote', 'remove'].includes(type) &&
    !byBot
  ) {
    const mentions = new Set();
    let text;
    if (type === 'remove') {
      text = formatLog(entry, mentions, false);
    } else {
      // promote / demote → ফ্রেমে সাজানো কার্ড (বর্তমান অ্যাডমিন সংখ্যা সহ)
      ids.forEach((i) => mentions.add(i));
      if (by) mentions.add(by);
      let adminCount = 0;
      if (meta?.participants) {
        adminCount = meta.participants.filter((x) => x.admin).length;
        // মেটাডেটা এখনো পুরনো থাকলে সংখ্যা ঠিক করে নাও
        const stale = ids.filter((i) => (type === 'promote') !== !!findParticipant(meta, i)?.admin).length;
        adminCount += type === 'promote' ? stale : -stale;
      }
      text = renderAdminEvent(s, { kind: type, ids, by, adminCount, time: stamp() });
    }
    await sock.sendMessage(jid, { text, mentions: [...mentions] }).catch(() => {});
  }

  // --- ওয়েলকাম + (চালু থাকলে) ভেরিফিকেশন ---
  if (action === 'add') {
    const botIsAdmin = !!(meta && (findParticipant(meta, botId) || findParticipant(meta, norm(sock.user.lid)))?.admin);
    // নম্বর-ফিল্টার ও ব্ল্যাকলিস্ট: আটকে যাওয়াদের জন্য ওয়েলকাম/ভেরিফিকেশন নয়
    const stay = meta ? await screenJoin(sock, { jid, g, meta, ids, by, botIsAdmin }).catch(() => ids) : ids;
    const members = typeof count === 'number' ? count - (ids.length - stay.length) : count;
    if (s.welcome && stay.length) {
      await sendWelcome(sock, jid, s, stay, subject, members).catch((e) => console.error('[welcome]', e.message));
    }
    if (s.verify && botIsAdmin && stay.length) await sendChallenges(sock, jid, g, stay);
  }

  // --- গুডবাই: শুধু স্বেচ্ছায় লিভ করলে (কিক/কিক-অল-এ স্প্যাম এড়াতে) ---
  if (type === 'leave' && s.goodbye) {
    const text = renderGoodbye(s, { ids, group: subject, count });
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
    if (!jid) return 'Someone';
    mentions.add(jid);
    return `@${numberOf(jid)}`;
  };
  const who = (e.targets || []).map(m).join(', ');
  const by = m(e.by);

  let line;
  switch (e.type) {
    case 'promote':
      line = `⬆️ ${by} promoted ${who} to admin`;
      break;
    case 'demote':
      line = `⬇️ ${by} removed ${who} from admins`;
      break;
    case 'add':
      line = `➕ ${by} added ${who}`;
      break;
    case 'remove':
      line = `🚪 ${by} removed ${who} from the group`;
      break;
    case 'warnkick':
      line = `🚫 ${who} was removed after reaching the warning limit`;
      break;
    case 'join':
      line = `👋 ${who} joined via invite link`;
      break;
    case 'leave':
      line = `🚶 ${who} left the group`;
      break;
    case 'delete':
      line = `🗑️ ${by} deleted ${e.by && e.targets?.[0] && numberOf(e.by) === numberOf(e.targets[0]) ? 'their own message' : `a message by ${who}`}: "${e.text}"`;
      break;
    case 'setting':
      line = `⚙️ ${by} ${describeSetting(e.key, e.value)}`;
      break;
    default:
      line = `ℹ️ ${e.type}`;
  }

  if (!withTime) return line;
  const time = new Date(e.ts).toLocaleString('en-GB', {
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
      return `changed the group name to "${String(value).slice(0, 60)}"`;
    case 'desc':
      return 'changed the group description';
    case 'announce':
      return value ? 'closed the group (only admins can send messages)' : 'opened the group';
    case 'restrict':
      return value ? 'limited group-info editing to admins' : 'allowed everyone to edit group info';
    case 'memberAddMode':
      return value ? 'allowed everyone to add members' : 'limited adding members to admins';
    case 'joinApprovalMode':
      return value ? 'turned on join approval' : 'turned off join approval';
    default:
      return `changed a setting (${key})`;
  }
}
