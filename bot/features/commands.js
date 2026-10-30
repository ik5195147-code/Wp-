import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, persist, isPrivate, setPrivate } from '../lib/store.js';
import { UserError, chunk, sleep, norm, pid, findParticipant, numberOf } from '../lib/utils.js';
import { FEATURES, findFeature } from '../lib/features.js';
import { FONTS, FONT_NAMES, applyFont } from '../lib/fonts.js';
import { LANG_NAMES } from '../lib/i18n.js';
import {
  THEMES,
  THEME_NAMES,
  ctx as designCtx,
  frame,
  renderTagAll,
  renderWelcome,
  renderGoodbye,
  renderClosed,
  renderOpened,
  renderFeaturePanel,
  renderWarn,
  renderLevelUp,
  renderRankCard,
  renderVerified,
  renderAdminEvent,
  renderLinkWarn,
  renderLinkKick,
  renderMentionWarn,
  renderWarnKick,
  renderVerify,
  card,
  stamp,
} from '../lib/render.js';
import { sendHelp } from './help.js';
import { sendWelcome, formatLog } from './groupEvents.js';
import { addWarning } from './moderation.js';
import { topMembers, topMessages, topXp, rankOf } from './stats.js';
import { youtubeSearch, spotifySearch } from './music.js';
import { registerExtras } from './extras.js';
import { registerStory } from './story.js';

const p = config.prefix;
const rest = (c) => c.text.replace(/^\S+\s*/, '').trim(); // কমান্ডের পরের পুরো টেক্সট (নতুন লাইন সহ)
const isAdminLike = (c) => c.isAdmin || c.isOwner;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const cooldown = new Map();
const pendingKick = new Map();

function limited(c, secs = 8) {
  const last = cooldown.get(c.sender) || 0;
  if (Date.now() - last < secs * 1000) return true;
  cooldown.set(c.sender, Date.now());
  return false;
}

const isBotJid = (c, jid) =>
  areJidsSameUser(jid, norm(c.sock.user.id)) ||
  (!!c.sock.user.lid && areJidsSameUser(jid, norm(c.sock.user.lid)));

/** মেনশন করা (বা রিপ্লাই করা) সদস্যদের খুঁজে বের করে → [{ jid, part }] */
function resolveTargets(c, max = 5) {
  const raw = new Set((c.ctx.mentionedJid || []).map(norm));
  if (!raw.size && c.ctx.participant) raw.add(norm(c.ctx.participant));
  return [...raw].slice(0, max).map((j) => {
    const part = findParticipant(c.meta, j);
    return { jid: part ? pid(part) : j, part };
  });
}

const keyFor = (obj, jid) => Object.keys(obj).find((k) => areJidsSameUser(k, jid));

/** থিম/ফন্ট বদলানোর পর দেখানোর ছোট নমুনা। */
function themeSample(st) {
  const ids = ['8801XXXXXXXXX@s.whatsapp.net', '8801YYYYYYYYY@s.whatsapp.net', '8801ZZZZZZZZZ@s.whatsapp.net'];
  return renderTagAll(st, { group: 'Sample Group', total: 3, note: 'Preview', ids })[0].text;
}

/* ---------- কমান্ডের উত্তর ফ্রেম-কার্ডে ---------- */
const stOf = (c) => (c.isGroup ? getGroup(c.jid).settings : config.defaults);
const note = (c, { kind = 'info', icon = 'ℹ️', title, lines = [], extra = [], foot = '' }) =>
  card(stOf(c), { kind, icon, title, lines, extra, foot });
const kv = (c, emoji, label, value) => `${emoji} ${designCtx(stOf(c)).fl(label)} : ${value}`;
/** ছোট সতর্ক/ত্রুটির কার্ড */
function alert(c, icon, title, text, kind = 'warn') {
  return note(c, { kind, icon, title, lines: [`${icon} ${designCtx(stOf(c)).f(text)}`] });
}

const botAdminNote = '⚠️ I am not a group admin yet — deleting messages and removing members will not work.';

function toggleCard(c, ft, on, needsAdmin) {
  const { f } = designCtx(stOf(c));
  return note(c, {
    kind: on ? 'ok' : 'info',
    icon: on ? '✅' : '❌',
    title: on ? 'Feature Enabled' : 'Feature Disabled',
    lines: [kv(c, '🧩', 'Feature', f(ft.label)), kv(c, '🔘', 'Status', on ? 'ON' : 'OFF')],
    extra: [`📝 ${f(ft.desc)}`],
    foot: needsAdmin ? botAdminNote : '',
  });
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

      if (!c.isGroup) return c.reply(alert(c, 'ℹ️', 'Group Only', 'Features can only be switched on or off inside a group.', 'info'));
      if (!isAdminLike(c)) return c.reply(alert(c, '⛔', 'Admins Only', 'Only group admins can switch features on or off.'));

      const state = (b || '').toLowerCase();
      if (!['on', 'off'].includes(state)) {
        return c.reply(
          `✏️ Usage: ${p}help <number or name> on|off\n` +
            `e.g. ${p}help 1 on • ${p}help antilink off • ${p}help all off`,
        );
      }

      const targets = a.toLowerCase() === 'all' ? FEATURES : [findFeature(a)].filter(Boolean);
      if (!targets.length) return c.reply(`❓ No such feature. Send ${p}help to see the numbered list.`);

      const st = getGroup(c.jid).settings;
      for (const ft of targets) st[ft.key] = state === 'on';
      persist();

      const on = state === 'on';
      const needsAdmin = on && targets.some((t) => t.needsBotAdmin) && !c.botIsAdmin;
      const head =
        targets.length === 1
          ? toggleCard(c, targets[0], on, needsAdmin)
          : note(c, {
              kind: on ? 'ok' : 'info',
              icon: on ? '✅' : '❌',
              title: on ? 'All Features Enabled' : 'All Features Disabled',
              lines: [kv(c, '🧩', 'Features', targets.length), kv(c, '🔘', 'Status', on ? 'ON' : 'OFF')],
              foot: needsAdmin ? botAdminNote : '',
            });
      await c.reply(`${head}\n\n${renderFeaturePanel(st, FEATURES)}`);
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
      await c.reply(renderClosed(getGroup(c.jid).settings, rest(c), { by: c.sender }), { mentions: [c.sender] });
    },
  },
  unmute: {
    alias: ['open'],
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      await c.sock.groupSettingUpdate(c.jid, 'not_announcement');
      await c.reply(renderOpened(getGroup(c.jid).settings, rest(c), { by: c.sender }), { mentions: [c.sender] });
    },
  },

  /* ---- শিডিউল: প্রতিদিন নির্দিষ্ট সময়ে গ্রুপ বন্ধ/খোলা ---- */
  autoclose: {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const [a, b] = c.args;
      if (!a) {
        const { close, open } = g.schedule;
        return c.reply(
          close && open
            ? note(c, {
                kind: 'lock',
                icon: '⏰',
                title: 'Auto-Close',
                lines: [kv(c, '🔘', 'Status', 'ON'), kv(c, '🔒', 'Closes', close), kv(c, '🔓', 'Opens', open), kv(c, '🌍', 'Zone', config.timeZone)],
                foot: `Turn off: ${p}autoclose off`,
              })
            : note(c, {
                kind: 'info',
                icon: '⏰',
                title: 'Auto-Close',
                lines: [kv(c, '🔘', 'Status', 'OFF')],
                foot: `Usage: ${p}autoclose 23:00 06:00  (close time, open time — 24-hour, ${config.timeZone})`,
              }),
        );
      }
      if (a.toLowerCase() === 'off') {
        g.schedule = {};
        persist();
        return c.reply(note(c, { kind: 'info', icon: '❌', title: 'Auto-Close Off', lines: [kv(c, '🔘', 'Status', 'OFF')] }));
      }
      if (!HHMM.test(a) || !HHMM.test(b || '') || a === b) {
        return c.reply(`❓ Use two different times in 24-hour format, e.g. ${p}autoclose 23:00 06:00`);
      }
      g.schedule = { close: a, open: b };
      persist();
      await c.reply(
        note(c, {
          kind: 'lock',
          icon: '⏰',
          title: 'Auto-Close Set',
          lines: [kv(c, '🔒', 'Closes', a), kv(c, '🔓', 'Opens', b), kv(c, '🌍', 'Zone', config.timeZone)],
          foot: c.botIsAdmin ? '🔁 Repeats every day at these times.' : botAdminNote,
        }),
      );
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
  hidetag: {
    alias: ['announce'],
    group: true,
    admin: true,
    run: async (c) => {
      const text = rest(c);
      if (!text) return c.reply(`✏️ Usage: ${p}hidetag <message> — notifies everyone without listing them`);
      await c.sock.sendMessage(c.jid, { text, mentions: c.meta.participants.map(pid) });
    },
  },

  /* ---- কিক অল (দুই ধাপের কনফার্মেশন, শুধু ক্রিয়েটর/মালিক) ---- */
  kickall: { group: true, admin: true, botAdmin: true, run: kickAll },

  /* ---- সদস্য ম্যানেজমেন্ট: kick / promote / demote ---- */
  kick: {
    alias: ['remove'],
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const targets = resolveTargets(c);
      if (!targets.length) return c.reply(`✏️ Usage: ${p}kick @user  (or reply to their message)`);
      const ok = [];
      for (const t of targets) {
        if (t.part?.admin || isBotJid(c, t.jid)) continue;
        try {
          await c.sock.groupParticipantsUpdate(c.jid, [t.jid], 'remove');
          ok.push(t.jid);
        } catch (e) {
          console.error('[kick]', e.message);
        }
        await sleep(800);
      }
      if (!ok.length) return c.reply(alert(c, '⚠️', 'Nobody Removed', 'Admins and the bot cannot be removed.'));
      await c.reply(
        note(c, {
          kind: 'ban',
          icon: '🚪',
          title: 'Member Removed',
          lines: ok.map((j) => `🚪 @${numberOf(j)}`),
          extra: [kv(c, '🛡️', 'By', `@${numberOf(c.sender)}`)],
        }),
        { mentions: [...ok, c.sender] },
      );
    },
  },
  promote: {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const targets = resolveTargets(c).filter((t) => !t.part?.admin);
      if (!targets.length) return c.reply(`✏️ Usage: ${p}promote @user  (they must not be an admin already)`);
      await c.sock.groupParticipantsUpdate(c.jid, targets.map((t) => t.jid), 'promote');
      const ids = targets.map((t) => t.jid);
      const adminCount = c.meta.participants.filter((x) => x.admin).length + ids.length;
      await c.reply(
        renderAdminEvent(getGroup(c.jid).settings, { kind: 'promote', ids, by: c.sender, adminCount, time: stamp() }),
        { mentions: [...ids, c.sender] },
      );
    },
  },
  demote: {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const targets = resolveTargets(c).filter((t) => t.part?.admin === 'admin' && !isBotJid(c, t.jid));
      if (!targets.length) return c.reply(`✏️ Usage: ${p}demote @admin  (the group creator cannot be demoted)`);
      await c.sock.groupParticipantsUpdate(c.jid, targets.map((t) => t.jid), 'demote');
      const ids = targets.map((t) => t.jid);
      const adminCount = Math.max(c.meta.participants.filter((x) => x.admin).length - ids.length, 0);
      await c.reply(
        renderAdminEvent(getGroup(c.jid).settings, { kind: 'demote', ids, by: c.sender, adminCount, time: stamp() }),
        { mentions: [...ids, c.sender] },
      );
    },
  },

  /* ---- ওয়ার্ন সিস্টেম ---- */
  warn: {
    group: true,
    admin: true,
    run: async (c) => {
      const t = resolveTargets(c, 1)[0];
      if (!t) return c.reply(`✏️ Usage: ${p}warn @user [reason]  (or reply to their message)`);
      if (t.part?.admin || isBotJid(c, t.jid)) return c.reply('⛔ I cannot warn admins or myself.');
      const reason = rest(c).replace(/@\d+/g, '').trim();
      await addWarning(c.sock, { jid: c.jid, target: t.jid, by: c.sender, reason, botIsAdmin: c.botIsAdmin });
    },
  },
  resetwarn: {
    alias: ['clearwarn'],
    group: true,
    admin: true,
    run: async (c) => {
      const t = resolveTargets(c, 1)[0];
      if (!t) return c.reply(`✏️ Usage: ${p}resetwarn @user`);
      const g = getGroup(c.jid);
      const k = keyFor(g.warnings, t.jid);
      if (k) delete g.warnings[k];
      persist();
      await c.reply(
        note(c, {
          kind: 'ok',
          icon: '♻️',
          title: 'Warnings Cleared',
          lines: [kv(c, '👤', 'User', `@${numberOf(t.jid)}`)],
          extra: [kv(c, '🛡️', 'By', `@${numberOf(c.sender)}`)],
        }),
        { mentions: [t.jid, c.sender] },
      );
    },
  },
  warns: {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      // সাধারণ সদস্য শুধু নিজেরটা দেখতে পারে
      const target = (isAdminLike(c) && resolveTargets(c, 1)[0]?.jid) || c.sender;
      const k = keyFor(g.warnings, target);
      const list = k ? g.warnings[k] : [];
      const lines = list.length
        ? list.map((w, i) => {
            const d = new Date(w.ts).toLocaleDateString('en-GB', { timeZone: config.timeZone, day: '2-digit', month: 'short' });
            return `${i + 1}. ${d}${w.reason ? ` — ${designCtx(g.settings).L.reasons?.[w.reason] ?? w.reason}` : ''}`;
          })
        : ['No warnings 🎉'];
      await c.reply(`📋 *Warnings for @${numberOf(target)}* (${list.length}/${config.warnLimit})\n${lines.join('\n')}`, {
        mentions: [target],
      });
    },
  },

  /* ---- ব্যাড-ওয়ার্ড তালিকা ---- */
  addword: {
    alias: ['addbadword'],
    group: true,
    admin: true,
    run: async (c) => {
      const raw = rest(c).toLowerCase();
      const words = (raw.includes(',') ? raw.split(',') : raw.split(/\s+/)).map((w) => w.trim()).filter(Boolean);
      if (!words.length) return c.reply(`✏️ Usage: ${p}addword word1 word2  (or comma-separated phrases)`);
      const g = getGroup(c.jid);
      const fresh = words.filter((w) => !g.badwords.includes(w));
      g.badwords.push(...fresh);
      if (g.badwords.length > 200) g.badwords.length = 200;
      persist();
      await c.reply(
        `✅ Added ${fresh.length} word(s). Total: ${g.badwords.length}.` +
          (g.settings.antiword ? '' : `\n💡 The filter is OFF — turn it on with ${p}help wordfilter on`),
      );
    },
  },
  delword: {
    alias: ['removeword'],
    group: true,
    admin: true,
    run: async (c) => {
      const w = rest(c).toLowerCase();
      if (!w) return c.reply(`✏️ Usage: ${p}delword <word>`);
      const g = getGroup(c.jid);
      const before = g.badwords.length;
      g.badwords = g.badwords.filter((x) => x !== w);
      persist();
      await c.reply(before === g.badwords.length ? '❓ That word is not in the list.' : `🗑️ Removed "${w}".`);
    },
  },
  words: {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      await c.reply(
        g.badwords.length
          ? `🚷 *Banned words* (${g.badwords.length})\n${g.badwords.join(', ')}\n\nFilter: ${g.settings.antiword ? '✅ ON' : '❌ OFF'}`
          : `📭 No banned words yet. Add some with ${p}addword`,
      );
    },
  },

  /* ---- নতুন সদস্যের ভেরিফিকেশন উত্তর ---- */
  verify: {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const k = keyFor(g.pending, c.sender);
      if (!k) return c.reply('ℹ️ You have no pending verification.');
      const ans = Number(c.args[0]);
      if (!Number.isFinite(ans)) return c.reply(`✏️ Send the answer like this: ${p}verify 12`);
      if (ans !== g.pending[k].a + g.pending[k].b) return c.reply('❌ Wrong answer — try again.');
      delete g.pending[k];
      persist();
      await c.reply(renderVerified(g.settings, `@${numberOf(c.sender)}`), { mentions: [c.sender] });
    },
  },

  /* ---- কাস্টম টেক্সট ---- */
  setwelcome: textSetter('welcomeCustom', 'Welcome text', '{user} {group} {count}'),
  setgoodbye: textSetter('goodbyeCustom', 'Goodbye text', '{user} {group} {count}'),
  setrules: textSetter('rules', 'Group rules'),

  /* ---- ডিজাইন: থিম / ফন্ট / ভাষা / ওয়েলকাম-স্টাইল / প্রিভিউ ---- */
  theme: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const name = (c.args[0] || '').toLowerCase();
      if (!name) {
        const list = THEME_NAMES.map((n) => `${n === st.theme ? '👉' : '▫️'} ${n} — ${THEMES[n].label}`).join('\n');
        return c.reply(`🎨 *Themes*\n${list}\n\nChange: ${p}theme <name>`);
      }
      if (!THEMES[name]) return c.reply(`❓ No such theme. Send ${p}theme to see the list.`);
      st.theme = name;
      persist();
      await c.reply(`✅ Theme: ${THEMES[name].label}\n\n${themeSample(st)}`);
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
        return c.reply(
          `🔤 *Fonts*\n${n0(st.font)}\n${list}\n\nChange: ${p}font <name>\nUse the theme's own mix: ${p}font auto`,
        );
      }
      const name = raw === 'none' ? 'normal' : raw;
      if (name !== 'auto' && !FONTS[name]) return c.reply(`❓ No such font. Send ${p}font to see the list.`);
      st.font = name;
      persist();
      await c.reply(
        `✅ Font: ${name}\n\n` +
          (name === 'auto' ? themeSample(st) : applyFont(name, 'Warm welcome to you!')),
      );
    },
  },
  lang: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const l = (c.args[0] || '').toLowerCase();
      if (!LANG_NAMES.includes(l)) return c.reply(`🌐 Current language: ${st.lang}\nChange: ${p}lang en  or  ${p}lang bn`);
      st.lang = l;
      persist();
      await c.reply(`✅ Group message language: ${l === 'en' ? 'English' : 'বাংলা'}`);
    },
  },
  welcomestyle: {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const v = (c.args[0] || '').toLowerCase();
      if (!['card', 'photo', 'text'].includes(v)) {
        return c.reply(
          `🖼️ Welcome style: *${st.welcomeStyle}*\n` +
            `• card — message with the member's profile picture on the side\n` +
            `• photo — big photo with the text as caption\n` +
            `• text — text only\n\nChange: ${p}welcomestyle card|photo|text`,
        );
      }
      st.welcomeStyle = v;
      persist();
      await c.reply(`✅ Welcome style: *${v}*  — test it with ${p}preview welcome`);
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
      const me = `@${numberOf(c.sender)}`;
      if (what === 'welcome') return sendWelcome(c.sock, c.jid, st, [c.sender], group, count);
      if (what === 'goodbye') {
        return c.sock.sendMessage(c.jid, { text: renderGoodbye(st, { ids: [c.sender], group, count }), mentions: [c.sender] });
      }
      if (what === 'tagall') {
        const ids = c.meta.participants.slice(0, 5).map(pid);
        const [m] = renderTagAll(st, { group, total: count, note: 'Preview', ids });
        return c.sock.sendMessage(c.jid, m);
      }
      if (what === 'mute' || what === 'close') return c.reply(`${renderClosed(st, '', { by: c.sender })}\n\n— — —\n\n${renderOpened(st, '', { by: c.sender })}`, { mentions: [c.sender] });
      if (what === 'rank') {
        const r = rankOf(c.jid, c.sender);
        return c.reply(renderRankCard(st, { user: me, ...r, xp: r.xp || 640 }), { mentions: [c.sender] });
      }
      if (what === 'warn') {
        return c.reply(renderWarn(st, { user: me, jid: c.sender, auto: true, n: 1, max: config.warnLimit, reason: 'flood' }), { mentions: [c.sender] });
      }
      if (what === 'levelup') return c.reply(renderLevelUp(st, { user: me, level: 5, xp: 2640 }), { mentions: [c.sender] });
      // নমুনা সংখ্যা দেখিয়ে ডিজাইন প্রিভিউ (আসল সীমা LINK_WARN_LIMIT অনুযায়ী)
      if (what === 'promote' || what === 'demote' || what === 'admin') {
        const kind = what === 'demote' ? 'demote' : 'promote';
        const adminCount = c.meta.participants.filter((x) => x.admin).length;
        return c.reply(renderAdminEvent(st, { kind, ids: [c.sender], by: c.sender, adminCount, time: stamp() }), {
          mentions: [c.sender],
        });
      }
      if (what === 'antilink' || what === 'linkkick') {
        const card = { user: me, jid: c.sender, n: what === 'antilink' ? 1 : 3, max: 3 };
        const text = what === 'antilink' ? renderLinkWarn(st, card) : renderLinkKick(st, card);
        return c.reply(text, { mentions: [c.sender] });
      }
      if (what === 'verify') {
        return c.reply(renderVerify(st, { user: me, a: 4, b: 7, minutes: config.verifyMinutes, prefix: p }), { mentions: [c.sender] });
      }
      if (what === 'mention') return c.reply(renderMentionWarn(st, me, c.sender), { mentions: [c.sender] });
      if (what === 'warnkick') {
        return c.reply(renderWarnKick(st, { user: me, jid: c.sender, max: config.warnLimit }), { mentions: [c.sender] });
      }
      return c.reply(
        `🔎 Usage: ${p}preview welcome|goodbye|tagall|mute|rank|warn|warnkick|levelup|promote|demote|antilink|linkkick|mention|verify`,
      );
    },
  },

  /* ---- অ্যাডমিন লগ ---- */
  adminlog: {
    group: true,
    admin: true,
    run: (c) => {
      const n = Math.min(Math.max(Number(c.args[0]) || 10, 1), 30);
      const log = getGroup(c.jid).adminLog.slice(-n).reverse();
      if (!log.length) return c.reply('📭 No admin activity recorded yet.');
      const mentions = new Set();
      const lines = log.map((e) => formatLog(e, mentions));
      return c.reply(`🛡️ *Admin activity log* (latest ${log.length})\n\n${lines.join('\n')}`, {
        mentions: [...mentions],
      });
    },
  },

  /* ---- গ্রুপ ইনফো / ইনভাইট লিঙ্ক / রুলস / পিং ---- */
  info: {
    alias: ['groupinfo'],
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const st = g.settings;
      const { th, ft } = designCtx(st);
      const admins = c.meta.participants.filter((x) => x.admin).length;
      const created = c.meta.creation
        ? new Date(c.meta.creation * 1000).toLocaleDateString('en-GB', { timeZone: config.timeZone, day: '2-digit', month: 'short', year: 'numeric' })
        : '—';
      const lines = [
        `📛 Name : ${c.meta.subject}`,
        `👥 Members : ${c.meta.participants.length}  •  🛡️ Admins : ${admins}`,
        `${c.meta.announce ? '🔒 Closed (admins only)' : '🔓 Open'}`,
        `⏰ Auto-close : ${g.schedule.close ? `${g.schedule.close} → ${g.schedule.open}` : 'off'}`,
        `🎨 ${THEMES[st.theme]?.label || st.theme} • ${st.font} • ${st.lang}`,
        `📅 Created : ${created}`,
      ];
      await c.reply(frame(th, ft('Group Info'), lines));
    },
  },
  rules: {
    group: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const { th, ft } = designCtx(st);
      await c.reply(frame(th, ft('Rules'), String(st.rules).split('\n')));
    },
  },
  link: {
    alias: ['invite'],
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const code = await c.sock.groupInviteCode(c.jid);
      await c.reply(`🔗 https://chat.whatsapp.com/${code}`);
    },
  },
  /* ---- প্রাইভেট মোড: শুধু বটের নম্বর (ও OWNER_NUMBERS) বট চালাতে পারে ---- */
  private: {
    alias: ['self', 'mode'],
    run: async (c) => {
      if (!c.isOwner) return c.reply(alert(c, '⛔', 'Owner Only', 'Only the bot owner can change the private mode.'));
      const arg = (c.args[0] || '').toLowerCase();
      if (['on', 'private', 'self'].includes(arg)) setPrivate(true);
      else if (['off', 'public'].includes(arg)) setPrivate(false);
      else {
        return c.reply(
          note(c, {
            kind: 'info',
            icon: '🔐',
            title: 'Private Mode',
            lines: [kv(c, '🔘', 'Mode', isPrivate() ? 'Private' : 'Public')],
            foot: `Change: ${p}private on  or  ${p}private off`,
          }),
        );
      }
      const on = isPrivate();
      await c.reply(
        note(c, {
          kind: on ? 'lock' : 'unlock',
          icon: on ? '🔐' : '🌐',
          title: on ? 'Private Mode ON' : 'Private Mode OFF',
          lines: [
            kv(c, '🔘', 'Mode', on ? 'Private' : 'Public'),
            kv(c, '👤', 'Access', on ? `Bot number${config.owners.length ? ` + ${config.owners.length} owner(s)` : ' only'}` : 'Everyone (as per role)'),
          ],
          extra: on ? [`🛡️ ${designCtx(stOf(c)).f('Auto-moderation and welcome keep working')}`] : [],
          foot: on ? `Others get no reply. Turn off: ${p}private off` : `Commands work for everyone again. Turn on: ${p}private on`,
        }),
      );
    },
  },
  ping: {
    run: async (c) => {
      const s = Math.floor(process.uptime());
      const up = `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
      await c.reply(
        note(c, {
          kind: 'ok',
          icon: '🏓',
          title: 'Pong!',
          lines: [kv(c, '⏱️', 'Uptime', up), kv(c, '🔐', 'Mode', isPrivate() ? 'Private' : 'Public')],
        }),
      );
    },
  },

  /* ---- র‍্যাঙ্ক / লিডারবোর্ড / টপ / হাইলাইটস ---- */
  rank: {
    alias: ['level', 'card'],
    group: true,
    run: async (c) => {
      const t = resolveTargets(c, 1)[0];
      const target = t?.jid || c.sender;
      const st = getGroup(c.jid).settings;
      const r = rankOf(c.jid, target);
      await c.reply(renderRankCard(st, { user: `@${numberOf(target)}`, ...r }), { mentions: [target] });
    },
  },
  leaderboard: {
    alias: ['lb', 'xp'],
    group: true,
    run: (c) => {
      const { text, mentions } = topXp(c.jid, c.args[0]);
      return c.reply(text, { mentions });
    },
  },
  top: {
    alias: ['active'],
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
      if (!q) return c.reply(`🎵 Usage: ${p}play <song name>`);
      if (limited(c)) return c.reply('⏳ Please wait a moment and try again.');
      const [r] = await youtubeSearch(q, 1);
      if (!r) return c.reply('😕 Nothing found.');
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
      if (!q) return c.reply(`🎵 Usage: ${p}yts <song name>`);
      if (limited(c)) return c.reply('⏳ Please wait a moment and try again.');
      const results = await youtubeSearch(q, 5);
      if (!results.length) return c.reply('😕 Nothing found.');
      const lines = results.map((r, i) => `${i + 1}. *${r.title}*\n   📺 ${r.channel}\n   ${r.url}`);
      await c.reply(`🔎 *YouTube results:* ${q}\n\n${lines.join('\n\n')}`);
    },
  },
  spotify: {
    run: async (c) => {
      const q = rest(c);
      if (!q) return c.reply(`🎧 Usage: ${p}spotify <song name>`);
      if (limited(c)) return c.reply('⏳ Please wait a moment and try again.');
      const results = await spotifySearch(q, 5);
      if (!results.length) return c.reply('😕 Nothing found.');
      const lines = results.map(
        (r, i) => `${i + 1}. *${r.title}* — ${r.artists}\n   💿 ${r.album} • ⏱ ${r.duration}\n   ${r.url}`,
      );
      await c.reply(`🎧 *Spotify results:* ${q}\n\n${lines.join('\n\n')}`);
    },
  },
};

const n0 = (font) => (font === 'auto' ? '👉 auto — each theme uses its own font mix' : '▫️ auto — each theme uses its own font mix');

// সরাসরি অন/অফ কমান্ড (.antilink on|off ইত্যাদি) — .help <নম্বর> on|off এরও বিকল্প
for (const ft of FEATURES) {
  commands[ft.cmd] = {
    group: true,
    admin: true,
    run: async (c) => {
      const st = getGroup(c.jid).settings;
      const arg = (c.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(arg)) {
        return c.reply(`${st[ft.key] ? '✅' : '❌'} *${ft.label}* is currently *${st[ft.key] ? 'ON' : 'OFF'}*\nUsage: ${p}${ft.cmd} on|off`);
      }
      st[ft.key] = arg === 'on';
      persist();
      await c.reply(toggleCard(c, ft, arg === 'on', arg === 'on' && ft.needsBotAdmin && !c.botIsAdmin));
    },
  };
}

// নতুন কমান্ডগুলো (extras.js) — অন/অফ কমান্ডের পরে বসে, তাই countrylock/slowmode-এর বিস্তারিত রূপটি জেতে
registerExtras(commands, { note, kv, alert, rest, resolveTargets, isBotJid, stOf, botAdminNote });
registerStory(commands, { rest, alert });

// প্রাইভেট মোডেও যেগুলো সদস্যরা চালাতে পারবে: ভেরিফিকেশনের উত্তর এবং মালিকের শুরু করা কুইজ/গিভঅ্যাওয়েতে অংশগ্রহণ।
// (এগুলো কিছুই করে না যদি না মালিক আগে কুইজ/গিভঅ্যাওয়ে শুরু করেন।)
const PRIVATE_OK = new Set(['verify', 'a', 'b', 'c', 'd', 'ans', 'enter'].map((n) => commands[n]).filter(Boolean));

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

  // প্রাইভেট মোডে বটের নম্বর (ও OWNER_NUMBERS) ছাড়া কেউ কমান্ড চালাতে পারে না — কোনো উত্তরও যায় না।
  // ব্যতিক্রম: PRIVATE_OK (ভেরিফাই, কুইজের উত্তর, গিভঅ্যাওয়ে এন্টার)।
  if (isPrivate() && !c.isOwner && !PRIVATE_OK.has(def)) return;

  c.args = args;
  c.cmd = raw.toLowerCase();
  c.reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg });

  try {
    if (def.group && !c.isGroup) return await c.reply(alert(c, 'ℹ️', 'Group Only', 'This command only works in groups.', 'info'));
    if (def.admin && !isAdminLike(c)) return await c.reply(alert(c, '⛔', 'Admins Only', 'Only group admins can use this command.'));
    if (def.botAdmin && !c.botIsAdmin) {
      return await c.reply(alert(c, '⚠️', 'Bot Needs Admin', 'Please make me a group admin first, then this command will work.'));
    }
    await def.run(c);
  } catch (e) {
    if (e instanceof UserError) return c.reply(alert(c, '⚠️', 'Notice', e.message)).catch(() => {});
    console.error(`[cmd:${raw}]`, e);
    await c.reply(alert(c, '❌', 'Something Went Wrong', 'Please try again in a moment.', 'ban')).catch(() => {});
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
        const hint = placeholders ? `\nPlaceholders: ${placeholders}` : '';
        return c.reply(`✏️ Usage: ${p}${c.cmd} <new text>${hint}\nBack to default: ${p}${c.cmd} reset`);
      }
      const reset = value.toLowerCase() === 'reset';
      getGroup(c.jid).settings[key] = reset ? config.defaults[key] : value;
      persist();
      await c.reply(reset ? `♻️ ${label} reset to the default.` : `✅ ${label} updated. Check it with ${p}preview welcome`);
    },
  };
}

async function kickAll(c) {
  const { sock, jid, meta, sender } = c;

  // নিরাপত্তা: শুধু গ্রুপ-ক্রিয়েটর (সুপার অ্যাডমিন) বা বটের মালিক।
  // সাধারণ অ্যাডমিনদের অনুমতি দিতে চাইলে এই শর্তটি সরান।
  const isCreator = findParticipant(meta, sender)?.admin === 'superadmin';
  if (!isCreator && !c.isOwner) {
    return c.reply('⛔ `kickall` can only be used by the group creator (super admin) or the bot owner.');
  }

  const targets = meta.participants.filter((x) => !x.admin); // অ্যাডমিন ও বট বাদ
  if (!targets.length) return c.reply('ℹ️ There are no regular members to remove.');

  const key = `${jid}:${norm(sender)}`;
  if ((c.args[0] || '').toLowerCase() !== 'confirm') {
    pendingKick.set(key, Date.now());
    return c.reply(
      `⚠️ *Warning:* ${targets.length} regular members will be removed (admins are excluded).\n` +
        `To confirm within 60 seconds, send: ${p}kickall confirm`,
    );
  }

  const at = pendingKick.get(key);
  if (!at || Date.now() - at > 60_000) {
    return c.reply(`⏱ Send ${p}kickall first, then confirm within 60 seconds.`);
  }
  pendingKick.delete(key);

  await c.reply(`🧹 Removing ${targets.length} members… (in small batches, slowly, to reduce ban risk)`);

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
  await c.reply(`✅ Done: ${ok}/${targets.length} members removed.`);
}
