import crypto from 'node:crypto';
import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, groupIds, persist } from '../lib/store.js';
import { getMeta, findParticipant, norm, numberOf, tzNow, fmtDuration } from '../lib/utils.js';
import { card, ctx as designCtx, stamp, renderLevelUp } from '../lib/render.js';
import { levelOf } from '../lib/xp.js';
import { matchesBadWord } from './moderation.js';

/**
 * অটোমেশন: কমান্ড ছাড়াই যা নিজে নিজে ঘটে।
 *  - screenJoin  : নতুন সদস্য ঢুকলে নম্বর-ফিল্টার ও ব্ল্যাকলিস্ট
 *  - onChat      : AFK ও অটো-রিপ্লাই (গ্রুপের প্রতিটি মেসেজে)
 *  - tickAutomation : প্রতি ৩০ সেকেন্ডে — ঘোষণা, গিভঅ্যাওয়ে, কুইজ টাইমআউট, মিউটের মেয়াদ, জন্মদিন
 */
export const LETTERS = ['A', 'B', 'C', 'D'];
const at = (j) => `@${numberOf(j)}`;
const findKey = (obj, jid) => Object.keys(obj).find((k) => areJidsSameUser(k, jid));
const send = (sock, jid, text, mentions = [], opts) =>
  sock.sendMessage(jid, { text, mentions }, opts).catch((e) => console.error('[auto-send]', e.message));

function sample(arr, k) {
  const a = [...arr];
  const out = [];
  while (a.length && out.length < k) out.push(a.splice(crypto.randomInt(a.length), 1)[0]);
  return out;
}

/* ------------------------------------------------------------------ */
/* XP বোনাস (কুইজ/ডেইলি) — লেভেল বাড়লে (levelup চালু থাকলে) ঘোষণা সহ       */
/* ------------------------------------------------------------------ */
export async function awardXp(sock, jid, who, amount) {
  const g = getGroup(jid);
  const m = (g.members[who] ??= { count: 0 });
  const before = levelOf(m.xp || 0);
  m.xp = (m.xp || 0) + amount;
  persist();
  const level = levelOf(m.xp);
  if (level > before && g.settings.levelup) {
    await send(sock, jid, renderLevelUp(g.settings, { user: at(who), level, xp: m.xp }), [who]);
  }
  return { xp: m.xp, level };
}

/* ------------------------------------------------------------------ */
/* জয়েন-স্ক্রিনিং: ব্ল্যাকলিস্ট + দেশের কোড। ফেরত দেয় — যারা থাকতে পেল তাদের আইডি */
/* ------------------------------------------------------------------ */
export async function screenJoin(sock, { jid, g, meta, ids, by, botIsAdmin }) {
  const s = g.settings;
  if (!botIsAdmin || (!s.countrylock && !s.blacklist)) return ids;

  // অ্যাডমিন নিজে যোগ করলে দেশের কোড দেখা হয় না (ইচ্ছাকৃত যোগ); ব্ল্যাকলিস্ট সবসময় খাটে
  const adminAdded = !!by && !!findParticipant(meta, by)?.admin;
  const blocked = [];
  for (const id of ids) {
    const n = numberOf(id);
    const isPhone = String(id).endsWith('@s.whatsapp.net'); // LID আইডিতে ফোন নম্বর জানা যায় না
    if (s.blacklist && g.blacklist.some((b) => b.n === n)) blocked.push({ id, why: 'blacklist' });
    else if (s.countrylock && isPhone && !adminAdded && !g.countryCodes.some((c) => n.startsWith(c))) {
      blocked.push({ id, why: 'country' });
    }
  }
  if (!blocked.length) return ids;

  try {
    await sock.groupParticipantsUpdate(jid, blocked.map((b) => b.id), 'remove');
  } catch (e) {
    console.error('[screenJoin]', e.message);
    return ids; // রিমুভ ব্যর্থ — ভুল ঘোষণা না করে আগের মতো এগোই
  }

  const { f, fl } = designCtx(s);
  const reasons = [...new Set(blocked.map((b) => b.why))];
  await send(
    sock,
    jid,
    card(s, {
      kind: 'ban',
      icon: '🛑',
      title: 'Join Blocked',
      lines: blocked.map((b) => `🚫 ${at(b.id)}  (+${numberOf(b.id)})`),
      extra: [
        ...(reasons.includes('blacklist') ? [`📛 ${fl('Reason')} : ${f('Blacklisted number')}`] : []),
        ...(reasons.includes('country')
          ? [`🌍 ${fl('Reason')} : ${f('Country not allowed')}`, `✅ ${fl('Allowed')} : ${g.countryCodes.map((c) => `+${c}`).join(', ')}`]
          : []),
        `🗑️ ${fl('Action')} : ${f('Removed from group')}`,
      ],
      foot: `🛡️ ${f('This group is protected. Entry is restricted.')}`,
    }),
    blocked.map((b) => b.id),
  );
  const gone = new Set(blocked.map((b) => b.id));
  return ids.filter((i) => !gone.has(i));
}

/* ------------------------------------------------------------------ */
/* AFK + অটো-রিপ্লাই                                                     */
/* ------------------------------------------------------------------ */
const afkNotified = new Map(); // "jid|target" → সময়
const replyCool = new Map(); // "jid|kw" → সময়

export async function onChat(c) {
  const { sock, jid, sender, msg } = c;
  if (msg.key.fromMe) return;
  const g = getGroup(jid);
  const s = g.settings;
  const { f, fl } = designCtx(s);
  const text = c.text || '';
  const isCmd = text.startsWith(config.prefix);
  const isAfkCmd = isCmd && /^afk\b/i.test(text.slice(config.prefix.length).trim());

  // ১) নিজে ফিরে এলে AFK মুছে দাও
  const mine = findKey(g.afk, sender);
  if (mine && !isAfkCmd) {
    const away = Date.now() - g.afk[mine].at;
    delete g.afk[mine];
    persist();
    if (away > 60_000) {
      await send(
        sock,
        jid,
        card(s, {
          kind: 'afk',
          icon: '👋',
          title: 'Welcome Back',
          lines: [`👤 ${fl('User')} : ${at(sender)}`, `⏱️ ${fl('Away for')} : ${fmtDuration(away)}`],
          foot: `🌤️ ${f('AFK mode turned off.')}`,
        }),
        [sender],
        { quoted: msg },
      );
    }
  }

  // ২) AFK সদস্যকে মেনশন/রিপ্লাই করা হলে জানিয়ে দাও (প্রতি ৬০ সেকেন্ডে একবার)
  const targets = new Set((c.ctx.mentionedJid || []).map(norm));
  if (c.ctx.participant) targets.add(norm(c.ctx.participant));
  for (const t of targets) {
    const k = findKey(g.afk, t);
    if (!k || areJidsSameUser(k, sender)) continue;
    const key = `${jid}|${k}`;
    if (Date.now() - (afkNotified.get(key) || 0) < 60_000) continue;
    afkNotified.set(key, Date.now());
    const a = g.afk[k];
    await send(
      sock,
      jid,
      card(s, {
        kind: 'afk',
        icon: '💤',
        title: 'Member Is AFK',
        lines: [`👤 ${fl('User')} : ${at(k)}`, `⏱️ ${fl('Since')} : ${fmtDuration(Date.now() - a.at)} ago`],
        extra: [`📝 ${fl('Reason')} : ${f(a.reason || 'Away')}`],
        foot: `🌙 ${f('They will reply when they are back.')}`,
      }),
      [k],
      { quoted: msg },
    );
  }

  // ৩) অটো-রিপ্লাই (কমান্ড নয় এমন টেক্সটে; একই কীওয়ার্ডে ৩০ সেকেন্ডে একবার)
  if (s.autoreply && !isCmd && text && g.autoreplies.length) {
    const hit = g.autoreplies.find((x) => matchesBadWord(text, [x.k]));
    if (hit) {
      const key = `${jid}|${hit.k}`;
      if (Date.now() - (replyCool.get(key) || 0) >= 30_000) {
        replyCool.set(key, Date.now());
        await send(
          sock,
          jid,
          card(s, { kind: 'info', icon: '💡', title: hit.k.slice(0, 30), lines: hit.r.split('\n').slice(0, 12), foot: '' }),
          [],
          { quoted: msg },
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* গিভঅ্যাওয়ে শেষ করে বিজয়ী ঘোষণা                                       */
/* ------------------------------------------------------------------ */
export async function finishGiveaway(sock, jid, g) {
  const gw = g.giveaway;
  if (!gw) return;
  g.giveaway = null;
  persist();
  const s = g.settings;
  const { f, fl } = designCtx(s);

  let pool = [...new Set(gw.entries)];
  const meta = await getMeta(sock, jid).catch(() => null);
  if (meta) pool = pool.filter((j) => findParticipant(meta, j)); // যারা এখনো গ্রুপে আছে
  const winners = sample(pool, gw.winners);

  if (!winners.length) {
    return send(
      sock,
      jid,
      card(s, {
        kind: 'gift',
        icon: '🎁',
        title: 'Giveaway Ended',
        lines: [`🏆 ${fl('Prize')} : ${f(gw.prize)}`],
        extra: [`👥 ${fl('Entries')} : ${pool.length}`],
        foot: `😕 ${f('No valid entries, so there is no winner.')}`,
      }),
    );
  }
  await send(
    sock,
    jid,
    card(s, {
      kind: 'gift',
      icon: '🏆',
      title: winners.length > 1 ? 'Giveaway Winners' : 'Giveaway Winner',
      lines: winners.map((w) => `🏆 ${at(w)}`),
      extra: [`🎁 ${fl('Prize')} : ${f(gw.prize)}`, `👥 ${fl('Entries')} : ${pool.length}`],
      foot: `🎉 ${f('Congratulations! Please contact an admin to claim your prize.')}`,
    }),
    winners,
  );
}

/* ------------------------------------------------------------------ */
/* প্রতি ৩০ সেকেন্ডে চলে (scheduler.js থেকে ডাকা হয়)                      */
/* ------------------------------------------------------------------ */
export async function tickAutomation(sock, now = new Date()) {
  const { date, hhmm, hour } = tzNow(config.timeZone, now);
  const stampKey = `${date} ${hhmm}`;
  const ts = now.getTime();

  for (const jid of groupIds()) {
    try {
      const g = getGroup(jid);
      const s = g.settings;
      const { f, fl } = designCtx(s);

      // ১) প্রতিদিনের শিডিউল-করা ঘোষণা
      for (const a of g.announcements) {
        if (a.at !== hhmm || a.last === stampKey) continue;
        a.last = stampKey;
        persist();
        await send(
          sock,
          jid,
          card(s, { kind: 'announce', icon: '📢', title: 'Announcement', lines: a.text.split('\n').slice(0, 15), foot: `🗓️ ${f('Daily notice')}` }),
        );
      }

      // ২) গিভঅ্যাওয়ের সময় শেষ
      if (g.giveaway && g.giveaway.endsAt <= ts) await finishGiveaway(sock, jid, g);

      // ৩) কুইজের সময় শেষ — উত্তর জানিয়ে দাও
      if (g.quiz && g.quiz.endsAt <= ts) {
        const qz = g.quiz;
        g.quiz = null;
        persist();
        await send(
          sock,
          jid,
          card(s, {
            kind: 'quiz',
            icon: '⏰',
            title: "Time's Up",
            lines: [`❓ ${f(qz.q)}`],
            extra: [`✅ ${fl('Answer')} : ${LETTERS[qz.a]}. ${f(qz.o[qz.a])}`],
            foot: `😅 ${f('Nobody got it this time. Try again with')} .quiz`,
          }),
        );
      }

      // ৪) সাময়িক মিউটের মেয়াদ শেষ
      for (const [id, until] of Object.entries(g.tmutes)) {
        if (until > ts) continue;
        delete g.tmutes[id];
        persist();
        await send(
          sock,
          jid,
          card(s, {
            kind: 'unlock',
            icon: '🔊',
            title: 'Mute Ended',
            lines: [`👤 ${fl('User')} : ${at(id)}`],
            foot: `✅ ${f('They can send messages again.')}`,
          }),
          [id],
        );
      }

      // ৫) জন্মদিনের শুভেচ্ছা (নির্ধারিত ঘণ্টায় দিনে একবার)
      if (s.birthday && hour === config.birthdayHour && g.birthdayLast !== date && Object.keys(g.birthdays).length) {
        g.birthdayLast = date;
        persist();
        const [, mm, dd] = date.split('-');
        const today = `${dd}-${mm}`;
        const names = Object.entries(g.birthdays).filter(([, v]) => v === today).map(([k]) => k);
        if (names.length) {
          const meta = await getMeta(sock, jid).catch(() => null);
          const present = meta ? names.filter((j) => findParticipant(meta, j)) : names;
          if (present.length) {
            await send(
              sock,
              jid,
              card(s, {
                kind: 'birthday',
                icon: '🎂',
                title: 'Happy Birthday!',
                lines: present.map((j) => `🎉 ${at(j)}`),
                extra: [`🎁 ${f('Send your wishes in the chat!')}`],
                foot: `🎈 ${f('Wishing you a wonderful year ahead!')}`,
              }),
              present,
            );
          }
        }
      }
    } catch (e) {
      console.error('[automation]', jid, e.message);
    }
  }
}
