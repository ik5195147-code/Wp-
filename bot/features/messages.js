import { config } from '../config.js';
import { getGroup, persist, rememberMessage } from '../lib/store.js';
import {
  unwrap,
  getText,
  getContextInfo,
  hasBlockedLink,
  getMeta,
  findParticipant,
  isBotOwner,
  norm,
  numberOf,
} from '../lib/utils.js';
import { runCommand } from './commands.js';

/** messages.upsert ইভেন্টের প্রতিটি মেসেজ এখানে আসে। */
export async function onMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!msg.message || !jid || jid === 'status@broadcast' || msg.key.fromMe) return;

  const content = unwrap(msg);
  if (content.protocolMessage || content.reactionMessage) return;

  const isGroup = jid.endsWith('@g.us');
  const sender = norm(msg.key.participant || msg.participant || jid);
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
    c.isOwner = isBotOwner(sender, me?.phoneNumber, me?.jid);
    const bot =
      findParticipant(c.meta, norm(sock.user.id)) ||
      findParticipant(c.meta, norm(sock.user.lid));
    c.botIsAdmin = !!bot?.admin;

    trackActivity(c);

    // অ্যাডমিন ও বট-মালিক মডারেশন থেকে মুক্ত
    if (!c.isAdmin && !c.isOwner && (await moderate(c))) return;
  } else {
    c.isOwner = isBotOwner(sender);
  }

  await runCommand(c);
}

/* ------------------------------------------------------------------ */
/* অ্যাক্টিভিটি ট্র্যাকিং (টপ মেসেজেস / সক্রিয় সদস্য)                  */
/* ------------------------------------------------------------------ */

function preview(text, content) {
  if (text) return text.replace(/\s+/g, ' ').slice(0, 120);
  if (content.imageMessage) return '[📷 ছবি]';
  if (content.videoMessage) return '[🎥 ভিডিও]';
  if (content.audioMessage) return '[🎤 অডিও]';
  if (content.stickerMessage) return '[🖼 স্টিকার]';
  if (content.documentMessage) return '[📎 ফাইল]';
  return '[মেসেজ]';
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

/* ------------------------------------------------------------------ */
/* মডারেশন: অ্যান্টি-স্টিকার / অ্যান্টি-মেনশন / অ্যান্টি-লিঙ্ক          */
/* ------------------------------------------------------------------ */

/** মেসেজ ডিলিট হলে true রিটার্ন করে (তখন কমান্ড আর চলবে না)। */
async function moderate(c) {
  const { sock, jid, msg, sender, text, content, ctx, botIsAdmin } = c;
  if (!botIsAdmin) return false; // অ্যাডমিন না হলে অন্যের মেসেজ ডিলিট/কিক করা যায় না

  const g = getGroup(jid);
  const s = g.settings;
  const del = () => sock.sendMessage(jid, { delete: msg.key });
  const tag = `@${numberOf(sender)}`;

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
        await sock.sendMessage(jid, {
          text: `⚠️ ${tag}, এই গ্রুপে মাস-মেনশন অনুমোদিত নয়।`,
          mentions: [sender],
        });
        return true;
      }
    }

    // ৩) অ্যান্টি-লিঙ্ক: ডিলিট + (সীমা পার হলে) কিক
    if (s.antilink && text && hasBlockedLink(text)) {
      await del();
      g.warns[sender] = (g.warns[sender] || 0) + 1;
      if (g.warns[sender] >= config.linkWarnLimit) {
        delete g.warns[sender];
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        await sock.sendMessage(jid, {
          text: `🚫 ${tag} লিঙ্ক পাঠানোর কারণে গ্রুপ থেকে রিমুভ করা হয়েছে।`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(jid, {
          text: `⚠️ ${tag}, লিঙ্ক পাঠানো নিষেধ! সতর্কতা ${g.warns[sender]}/${config.linkWarnLimit}।`,
          mentions: [sender],
        });
      }
      persist();
      return true;
    }
  } catch (e) {
    console.error('[moderate]', e.message);
  }
  return false;
}
