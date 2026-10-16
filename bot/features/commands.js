import { config } from '../config.js';
import { getGroup, persist } from '../lib/store.js';
import { UserError, chunk, sleep, norm, numberOf, pid, findParticipant } from '../lib/utils.js';
import { sendHelp } from './help.js';
import { formatLog } from './groupEvents.js';
import { topMessages, activeMembers } from './stats.js';
import { youtubeSearch, spotifySearch } from './music.js';

const p = config.prefix;
const rest = (c) => c.text.replace(/^\S+\s*/, '').trim(); // কমান্ডের পরের পুরো টেক্সট (নতুন লাইন সহ)

/* কমান্ড-নাম → { সেটিং-কী, বাংলা লেবেল, বট-অ্যাডমিন লাগে কিনা } */
const TOGGLES = {
  antisticker: { key: 'antisticker', label: 'অ্যান্টি-স্টিকার', needsBotAdmin: true },
  antimention: { key: 'antimention', label: 'অ্যান্টি-মেনশন', needsBotAdmin: true },
  antilink: { key: 'antilink', label: 'অ্যান্টি-লিঙ্ক (অটো-কিক সহ)', needsBotAdmin: true },
  welcome: { key: 'welcome', label: 'ওয়েলকাম মেসেজ' },
  goodbye: { key: 'goodbye', label: 'গুডবাই মেসেজ' },
  adminnotify: { key: 'adminlog', label: 'অ্যাডমিন ইভেন্ট নোটিফিকেশন' },
};

const cooldown = new Map();
const pendingKick = new Map();

function limited(c, secs = 8) {
  const last = cooldown.get(c.sender) || 0;
  if (Date.now() - last < secs * 1000) return true;
  cooldown.set(c.sender, Date.now());
  return false;
}

/* ------------------------------------------------------------------ */
/* কমান্ড ডিফিনিশন                                                     */
/* flags: group = শুধু গ্রুপে | admin = অ্যাডমিন/মালিক | botAdmin = বট অ্যাডমিন হতে হবে */
/* ------------------------------------------------------------------ */
const commands = {
  help: {
    alias: ['menu', 'h'],
    run: (c) => sendHelp(c.sock, c.jid, c.msg),
  },

  /* ---- গ্রুপ মিউট / আনমিউট (WhatsApp এর নিজস্ব "শুধু অ্যাডমিন মেসেজ পাঠাবে" সেটিং) ---- */
  mute: {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      await c.sock.groupSettingUpdate(c.jid, 'announcement');
      await c.reply('🔇 গ্রুপ মিউট করা হয়েছে — এখন শুধু অ্যাডমিনরা মেসেজ পাঠাতে পারবেন।');
    },
  },
  unmute: {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      await c.sock.groupSettingUpdate(c.jid, 'not_announcement');
      await c.reply('🔊 গ্রুপ আনমিউট করা হয়েছে — সবাই মেসেজ পাঠাতে পারবেন।');
    },
  },

  /* ---- ট্যাগ অল ---- */
  tagall: {
    alias: ['everyone'],
    group: true,
    admin: true,
    run: async (c) => {
      const ids = c.meta.participants.map(pid);
      const note = rest(c) || '📢 সবার জন্য জরুরি নোটিশ!';
      const parts = chunk(ids, 100); // বড় গ্রুপে ১০০ জন করে ভাগ
      for (let i = 0; i < parts.length; i++) {
        const list = parts[i].map((id) => `@${numberOf(id)}`).join(' ');
        await c.sock.sendMessage(c.jid, {
          text: `${i === 0 ? `${note}\n\n` : ''}${list}`,
          mentions: parts[i],
        });
        if (i < parts.length - 1) await sleep(1500);
      }
    },
  },

  /* ---- কিক অল (দুই ধাপের কনফার্মেশন, শুধু ক্রিয়েটর/মালিক) ---- */
  kickall: {
    group: true,
    admin: true,
    botAdmin: true,
    run: kickAll,
  },

  /* ---- কাস্টম টেক্সট সেট ---- */
  setwelcome: textSetter('welcomeText', 'ওয়েলকাম টেক্সট', '{user} {group} {count}'),
  setgoodbye: textSetter('goodbyeText', 'গুডবাই টেক্সট', '{user} {group}'),
  setrules: textSetter('rules', 'গ্রুপের নিয়মাবলী'),

  /* ---- অ্যাডমিন লগ ---- */
  adminlog: {
    group: true,
    admin: true,
    run: (c) => {
      const n = Math.min(Math.max(Number(c.args[0]) || 10, 1), 30);
      const log = getGroup(c.jid).adminLog.slice(-n).reverse();
      if (!log.length) return c.reply('📭 এখনো কোনো অ্যাডমিন ইভেন্ট রেকর্ড হয়নি।');
      const mentions = new Set();
      const lines = log.map((e) => formatLog(e, mentions));
      return c.reply(`🛡️ *অ্যাডমিন অ্যাক্টিভিটি লগ* (সর্বশেষ ${log.length}টি)\n\n${lines.join('\n')}`, {
        mentions: [...mentions],
      });
    },
  },

  /* ---- টপ মেসেজেস / সক্রিয় সদস্য ---- */
  top: {
    alias: ['highlights'],
    group: true,
    run: (c) => {
      const { text, mentions } = topMessages(c.jid, Number(c.args[0]) || 5);
      return c.reply(text, { mentions });
    },
  },
  active: {
    group: true,
    run: (c) => {
      const { text, mentions } = activeMembers(c.jid, Number(c.args[0]) || 5);
      return c.reply(text, { mentions });
    },
  },

  /* ---- মিউজিক ---- */
  play: {
    alias: ['song'],
    run: async (c) => {
      const q = rest(c);
      if (!q) return c.reply(`🎵 ব্যবহার: ${p}play <গানের নাম>`);
      if (limited(c)) return c.reply('⏳ একটু অপেক্ষা করুন, তারপর আবার চেষ্টা করুন।');
      const [r] = await youtubeSearch(q, 1);
      if (!r) return c.reply('😕 কিছু পাওয়া যায়নি।');
      const caption = `🎵 *${r.title}*\n📺 ${r.channel}\n\n▶️ ${r.url}`;
      try {
        await c.sock.sendMessage(c.jid, { image: { url: r.thumb }, caption }, { quoted: c.msg });
      } catch {
        await c.reply(caption);
      }
    },
  },
  yts: {
    run: async (c) => {
      const q = rest(c);
      if (!q) return c.reply(`🎵 ব্যবহার: ${p}yts <গানের নাম>`);
      if (limited(c)) return c.reply('⏳ একটু অপেক্ষা করুন, তারপর আবার চেষ্টা করুন।');
      const results = await youtubeSearch(q, 5);
      if (!results.length) return c.reply('😕 কিছু পাওয়া যায়নি।');
      const lines = results.map((r, i) => `${i + 1}. *${r.title}*\n   📺 ${r.channel}\n   ${r.url}`);
      await c.reply(`🔎 *YouTube ফলাফল:* ${q}\n\n${lines.join('\n\n')}`);
    },
  },
  spotify: {
    run: async (c) => {
      const q = rest(c);
      if (!q) return c.reply(`🎧 ব্যবহার: ${p}spotify <গানের নাম>`);
      if (limited(c)) return c.reply('⏳ একটু অপেক্ষা করুন, তারপর আবার চেষ্টা করুন।');
      const results = await spotifySearch(q, 5);
      if (!results.length) return c.reply('😕 কিছু পাওয়া যায়নি।');
      const lines = results.map(
        (r, i) => `${i + 1}. *${r.title}* — ${r.artists}\n   💿 ${r.album} • ⏱ ${r.duration}\n   ${r.url}`,
      );
      await c.reply(`🎧 *Spotify ফলাফল:* ${q}\n\n${lines.join('\n\n')}`);
    },
  },
};

// অন/অফ টগল কমান্ডগুলো যোগ করা
for (const [name, def] of Object.entries(TOGGLES)) {
  commands[name] = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const arg = (c.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(arg)) {
        return c.reply(
          `${def.label}: ${g.settings[def.key] ? '✅ চালু' : '❌ বন্ধ'}\nব্যবহার: ${p}${name} on|off`,
        );
      }
      g.settings[def.key] = arg === 'on';
      persist();
      const warn =
        arg === 'on' && def.needsBotAdmin && !c.botIsAdmin
          ? '\n\n⚠️ বট এখনো অ্যাডমিন নয় — মেসেজ ডিলিট/কিক কাজ করবে না।'
          : '';
      await c.reply(`${def.label} এখন ${arg === 'on' ? '✅ চালু' : '❌ বন্ধ'}।${warn}`);
    },
  };
}

// নাম ও alias থেকে দ্রুত খোঁজার ম্যাপ
const lookup = new Map();
for (const [name, def] of Object.entries(commands)) {
  lookup.set(name, def);
  (def.alias || []).forEach((a) => lookup.set(a, def));
}

/* ------------------------------------------------------------------ */
/* ডিসপ্যাচার                                                           */
/* ------------------------------------------------------------------ */
export async function runCommand(c) {
  const { text, sock, jid, msg } = c;
  if (!text.startsWith(p)) return;

  const [raw, ...args] = text.slice(p.length).trim().split(/\s+/);
  const def = lookup.get((raw || '').toLowerCase());
  if (!def) return;

  c.args = args;
  c.reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg });

  try {
    if (def.group && !c.isGroup) return await c.reply('ℹ️ এই কমান্ডটি শুধু গ্রুপে কাজ করে।');
    if (def.admin && !(c.isAdmin || c.isOwner)) return await c.reply('⛔ এই কমান্ড শুধু গ্রুপ অ্যাডমিনদের জন্য।');
    if (def.botAdmin && !c.botIsAdmin) {
      return await c.reply('⚠️ আগে আমাকে গ্রুপের অ্যাডমিন বানান, তারপর এই কমান্ড কাজ করবে।');
    }
    await def.run(c);
  } catch (e) {
    if (e instanceof UserError) return c.reply(`⚠️ ${e.message}`).catch(() => {});
    console.error(`[cmd:${raw}]`, e);
    await c.reply('❌ কমান্ড চালাতে সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।').catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* হেল্পার কমান্ড-ফ্যাক্টরি / লজিক                                      */
/* ------------------------------------------------------------------ */
function textSetter(key, label, placeholders) {
  return {
    group: true,
    admin: true,
    run: async (c) => {
      const value = rest(c);
      if (!value) {
        const hint = placeholders ? `\nপ্লেসহোল্ডার: ${placeholders}` : '';
        return c.reply(`✏️ ব্যবহার: ${c.text.split(/\s/)[0]} <নতুন টেক্সট>${hint}`);
      }
      getGroup(c.jid).settings[key] = value;
      persist();
      await c.reply(`✅ ${label} আপডেট হয়েছে।`);
    },
  };
}

async function kickAll(c) {
  const { sock, jid, meta, sender } = c;

  // নিরাপত্তা: শুধু গ্রুপ-ক্রিয়েটর (সুপার অ্যাডমিন) বা বটের মালিক।
  // সাধারণ অ্যাডমিনদের অনুমতি দিতে চাইলে এই শর্তটি সরান।
  const isCreator = findParticipant(meta, sender)?.admin === 'superadmin';
  if (!isCreator && !c.isOwner) {
    return c.reply('⛔ `kickall` শুধু গ্রুপ-ক্রিয়েটর (সুপার অ্যাডমিন) বা বটের মালিক ব্যবহার করতে পারবেন।');
  }

  const targets = meta.participants.filter((x) => !x.admin); // অ্যাডমিন ও বট বাদ
  if (!targets.length) return c.reply('ℹ️ কিক করার মতো সাধারণ সদস্য নেই।');

  const key = `${jid}:${norm(sender)}`;
  if ((c.args[0] || '').toLowerCase() !== 'confirm') {
    pendingKick.set(key, Date.now());
    return c.reply(
      `⚠️ *সতর্কতা:* ${targets.length} জন সাধারণ সদস্য রিমুভ হবে (অ্যাডমিনরা বাদ)।\n` +
        `নিশ্চিত করতে ৬০ সেকেন্ডের মধ্যে লিখুন: ${p}kickall confirm`,
    );
  }

  const at = pendingKick.get(key);
  if (!at || Date.now() - at > 60_000) {
    return c.reply(`⏱ আগে ${p}kickall লিখুন, তারপর ৬০ সেকেন্ডের মধ্যে confirm করুন।`);
  }
  pendingKick.delete(key);

  await c.reply(`🧹 ${targets.length} জন সদস্য রিমুভ শুরু হচ্ছে… (ব্যাচে ও ধীরগতিতে — ব্যান ঝুঁকি কমাতে)`);

  let ok = 0;
  for (const batch of chunk(targets.map(pid), 5)) {
    try {
      const res = await sock.groupParticipantsUpdate(jid, batch, 'remove');
      ok += res.filter((r) => String(r.status) === '200').length;
    } catch (e) {
      console.error('[kickall] batch failed:', e.message);
    }
    await sleep(2000 + Math.random() * 2000);
  }
  await c.reply(`✅ সম্পন্ন: ${ok}/${targets.length} জন রিমুভ হয়েছেন।`);
}
