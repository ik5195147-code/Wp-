import { config } from '../config.js';
import { getGroup, persist, rememberMessage, logAdmin } from '../lib/store.js';
import {
  unwrap,
  getText,
  getContextInfo,
  getMeta,
  findParticipant,
  isBotOwner,
  norm,
  numberOf,
} from '../lib/utils.js';
import { levelOf } from '../lib/xp.js';
import { renderLevelUp } from '../lib/render.js';
import { moderate } from './moderation.js';
import { runCommand } from './commands.js';

/* বটের কোড থেকে পাঠানো মেসেজের আইডি (শেষ ৫০০টি) — fromMe মেসেজের মধ্যে ওগুলো চেনার জন্য */
const botSent = new Set();
const sentByBot = (id) => botSent.has(id);

/** সকেটের sendMessage মুড়ে দেয়, যাতে বটের প্রতিটি পাঠানো মেসেজের আইডি ট্র্যাক হয়। */
export function trackOutgoing(sock) {
  if (sock.__tracked) return sock;
  const orig = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const res = await orig(...args);
    const id = res?.key?.id;
    if (id) {
      botSent.add(id);
      if (botSent.size > 500) botSent.delete(botSent.values().next().value);
    }
    return res;
  };
  sock.__tracked = true;
  return sock;
}

/** messages.upsert ইভেন্টের প্রতিটি মেসেজ এখানে আসে। */
export async function onMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!msg.message || !jid || jid === 'status@broadcast') return;

  // বটের নম্বর থেকে লেখা মেসেজ (fromMe) শুধু তখনই চলবে যখন সেটি মালিকের হাতে টাইপ করা কমান্ড।
  // বটের নিজের পাঠানো রিপ্লাই ঘুরে এসে যেন আবার কমান্ড না হয় (অসীম লুপ), সেজন্য sentByBot চেক।
  if (msg.key.fromMe) {
    if (sentByBot(msg.key.id)) return;
    const t = getText(unwrap(msg));
    if (!t.startsWith(config.prefix)) return;
  }

  const content = unwrap(msg);
  if (content.protocolMessage) {
    if (jid.endsWith('@g.us')) onRevoke(sock, msg, content.protocolMessage);
    return;
  }
  if (content.reactionMessage) return;

  const isGroup = jid.endsWith('@g.us');
  const sender = msg.key.fromMe
    ? norm(sock.user.id)
    : norm(msg.key.participant || msg.participant || jid);
  const c = {
    sock,
    msg,
    jid,
    isGroup,
    sender,
    content,
    text: getText(content),
    ctx: getContextInfo(content),
  };

  if (isGroup) {
    c.meta = await getMeta(sock, jid);
    const me = findParticipant(c.meta, sender);
    c.isAdmin = !!me?.admin;
    c.isOwner = !!msg.key.fromMe || isBotOwner(sender, me?.phoneNumber, me?.jid);
    const bot =
      findParticipant(c.meta, norm(sock.user.id)) ||
      findParticipant(c.meta, norm(sock.user.lid));
    c.botIsAdmin = !!bot?.admin;

    trackActivity(c);

    // অ্যাডমিন ও বট-মালিক মডারেশন থেকে মুক্ত
    if (!c.isAdmin && !c.isOwner && (await moderate(c))) return;

    // XP শুধু সাধারণ (কমান্ড নয়) মেসেজে এবং মডারেশন পেরোনো মেসেজে
    if (!c.text.startsWith(config.prefix)) grantXp(c);
  } else {
    c.isOwner = !!msg.key.fromMe || isBotOwner(sender);
  }

  await runCommand(c);
}

/* ------------------------------------------------------------------ */
/* অ্যাক্টিভিটি ট্র্যাকিং (টপ মেসেজেস / সক্রিয় সদস্য / XP)               */
/* ------------------------------------------------------------------ */

function preview(text, content) {
  if (text) return text.replace(/\s+/g, ' ').slice(0, 120);
  if (content.imageMessage) return '[📷 Photo]';
  if (content.videoMessage) return '[🎥 Video]';
  if (content.audioMessage) return '[🎤 Audio]';
  if (content.stickerMessage) return '[🖼 Sticker]';
  if (content.documentMessage) return '[📎 File]';
  return '[Message]';
}

function trackActivity({ jid, sender, msg, text, content, ctx }) {
  const g = getGroup(jid);
  const m = (g.members[sender] ??= { count: 0 });
  m.count += 1;
  m.last = Date.now();

  if (msg.key.id) {
    rememberMessage(jid, msg.key.id, { s: sender, t: preview(text, content), ts: Date.now() });
  }
  // কোনো মেসেজে রিপ্লাই এলে সেই মেসেজের "জনপ্রিয়তা" বাড়ে
  if (ctx.stanzaId && g.messages[ctx.stanzaId]) g.messages[ctx.stanzaId].q += 1;
  persist();
}

/** প্রতি XP_COOLDOWN সেকেন্ডে একবার XP; লেভেল বাড়লে (levelup চালু থাকলে) ঘোষণা। */
function grantXp(c) {
  const { sock, jid, sender } = c;
  const g = getGroup(jid);
  const m = (g.members[sender] ??= { count: 0 });
  const now = Date.now();
  if (now - (m.xpAt || 0) < config.xpCooldown * 1000) return;
  m.xpAt = now;

  const before = levelOf(m.xp || 0);
  m.xp = (m.xp || 0) + config.xpMin + Math.floor(Math.random() * (config.xpMax - config.xpMin + 1));
  const after = levelOf(m.xp);
  persist();

  if (after > before && g.settings.levelup) {
    sock
      .sendMessage(jid, { text: renderLevelUp(g.settings, { user: `@${numberOf(sender)}`, level: after }), mentions: [sender] })
      .catch(() => {});
  }
}

/** মেসেজ মুছে ফেলা (delete for everyone) — শুধু অ্যাডমিন লগে রাখা হয়, গ্রুপে আবার পাঠানো হয় না। */
function onRevoke(sock, msg, pm) {
  const isRevoke = pm.type === 0 || pm.type === 'REVOKE' || (pm.type == null && pm.key);
  if (!isRevoke || !pm.key?.id) return;
  const jid = msg.key.remoteJid;
  const g = getGroup(jid);
  if (!g.settings.antidelete) return;
  const rec = g.messages[pm.key.id];
  if (!rec) return;
  const by = msg.key.fromMe ? norm(sock.user.id) : norm(msg.key.participant || rec.s);
  logAdmin(jid, { type: 'delete', by, targets: [rec.s], text: rec.t });
}

/** messages.reaction ইভেন্ট: রিয়্যাকশন গুনে রাখে। */
export function onReactions(sock, reactions) {
  const botId = norm(sock.user.id);
  for (const { key, reaction } of reactions) {
    const jid = key.remoteJid;
    if (!jid?.endsWith('@g.us')) continue;
    const rec = getGroup(jid).messages[key.id];
    if (!rec) continue;
    const reactor = reaction.key?.fromMe
      ? botId
      : norm(reaction.key?.participant || reaction.key?.remoteJid);
    if (reaction.text) rec.r[reactor] = reaction.text;
    else delete rec.r[reactor]; // খালি টেক্সট = রিয়্যাকশন সরানো হয়েছে
    persist();
  }
}
