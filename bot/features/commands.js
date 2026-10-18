import { config } from '../config.js';
import { getGroup, persist } from '../lib/store.js';
import { UserError, chunk, sleep, norm, pid, findParticipant } from '../lib/utils.js';
import { FEATURES, findFeature } from '../lib/features.js';
import { FONTS, FONT_NAMES, applyFont } from '../lib/fonts.js';
import { LANG_NAMES } from '../lib/i18n.js';
import {
  THEMES,
  THEME_NAMES,
  renderTagAll,
  renderWelcome,
  renderGoodbye,
  renderClosed,
  renderOpened,
  renderFeaturePanel,
} from '../lib/render.js';
import { sendHelp } from './help.js';
import { formatLog } from './groupEvents.js';
import { topMembers, topMessages } from './stats.js';
import { youtubeSearch, spotifySearch } from './music.js';

const p = config.prefix;
const rest = (c) => c.text.replace(/^\S+\s*/, '').trim(); // কমান্ডের পরের পুরো টেক্সট (নতুন লাইন সহ)
const isAdminLike = (c) => c.isAdmin || c.isOwner;

const cooldown = new Map();
const pendingKick = new Map();

function limited(c, secs = 8) {
  const last = cooldown.get(c.sender) || 0;
  if (Date.now() - last < secs * 1000) return true;
  cooldown.set(c.sender, Date.now());
  return false;
}

/** থিম বদলানোর পর দেখানোর ছোট নমুনা। */
function themeSample(st) {
  const ids = ['8801XXXXXXXXX@s.whatsapp.net', '8801YYYYYYYYY@s.whatsapp.net', '8801ZZZZZZZZZ@s.whatsapp.net'];
  return renderTagAll(st, { group: 'Sample Group', total: 3, note: 'Preview', ids })[0].text;
}

/* ------------------------------------------------------------------ */
/* কমান্ড ডিফিনিশন                                                     */
/* flags: group = শুধু গ্রুপে | admin = অ্যাডমিন/মালিক | botAdmin = বট অ্যাডমিন হতে হবে */
/* ------------------------------------------------------------------ */
const commands = {
  /* ---- হেল্প + অ্যাডমিন ফিচার টগল: .help <নম্বর|নাম|all> on|off ---- */
  help: {
    alias: ['menu', 'h'],
    run: async (c) => {
      const [a, b] = c.args;
      if (!a) return sendHelp(c.sock, c.jid, c.msg);

      if (!c.isGroup) return c.reply('ℹ️ ফিচার চালু/বন্ধ শুধু গ্রুপে করা যায়।');
      if (!isAdminLike(c)) return c.reply('⛔ ফিচার চালু/বন্ধ করা শুধু গ্রুপ অ্যাডমিনদের জন্য।');

      const state = (b || '').toLowerCase();
      if (!['on', 'off'].includes(state)) {
        return c.reply(
          `✏️ ব্যবহার: ${p}help <নম্বর বা নাম> on|off\n` +
            `যেমন: ${p}help 1 on • ${p}help antilink off • ${p}help all off`,
        );
      }

      const targets = a.toLowerCase() === 'all' ? FEATURES : [findFeature(a)].filter(Boolean);
      if (!targets.length) return c.reply(`❓ এই নামে কোনো ফিচার নেই। নম্বর/নাম দেখতে ${p}help লিখুন।`);

      const st = getGroup(c.jid).settings;
      for (const ft of targets) st[ft.key] = state === 'on';
      persist();

      const names = targets.map((t) => t.bn).join(', ');
      const warn =
        state === 'on' && targets.some((t) => t.needsBotAdmin) && !c.botIsAdmin
          ? '\n\n⚠️ বট এখনো অ্যাডমিন নয় — মেসেজ ডিলিট/কিক কাজ করবে না।'
          : '';
      await c.reply(
        `${state === 'on' ? '✅ চালু' : '❌ বন্ধ'}: ${names}\n\n${renderFeaturePanel(st, FEATURES)}${warn}`,
      );
    },
  },

  /* ---- গ্রুপ বন্ধ / খোলা (.mute = .close, .unmute = .open) ---- */
  mute: {
    alias: ['close'],
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      await c.sock.groupSettingUpdate(c.jid, 'announcement');
      await c.reply(renderClosed(getGroup(c.jid).settings, rest(c)));
    },
  },
  unmute: {
    alias: ['open'],
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      await c.sock.groupSettingUpdate(c.jid, 'not_announcement');
      await c.reply(renderOpened(getGroup(c.jid).settings));
    },
  },

  /* ---- ট্যাগ অল (থিম অনুযায়ী ফ্রেম) ---- */
  tagall: {
    alias: ['everyone'],
    group: true,
    admin: true,
    run: async (c) => {
      const ids = c.meta.participants.map(pid);
      const msgs = renderTagAll(getGroup(c.jid).settings, {
        group: c.meta.subject,
        total: ids.length,
        note: rest(c),
        ids,
      });
      for (let i = 0; i < msgs.length; i++) {
        await c.sock.sendMessage(c.jid, msgs[i], i === 0 ? { quoted: c.msg } : undefined);
        if (i < msgs.length - 1) await sleep(1500);
      }
    },
  },

  /* ---- কিক অল (দুই ধাপের কনফার্মেশন, শুধু ক্রিয়েটর/মালিক) ---- */
  kickall: { group: true, admin: true, botAdmin: true, run: kickAll },

  /* ---- কাস্টম টেক্সট ---- */
  setwelcome: textSetter('welcomeCustom', 'ওয়েলকাম টেক্সট', '{user} {group} {count}'),
  setgoodbye: textSetter('goodbyeCustom', 'গুডবাই টেক্সট', '{user} {group} {count}'),
  setrules: textSetter('rules', 'গ্রুপের নিয়মাবলী'),

  /* ---- ডিজাইন: থিম / ফন্ট / ভাষা / প্রিভিউ ---- */
  theme: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const name = (c.args[0] || '').toLowerCase();
      if (!name) {
        const list = THEME_NAMES.map((n) => `${n === st.theme ? '👉' : '▫️'} ${n} — ${THEMES[n].label}`).join('\n');
        return c.reply(`🎨 *থিম তালিকা*\n${list}\n\nবদলাতে: ${p}theme <নাম>`);
      }
      if (!THEMES[name]) return c.reply(`❓ এমন থিম নেই। ${p}theme লিখে তালিকা দেখুন।`);
      st.theme = name;
      persist();
      await c.reply(`✅ থিম: ${THEMES[name].label}\n\n${themeSample(st)}`);
    },
  },
  font: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const raw = (c.args[0] || '').toLowerCase();
      if (!raw) {
        const list = FONT_NAMES.map(
          (n) => `${n === st.font ? '👉' : '▫️'} ${n}: ${applyFont(n, 'Blooming Vibes 123')}`,
        ).join('\n');
        return c.reply(`🔤 *ফন্ট তালিকা*\n${list}\n\nবদলাতে: ${p}font <নাম>  (বন্ধ করতে: ${p}font normal)`);
      }
      const name = raw === 'none' ? 'normal' : raw;
      if (!FONTS[name]) return c.reply(`❓ এমন ফন্ট নেই। ${p}font লিখে তালিকা দেখুন।`);
      st.font = name;
      persist();
      await c.reply(`✅ ফন্ট: ${name}\n\n${applyFont(name, 'Warm welcome to you!')}`);
    },
  },
  lang: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const l = (c.args[0] || '').toLowerCase();
      if (!LANG_NAMES.includes(l)) return c.reply(`🌐 বর্তমান ভাষা: ${st.lang}\nবদলাতে: ${p}lang en  অথবা  ${p}lang bn`);
      st.lang = l;
      persist();
      await c.reply(`✅ গ্রুপ-মেসেজের ভাষা: ${l === 'en' ? 'English' : 'বাংলা'}`);
    },
  },
  preview: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const what = (c.args[0] || 'welcome').toLowerCase();
      const group = c.meta.subject;
      const count = c.meta.participants.length;
      if (what === 'welcome') {
        return c.sock.sendMessage(c.jid, { text: renderWelcome(st, { ids: [c.sender], group, count }), mentions: [c.sender] });
      }
      if (what === 'goodbye') {
        return c.sock.sendMessage(c.jid, { text: renderGoodbye(st, { ids: [c.sender], group, count }), mentions: [c.sender] });
      }
      if (what === 'tagall') {
        const ids = c.meta.participants.slice(0, 5).map(pid);
        const [m] = renderTagAll(st, { group, total: count, note: 'Preview', ids });
        return c.sock.sendMessage(c.jid, m);
      }
      if (what === 'mute' || what === 'close') return c.reply(`${renderClosed(st, '')}\n\n— — —\n\n${renderOpened(st)}`);
      return c.reply(`🔎 ব্যবহার: ${p}preview welcome|goodbye|tagall|mute`);
    },
  },

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

  /* ---- র‍্যাঙ্কিং / হাইলাইটস ---- */
  top: {
    alias: ['active', 'rank'],
    group: true,
    run: (c) => {
      const { text, mentions } = topMembers(c.jid, c.args[0], p);
      return c.reply(text, { mentions });
    },
  },
  highlights: {
    group: true,
    run: (c) => {
      const { text, mentions } = topMessages(c.jid, Number(c.args[0]) || 5);
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

// সরাসরি অন/অফ কমান্ড (.antilink on|off ইত্যাদি) — .help <নম্বর> on|off এরও বিকল্প
for (const ft of FEATURES) {
  commands[ft.cmd] = {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const arg = (c.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(arg)) {
        return c.reply(`${ft.bn}: ${st[ft.key] ? '✅ চালু' : '❌ বন্ধ'}\nব্যবহার: ${p}${ft.cmd} on|off`);
      }
      st[ft.key] = arg === 'on';
      persist();
      const warn =
        arg === 'on' && ft.needsBotAdmin && !c.botIsAdmin
          ? '\n\n⚠️ বট এখনো অ্যাডমিন নয় — মেসেজ ডিলিট/কিক কাজ করবে না।'
          : '';
      await c.reply(`${ft.bn} এখন ${arg === 'on' ? '✅ চালু' : '❌ বন্ধ'}।${warn}`);
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
  c.cmd = raw.toLowerCase();
  c.reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg });

  try {
    if (def.group && !c.isGroup) return await c.reply('ℹ️ এই কমান্ডটি শুধু গ্রুপে কাজ করে।');
    if (def.admin && !isAdminLike(c)) return await c.reply('⛔ এই কমান্ড শুধু গ্রুপ অ্যাডমিনদের জন্য।');
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
/* হেল্পার                                                              */
/* ------------------------------------------------------------------ */
function textSetter(key, label, placeholders) {
  return {
    group: true,
    admin: true,
    run: async (c) => {
      const value = rest(c);
      if (!value) {
        const hint = placeholders ? `\nপ্লেসহোল্ডার: ${placeholders}` : '';
        return c.reply(`✏️ ব্যবহার: ${p}${c.cmd} <নতুন টেক্সট>${hint}\nডিফল্টে ফেরাতে: ${p}${c.cmd} reset`);
      }
      const reset = value.toLowerCase() === 'reset';
      getGroup(c.jid).settings[key] = reset ? config.defaults[key] : value;
      persist();
      await c.reply(
        reset ? `♻️ ${label} ডিফল্টে ফিরেছে।` : `✅ ${label} আপডেট হয়েছে। দেখতে: ${p}preview welcome`,
      );
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
