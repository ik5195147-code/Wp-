import { config } from '../config.js';
import { getGroup, persist, logAdmin } from '../lib/store.js';
import { hasBlockedLink, numberOf, norm } from '../lib/utils.js';
import {
  renderLinkKick,
  renderLinkWarn,
  renderMentionWarn,
  renderWarn,
  renderWarnKick,
} from '../lib/render.js';

/* ------------------------------------------------------------------ */
/* ওয়ার্ন সিস্টেম — .warn, ফ্লাড, ব্যাড-ওয়ার্ড সবাই এটি ব্যবহার করে        */
/* ------------------------------------------------------------------ */
export async function addWarning(sock, { jid, target, by, reason = '', botIsAdmin }) {
  const g = getGroup(jid);
  const s = g.settings;
  const list = (g.warnings[target] ??= []);
  list.push({ ts: Date.now(), by, reason });
  const n = list.length;
  const max = config.warnLimit;
  const user = `@${numberOf(target)}`;
  const send = (text) => sock.sendMessage(jid, { text, mentions: [target] }).catch(() => {});

  if (n >= max) {
    delete g.warnings[target];
    persist();
    if (botIsAdmin) {
      await send(renderWarnKick(s, { user, max }));
      await sock.groupParticipantsUpdate(jid, [target], 'remove').catch((e) => console.error('[warn-kick]', e.message));
      logAdmin(jid, { type: 'warnkick', by, targets: [target] });
      return { count: n, kicked: true };
    }
    await send(renderWarn(s, { user, n, max, reason, limitHit: true }));
    return { count: n, kicked: false };
  }
  persist();
  await send(renderWarn(s, { user, n, max, reason }));
  return { count: n, kicked: false };
}

/* ------------------------------------------------------------------ */
/* ব্যাড-ওয়ার্ড ম্যাচিং: ইংরেজি শব্দ হলে পুরো-শব্দ মিল, অন্য ভাষায় (বাংলা ইত্যাদি) টেক্সটের ভেতরে খোঁজে */
/* ------------------------------------------------------------------ */
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchesBadWord(text, words) {
  const low = text.toLowerCase();
  return words.some((w) => {
    if (!w) return false;
    if (/^[a-z0-9 ]+$/.test(w)) return new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`, 'i').test(low);
    return low.includes(w);
  });
}

/* ------------------------------------------------------------------ */
/* ফ্লাড ডিটেকশন: স্লাইডিং উইন্ডো                                        */
/* ------------------------------------------------------------------ */
const floodHits = new Map(); // "jid|sender" → [timestamps]
const floodWarned = new Map(); // "jid|sender" → শেষ ওয়ার্নের সময়

function pruneFlood(now) {
  if (floodHits.size < 3000) return;
  for (const [k, arr] of floodHits) if (!arr.length || now - arr[arr.length - 1] > 60_000) floodHits.delete(k);
  for (const [k, t] of floodWarned) if (now - t > 120_000) floodWarned.delete(k);
}

/** সীমা পেরোলে true (এই মেসেজটি ফ্লাডের অংশ)। */
export function isFlooding(jid, sender, now = Date.now()) {
  const key = `${jid}|${sender}`;
  const arr = (floodHits.get(key) || []).filter((t) => now - t < config.floodSeconds * 1000);
  arr.push(now);
  floodHits.set(key, arr);
  pruneFlood(now);
  return arr.length >= config.floodMessages;
}

/* ------------------------------------------------------------------ */
/* মডারেশন: স্টিকার / মেনশন / লিঙ্ক / ব্যাড-ওয়ার্ড / ফ্লাড                */
/* মেসেজ ডিলিট হলে true রিটার্ন করে (তখন কমান্ড আর চলবে না)।              */
/* ------------------------------------------------------------------ */
export async function moderate(c) {
  const { sock, jid, msg, sender, text, content, ctx, botIsAdmin } = c;
  if (!botIsAdmin) return false; // অ্যাডমিন না হলে অন্যের মেসেজ ডিলিট/কিক করা যায় না

  const g = getGroup(jid);
  const s = g.settings;
  const del = () => sock.sendMessage(jid, { delete: msg.key });
  const tag = `@${numberOf(sender)}`;
  const botId = norm(sock.user.id);

  try {
    // ১) অ্যান্টি-স্টিকার
    if (s.antisticker && content.stickerMessage) {
      await del();
      return true;
    }

    // ২) অ্যান্টি-মেনশন (মাস ট্যাগ + স্ট্যাটাস মেনশন)
    if (s.antimention) {
      const count = (ctx.mentionedJid?.length || 0) + (ctx.groupMentions?.length || 0);
      const statusMention = content.groupStatusMentionMessage || content.statusMentionMessage;
      if (count >= config.mentionLimit || statusMention) {
        await del();
        await sock.sendMessage(jid, { text: renderMentionWarn(s, tag), mentions: [sender] });
        return true;
      }
    }

    // ৩) অ্যান্টি-লিঙ্ক: ডিলিট + (সীমা পার হলে) কিক
    if (s.antilink && text && hasBlockedLink(text)) {
      await del();
      g.warns[sender] = (g.warns[sender] || 0) + 1;
      if (g.warns[sender] >= config.linkWarnLimit) {
        delete g.warns[sender];
        // আগে নোটিশ, তারপর রিমুভ — যাতে সবাই কারণটা দেখে
        await sock.sendMessage(jid, { text: renderLinkKick(s, tag), mentions: [sender] });
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      } else {
        await sock.sendMessage(jid, {
          text: renderLinkWarn(s, tag, g.warns[sender], config.linkWarnLimit),
          mentions: [sender],
        });
      }
      persist();
      return true;
    }

    // ৪) ব্যাড-ওয়ার্ড ফিল্টার: ডিলিট + ওয়ার্ন
    if (s.antiword && text && g.badwords.length && matchesBadWord(text, g.badwords)) {
      await del();
      await addWarning(sock, { jid, target: sender, by: botId, reason: 'badword', botIsAdmin });
      return true;
    }

    // ৫) অ্যান্টি-ফ্লাড: সীমা পেরোলে মেসেজ ডিলিট; ওয়ার্ন ৬০ সেকেন্ডে একবার
    if (s.antiflood && isFlooding(jid, sender)) {
      await del();
      const key = `${jid}|${sender}`;
      if (Date.now() - (floodWarned.get(key) || 0) > 60_000) {
        floodWarned.set(key, Date.now());
        await addWarning(sock, { jid, target: sender, by: botId, reason: 'flood', botIsAdmin });
      }
      return true;
    }
  } catch (e) {
    console.error('[moderate]', e.message);
  }
  return false;
}
