import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { norm, pid } from '../lib/utils.js';

/**
 * .story — বটের নম্বরে স্টোরি (WhatsApp Status) দেওয়া। শুধু মালিক (OWNER_NUMBERS / বটের নম্বর)।
 *  • .story <লেখা>                       → টেক্সট স্টোরি (র‍্যান্ডম ব্যাকগ্রাউন্ড)
 *  • ছবি/ভিডিও/ভয়েস-এ রিপ্লাই দিয়ে .story [ক্যাপশন]   → মিডিয়া স্টোরি
 *  • ছবি/ভিডিও পাঠানোর সময় ক্যাপশনে .story [ক্যাপশন]    → মিডিয়া স্টোরি
 *  • যেকোনো টেক্সট মেসেজে রিপ্লাই দিয়ে .story           → ওই লেখা স্টোরি
 * অডিয়েন্স: গ্রুপে লিখলে ওই গ্রুপের সদস্যরা; প্রাইভেটে লিখলে বট যত গ্রুপে আছে সবার সদস্যরা।
 * ফ্ল্যাগ: --all (সব গ্রুপের সদস্য) | --here (শুধু এই গ্রুপ)
 * যত খুশি বার ব্যবহার করা যায়।
 */
const COLORS = ['#128C7E', '#075E54', '#6C3483', '#C0392B', '#1F618D', '#B9770E', '#117A65', '#7D3C98', '#2C3E50', '#D35400'];
const rand = (a) => a[Math.floor(Math.random() * a.length)];

/** স্টোরির দর্শক-তালিকার জন্য ফোন-নম্বর JID (LID হলে সম্ভব হলে ফোন JID নেয়) */
const viewerJid = (p) => {
  const cands = [p.phoneNumber, p.jid, p.id].filter((x) => typeof x === 'string');
  return norm(cands.find((x) => x.endsWith('@s.whatsapp.net')) || cands[0] || pid(p));
};

async function audience(c, scope) {
  const set = new Set([norm(c.sock.user.id)]);
  if (scope === 'here' && c.isGroup && c.meta) {
    c.meta.participants.forEach((p) => set.add(viewerJid(p)));
  } else {
    const all = await c.sock.groupFetchAllParticipating().catch(() => ({}));
    Object.values(all).forEach((m) => (m.participants || []).forEach((p) => set.add(viewerJid(p))));
  }
  return [...set].filter(Boolean);
}

export function registerStory(commands, { rest, alert }) {
  const p = config.prefix;

  commands.story = {
    alias: ['status', 'poststory'],
    run: async (c) => {
      if (!c.isOwner) return c.reply(alert(c, '⛔', 'Owner Only', 'Only the bot owner can post stories.'));

      // ফ্ল্যাগ আলাদা করা
      let body = rest(c);
      let scope = c.isGroup ? 'here' : 'all';
      body = body.replace(/(^|\s)--(all|here)(?=\s|$)/gi, (_, sp, f) => {
        scope = f.toLowerCase();
        return sp;
      }).trim();

      // মিডিয়া খোঁজা: নিজের মেসেজে, নইলে রিপ্লাই করা মেসেজে
      const q = c.ctx.quotedMessage;
      const pick = (m = {}) =>
        m.imageMessage ? ['image', m.imageMessage] : m.videoMessage ? ['video', m.videoMessage] : m.audioMessage ? ['audio', m.audioMessage] : null;
      let media = pick(c.content);
      let source = c.msg;
      if (!media && q) {
        media = pick(q);
        source = { key: { remoteJid: c.jid, id: c.ctx.stanzaId, participant: c.ctx.participant, fromMe: false }, message: q };
      }
      const quotedText = q ? q.conversation || q.extendedTextMessage?.text || '' : '';

      if (!media && !body && !quotedText) {
        return c.reply(
          `📖 *Story*\n` +
            `• ${p}story <text> — text story\n` +
            `• Reply to a photo/video/voice with ${p}story [caption]\n` +
            `• Reply to any text with ${p}story\n` +
            `Audience: ${c.isGroup ? 'this group' : 'all my groups'} — add --all or --here to change.`,
        );
      }

      const statusJidList = await audience(c, scope);
      if (statusJidList.length < 2) return c.reply(alert(c, '⚠️', 'No Viewers', 'I could not find any members to show the story to.'));

      let content;
      const opts = { statusJidList };
      if (media) {
        const [kind] = media;
        const buffer = await downloadMediaMessage(source, 'buffer', {}, { logger: undefined, reuploadRequest: c.sock.updateMediaMessage });
        content =
          kind === 'image'
            ? { image: buffer, caption: body }
            : kind === 'video'
              ? { video: buffer, caption: body }
              : { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' };
        if (kind === 'audio') opts.backgroundColor = rand(COLORS);
      } else {
        content = { text: body || quotedText };
        opts.backgroundColor = rand(COLORS);
        opts.font = Math.floor(Math.random() * 5);
      }

      await c.sock.sendMessage('status@broadcast', content, opts);
      await c.reply(`✅ Story posted — visible to ${statusJidList.length - 1} people (${scope === 'here' ? 'this group' : 'all groups'}).\nPost another any time with ${p}story.`);
    },
  };
}
