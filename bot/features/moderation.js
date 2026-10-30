import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, persist, logAdmin } from '../lib/store.js';
import { hasBlockedLink, numberOf, norm } from '../lib/utils.js';
import {
  renderLinkKick,
  renderLinkWarn,
  renderMentionWarn,
  renderGroupStatusWarn,
  renderWarn,
  renderWarnKick,
  renderSlowMode,
} from '../lib/render.js';

/* ------------------------------------------------------------------ */
/* ওয়ার্ন সিস্টেম — .warn, ফ্লাড, ব্যাড-ওয়ার্ড সবাই এটি ব্যবহার করে        */
/* ------------------------------------------------------------------ */
export async function addWarning(sock, { jid, target, by, reason = '', botIsAdmin, auto = false }) {
  const g = getGroup(jid);
  const s = g.settings;
  const list = (g.warnings[target] ??= []);
  list.push({ ts: Date.now(), by, reason });
  const n = list.length;
  const max = config.warnLimit;
  const user = `@${numberOf(target)}`;
  const mentions = auto || !by ? [target] : [target, by];
  const send = (text) => sock.sendMessage(jid, { text, mentions }).catch(() => {});

  if (n >= max) {
    delete g.warnings[target];
    persist();
    if (botIsAdmin) {
      // আগে রিমুভ, তারপর নোটিশ (রিমুভ ব্যর্থ হলে সীমা-পূর্ণ নোটিশ)
      let removed = true;
      try {
        const res = await sock.groupParticipantsUpdate(jid, [target], 'remove');
        if (res?.[0]?.status && String(res[0].status) !== '200') removed = false;
      } catch (e) {
        removed = false;
        console.error('[warn-kick]', e.message);
      }
      if (removed) {
        await send(renderWarnKick(s, { user, jid: target, max }));
        logAdmin(jid, { type: 'warnkick', by, targets: [target] });
        return { count: n, kicked: true };
      }
    }
    await send(renderWarn(s, { user, jid: target, by, auto, n, max, reason, limitHit: true }));
    return { count: n, kicked: false };
  }
  persist();
  await send(renderWarn(s, { user, jid: target, by, auto, n, max, reason }));
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
/* স্লো-মোড: প্রতি সদস্য প্রতি N সেকেন্ডে একটি মেসেজ                       */
/* ------------------------------------------------------------------ */
const slowLast = new Map(); // "jid|sender" → শেষ গৃহীত মেসেজের সময়
const slowNoticed = new Map(); // "jid|sender" → শেষ নোটিশের সময় (নোটিশ-স্প্যাম এড়াতে)

/** সীমার মধ্যে হলে অপেক্ষার সেকেন্ড (>0), নইলে 0 এবং সময় রেকর্ড */
export function slowCheck(jid, sender, gapSec, now = Date.now()) {
  const key = `${jid}|${sender}`;
  const wait = Math.ceil((gapSec * 1000 - (now - (slowLast.get(key) || 0))) / 1000);
  if (wait > 0) return wait;
  slowLast.set(key, now);
  if (slowLast.size > 5000) {
    for (const [k, t] of slowLast) if (now - t > 600_000) slowLast.delete(k);
    for (const [k, t] of slowNoticed) if (now - t > 600_000) slowNoticed.delete(k);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* মডারেশন: স্টিকার / মেনশন / লিঙ্ক / ব্যাড-ওয়ার্ড / ফ্লাড                */
/* মেসেজ ডিলিট হলে true রিটার্ন করে (তখন কমান্ড আর চলবে না)।              */
/* ------------------------------------------------------------------ */
/** গ্রুপ স্ট্যাটাস পোস্ট / স্ট্যাটাস-মেনশন চেনা (র-মেসেজ ও আনর‍্যাপ করা — দুটোই দেখে) */
const isGroupStatus = (msg, content, ctx) =>
  !!ctx?.isGroupStatus ||
  [msg?.message, content].some((m) => m && Object.keys(m).some((k) => /^(groupStatus|statusMention)/i.test(k)));

export async function moderate(c) {
  const { sock, jid, msg, sender, text, content, ctx, botIsAdmin } = c;
  if (!botIsAdmin) return false; // অ্যাডমিন না হলে অন্যের মেসেজ ডিলিট/কিক করা যায় না

  const g = getGroup(jid);
  const s = g.settings;
  const del = () => sock.sendMessage(jid, { delete: msg.key });
  const tag = `@${numberOf(sender)}`;
  const botId = norm(sock.user.id);

  try {
    // ০) সাময়িক মিউট: মেয়াদ শেষ না হওয়া পর্যন্ত সব মেসেজ ডিলিট
    const mk = Object.keys(g.tmutes).find((k) => areJidsSameUser(k, sender));
    if (mk) {
      if (g.tmutes[mk] > Date.now()) {
        await del();
        return true;
      }
      delete g.tmutes[mk];
      persist();
    }

    // ০.৫) স্লো-মোড (কমান্ড মেসেজ বাদ — সেগুলোর নিজস্ব কুলডাউন আছে)
    if (s.slowmode && !(text || '').startsWith(config.prefix)) {
      const gap = s.slowSeconds || 10;
      const wait = slowCheck(jid, sender, gap);
      if (wait > 0) {
        await del();
        const nk = `${jid}|${sender}`;
        if (Date.now() - (slowNoticed.get(nk) || 0) > Math.max(gap, 15) * 1000) {
          slowNoticed.set(nk, Date.now());
          await sock.sendMessage(jid, { text: renderSlowMode(s, { user: tag, wait, gap }), mentions: [sender] });
        }
        return true;
      }
    }

    // ১) অ্যান্টি-স্টিকার
    if (s.antisticker && content.stickerMessage) {
      await del();
      return true;
    }

    // ১.৫) অ্যান্টি-গ্রুপ-স্ট্যাটাস: গ্রুপ স্ট্যাটাস পোস্ট ডিলিট
    if (s.antigroupstatus && isGroupStatus(msg, content, ctx)) {
      await del();
      await sock.sendMessage(jid, { text: renderGroupStatusWarn(s, tag, sender), mentions: [sender] });
      return true;
    }

    // ২) অ্যান্টি-মেনশন (মাস ট্যাগ + স্ট্যাটাস মেনশন)
    if (s.antimention) {
      const count = (ctx.mentionedJid?.length || 0) + (ctx.groupMentions?.length || 0);
      const statusMention = content.groupStatusMentionMessage || content.statusMentionMessage;
      if ((config.mentionLimit > 0 && count >= config.mentionLimit) || statusMention) {
        await del();
        await sock.sendMessage(jid, { text: renderMentionWarn(s, tag, sender), mentions: [sender] });
        return true;
      }
    }

    // ৩) অ্যান্টি-লিঙ্ক: মেসেজ ডিলিট + সতর্কতা; সীমা পূর্ণ হলে রিমুভ করে তারপর নোটিশ
    if (s.antilink && text && hasBlockedLink(text)) {
      await del();
      g.warns[sender] = (g.warns[sender] || 0) + 1;
      const n = g.warns[sender];
      const max = config.linkWarnLimit;
      const card = { user: tag, jid: sender, n, max };
      if (n >= max) {
        delete g.warns[sender];
        persist();
        let removed = true;
        try {
          const res = await sock.groupParticipantsUpdate(jid, [sender], 'remove');
          if (res?.[0]?.status && String(res[0].status) !== '200') removed = false;
        } catch (e) {
          removed = false;
          console.error('[antilink-kick]', e.message);
        }
        await sock.sendMessage(jid, { text: renderLinkKick(s, { ...card, removed }), mentions: [sender] });
      } else {
        persist();
        await sock.sendMessage(jid, { text: renderLinkWarn(s, card), mentions: [sender] });
      }
      return true;
    }

    // ৪) ব্যাড-ওয়ার্ড ফিল্টার: ডিলিট + ওয়ার্ন
    if (s.antiword && text && g.badwords.length && matchesBadWord(text, g.badwords)) {
      await del();
      await addWarning(sock, { jid, target: sender, by: botId, reason: 'badword', botIsAdmin, auto: true });
      return true;
    }

    // ৫) অ্যান্টি-ফ্লাড: সীমা পেরোলে মেসেজ ডিলিট; ওয়ার্ন ৬০ সেকেন্ডে একবার
    if (s.antiflood && isFlooding(jid, sender)) {
      await del();
      const key = `${jid}|${sender}`;
      if (Date.now() - (floodWarned.get(key) || 0) > 60_000) {
        floodWarned.set(key, Date.now());
        await addWarning(sock, { jid, target: sender, by: botId, reason: 'flood', botIsAdmin, auto: true });
      }
      return true;
    }
  } catch (e) {
    console.error('[moderate]', e.message);
  }
  return false;
}
