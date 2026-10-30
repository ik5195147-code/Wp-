import crypto from 'node:crypto';
import { areJidsSameUser } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getGroup, persist } from '../lib/store.js';
import { sleep, norm, pid, numberOf, getText, tzNow, parseDuration, fmtDuration } from '../lib/utils.js';
import { ctx as designCtx, card, stamp } from '../lib/render.js';
import { progress, bar } from '../lib/xp.js';
import { aiReady, askAI, clearHistory, takeQuota, translate, guessTarget, LANGS } from '../lib/ai.js';
import { QUIZ } from '../lib/quizbank.js';
import { LETTERS, awardXp, finishGiveaway } from './automation.js';

/**
 * নতুন কমান্ড: নম্বর-ফিল্টার, স্লো-মোড, ব্যান, রিপোর্ট, শিডিউল, অটো-রিপ্লাই, টেম্প-মিউট,
 * পোল, গিভঅ্যাওয়ে, কুইজ, ডেইলি, AFK, জন্মদিন, অনুবাদ, AI, ব্যানার।
 * commands.js এখান থেকে registerExtras(commands, kit) ডাকে — kit = সাধারণ হেল্পার।
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const at = (j) => `@${numberOf(j)}`;
const findKey = (obj, jid) => Object.keys(obj).find((k) => areJidsSameUser(k, jid));

const cool = new Map(); // কমান্ড-ভিত্তিক কুলডাউন: "cmd|sender" → সময়
function hit(c, name, secs) {
  const k = `${name}|${c.sender}`;
  if (Date.now() - (cool.get(k) || 0) < secs * 1000) return true;
  cool.set(k, Date.now());
  if (cool.size > 2000) for (const [key, t] of cool) if (Date.now() - t > 120_000) cool.delete(key);
  return false;
}

const quotedText = (c) => (c.ctx.quotedMessage ? getText(c.ctx.quotedMessage) : '');
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const recentQuiz = new Map(); // jid → শেষ কয়েকটি প্রশ্নের ইনডেক্স (পুনরাবৃত্তি এড়াতে)

export function registerExtras(commands, kit) {
  const { note, kv, alert, rest, resolveTargets, isBotJid, stOf, botAdminNote } = kit;
  const p = config.prefix;
  const D = (c) => designCtx(stOf(c));
  const on = (v) => (v ? 'ON' : 'OFF');

  /* ================= সুরক্ষা ================= */

  commands.countrylock = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const s = g.settings;
      const a = c.args.map((x) => x.toLowerCase());
      const codes = () => g.countryCodes.map((x) => `+${x}`).join(', ') || '—';
      if (!a.length) {
        return c.reply(
          note(c, {
            kind: s.countrylock ? 'lock' : 'info',
            icon: '🌍',
            title: 'Country Lock',
            lines: [kv(c, '🔘', 'Status', on(s.countrylock)), kv(c, '✅', 'Allowed', codes())],
            foot: `Set: ${p}countrylock 880 91  •  Off: ${p}countrylock off`,
          }),
        );
      }
      if (a[0] === 'on' || a[0] === 'off') {
        s.countrylock = a[0] === 'on';
        persist();
        return c.reply(
          note(c, {
            kind: s.countrylock ? 'lock' : 'info',
            icon: s.countrylock ? '🌍' : '❌',
            title: `Country Lock ${on(s.countrylock)}`,
            lines: [kv(c, '✅', 'Allowed', codes())],
            foot: s.countrylock && !c.botIsAdmin ? botAdminNote : '',
          }),
        );
      }
      const list = [...new Set(a.map((x) => x.replace(/\D/g, '')).filter((x) => /^\d{1,4}$/.test(x)))].slice(0, 10);
      if (!list.length) return c.reply(alert(c, '❓', 'Invalid Codes', `Use country calling codes, e.g. ${p}countrylock 880 91`, 'info'));
      g.countryCodes = list;
      s.countrylock = true;
      persist();
      await c.reply(
        note(c, {
          kind: 'lock',
          icon: '🌍',
          title: 'Country Lock Set',
          lines: [kv(c, '🔘', 'Status', 'ON'), kv(c, '✅', 'Allowed', codes())],
          foot: c.botIsAdmin
            ? '🛡️ Numbers from other countries are removed when they join. Members added by an admin are exempt.'
            : botAdminNote,
        }),
      );
    },
  };

  commands.slowmode = {
    group: true,
    admin: true,
    run: async (c) => {
      const s = getGroup(c.jid).settings;
      const a = (c.args[0] || '').toLowerCase();
      const card1 = (title, kind, icon) =>
        note(c, {
          kind,
          icon,
          title,
          lines: [kv(c, '🔘', 'Status', on(s.slowmode)), kv(c, '⏱️', 'Limit', `1 message / ${s.slowSeconds}s`)],
          foot: s.slowmode && !c.botIsAdmin ? botAdminNote : `Set: ${p}slowmode 10  •  Off: ${p}slowmode off`,
        });
      if (!a) return c.reply(card1('Slow Mode', 'info', '🐢'));
      if (a === 'off') s.slowmode = false;
      else if (a === 'on') s.slowmode = true;
      else {
        const n = Number(a);
        if (!Number.isInteger(n) || n < 2 || n > 600) {
          return c.reply(alert(c, '❓', 'Invalid Value', `Use 2–600 seconds, e.g. ${p}slowmode 10`, 'info'));
        }
        s.slowSeconds = n;
        s.slowmode = true;
      }
      persist();
      await c.reply(card1(s.slowmode ? 'Slow Mode ON' : 'Slow Mode OFF', s.slowmode ? 'lock' : 'info', s.slowmode ? '🐢' : '❌'));
    },
  };

  /* ---- ব্ল্যাকলিস্ট: .ban / .unban / .banlist ---- */
  commands.ban = {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const entries = new Map(); // নম্বর → গ্রুপে থাকলে তার jid
      for (const t of resolveTargets(c, 3)) {
        if (t.part?.admin || isBotJid(c, t.jid)) continue;
        entries.set(numberOf(t.jid), t.jid);
      }
      for (const tok of c.args) {
        const n = tok.replace(/\D/g, '');
        if (n.length < 8 || n.length > 15 || entries.has(n)) continue;
        const member = c.meta.participants.find((x) => numberOf(pid(x)) === n);
        if (member?.admin || (member && isBotJid(c, pid(member)))) continue;
        entries.set(n, member ? pid(member) : null);
      }
      if (!entries.size) {
        return c.reply(alert(c, '✏️', 'Usage', `${p}ban @user [reason]  •  ${p}ban 8801XXXXXXXXX  (admins cannot be banned)`, 'info'));
      }
      const reason = rest(c).replace(/@?\d{8,15}/g, '').trim().slice(0, 100);
      const removed = [];
      for (const [n, jid] of entries) {
        if (!g.blacklist.some((b) => b.n === n)) g.blacklist.push({ n, ts: Date.now(), by: c.sender, reason });
        if (jid) {
          try {
            await c.sock.groupParticipantsUpdate(c.jid, [jid], 'remove');
            removed.push(jid);
          } catch (e) {
            console.error('[ban]', e.message);
          }
          await sleep(600);
        }
      }
      if (g.blacklist.length > 500) g.blacklist.splice(0, g.blacklist.length - 500);
      persist();
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'ban',
          icon: '🔨',
          title: 'Member Banned',
          lines: [...entries.keys()].map((n) => `🚫 +${n}`),
          extra: [kv(c, '🛡️', 'By', at(c.sender)), ...(reason ? [kv(c, '📝', 'Reason', f(reason))] : [])],
          foot: `🔒 ${f('Removed automatically if they try to rejoin.')}${g.settings.blacklist ? '' : ` (Turn Blacklist ON: ${p}blacklist on)`}`,
        }),
        { mentions: [...removed, c.sender] },
      );
    },
  };
  commands.unban = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const n = (c.args[0] || '').replace(/\D/g, '');
      if (!n) return c.reply(alert(c, '✏️', 'Usage', `${p}unban 8801XXXXXXXXX`, 'info'));
      const before = g.blacklist.length;
      g.blacklist = g.blacklist.filter((b) => b.n !== n);
      persist();
      if (before === g.blacklist.length) return c.reply(alert(c, '❓', 'Not Found', 'That number is not in the blacklist.', 'info'));
      await c.reply(note(c, { kind: 'ok', icon: '♻️', title: 'Ban Lifted', lines: [`✅ +${n}`], foot: '🔓 They can join the group again.' }));
    },
  };
  commands.banlist = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      if (!g.blacklist.length) return c.reply(alert(c, '📭', 'Blacklist Empty', `Ban someone with ${p}ban @user`, 'info'));
      const lines = g.blacklist.slice(-20).reverse().map((b, i) => {
        const d = new Date(b.ts).toLocaleDateString('en-GB', { timeZone: config.timeZone, day: '2-digit', month: 'short' });
        return `${i + 1}. +${b.n} • ${d}`;
      });
      await c.reply(
        note(c, {
          kind: 'ban',
          icon: '🚫',
          title: 'Blacklist',
          lines,
          extra: [kv(c, '🔢', 'Total', g.blacklist.length), kv(c, '🔘', 'Status', on(g.settings.blacklist))],
          foot: `Remove: ${p}unban <number>`,
        }),
      );
    },
  };

  /* ---- সাময়িক মিউট ---- */
  commands.tmute = {
    group: true,
    admin: true,
    botAdmin: true,
    run: async (c) => {
      const t = resolveTargets(c, 1)[0];
      const durTok = c.args.find((x) => parseDuration(x));
      const ms = parseDuration(durTok);
      if (!t || !ms) return c.reply(alert(c, '✏️', 'Usage', `${p}tmute @user 30m [reason]   (s / m / h / d, up to 7d)`, 'info'));
      if (t.part?.admin || isBotJid(c, t.jid)) return c.reply(alert(c, '⛔', 'Not Allowed', 'Admins and the bot cannot be muted.'));
      if (ms < 60_000 || ms > 7 * 864e5) return c.reply(alert(c, '⏱️', 'Invalid Duration', 'Choose between 1m and 7d.', 'info'));
      const g = getGroup(c.jid);
      g.tmutes[t.jid] = Date.now() + ms;
      persist();
      const reason = rest(c).replace(/@\d+/g, '').replace(durTok, '').trim().slice(0, 100);
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'mute',
          icon: '🔇',
          title: 'Member Muted',
          lines: [kv(c, '👤', 'User', at(t.jid))],
          extra: [
            kv(c, '⏳', 'Duration', fmtDuration(ms)),
            kv(c, '⏰', 'Ends', stamp(new Date(Date.now() + ms))),
            kv(c, '🛡️', 'By', at(c.sender)),
            ...(reason ? [kv(c, '📝', 'Reason', f(reason))] : []),
          ],
          foot: `🤫 ${f('Their messages are deleted until then.')}  ${p}untmute @user`,
        }),
        { mentions: [t.jid, c.sender] },
      );
    },
  };
  commands.untmute = {
    group: true,
    admin: true,
    run: async (c) => {
      const t = resolveTargets(c, 1)[0];
      if (!t) return c.reply(alert(c, '✏️', 'Usage', `${p}untmute @user`, 'info'));
      const g = getGroup(c.jid);
      const k = findKey(g.tmutes, t.jid);
      if (!k) return c.reply(alert(c, '❓', 'Not Muted', 'That member is not muted.', 'info'));
      delete g.tmutes[k];
      persist();
      await c.reply(
        note(c, { kind: 'unlock', icon: '🔊', title: 'Mute Lifted', lines: [kv(c, '👤', 'User', at(t.jid))], foot: '✅ They can send messages again.' }),
        { mentions: [t.jid] },
      );
    },
  };

  commands.report = {
    group: true,
    run: async (c) => {
      const stanza = c.ctx.stanzaId;
      const target = c.ctx.participant ? norm(c.ctx.participant) : null;
      if (!stanza || !target) {
        return c.reply(alert(c, '✏️', 'How To Report', `Reply to the message you want to report and send ${p}report [reason]`, 'info'));
      }
      if (areJidsSameUser(target, c.sender)) return c.reply(alert(c, '⛔', 'Not Allowed', 'You cannot report your own message.'));
      if (hit(c, 'report', 60)) return c.reply(alert(c, '⏳', 'Please Wait', 'You can send one report per minute.', 'info'));
      const g = getGroup(c.jid);
      const preview = g.messages[stanza]?.t || quotedText(c) || '[media]';
      const reason = rest(c).slice(0, 120);
      const admins = c.meta.participants.filter((x) => x.admin).map(pid).slice(0, 10);
      const { f } = D(c);
      await c.sock.sendMessage(c.jid, {
        text: note(c, {
          kind: 'report',
          icon: '🚨',
          title: 'Message Reported',
          lines: [kv(c, '👤', 'Reported', at(target)), kv(c, '🙋', 'By', at(c.sender))],
          extra: [...(reason ? [kv(c, '📝', 'Reason', f(reason))] : []), kv(c, '💬', 'Message', `"${short(preview, 100)}"`)],
          foot: `📣 ${admins.map(at).join(' ')}`,
        }),
        mentions: [target, c.sender, ...admins],
      });
    },
  };

  /* ================= ম্যানেজমেন্ট ================= */

  commands.schedule = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const { f } = D(c);
      const a0 = (c.args[0] || '').toLowerCase();
      if (!a0) {
        if (!g.announcements.length) {
          return c.reply(alert(c, '📅', 'No Scheduled Messages', `Add one: ${p}schedule 09:00 Good morning everyone!`, 'info'));
        }
        return c.reply(
          note(c, {
            kind: 'announce',
            icon: '📅',
            title: 'Scheduled Messages',
            lines: g.announcements.map((x) => `${x.id}. ⏰ ${x.at} — ${short(x.text.replace(/\n/g, ' '), 40)}`),
            extra: [kv(c, '🌍', 'Zone', config.timeZone)],
            foot: `Remove: ${p}schedule del <number>  •  ${p}schedule clear`,
          }),
        );
      }
      if (a0 === 'clear') {
        g.announcements = [];
        persist();
        return c.reply(note(c, { kind: 'info', icon: '🗑️', title: 'Schedule Cleared', lines: [kv(c, '🔢', 'Messages', 0)] }));
      }
      if (a0 === 'del' || a0 === 'delete' || a0 === 'remove') {
        const id = Number(c.args[1]);
        const before = g.announcements.length;
        g.announcements = g.announcements.filter((x) => x.id !== id);
        persist();
        return c.reply(
          before === g.announcements.length
            ? alert(c, '❓', 'Not Found', `No scheduled message with number ${c.args[1] || '?'}.`, 'info')
            : note(c, { kind: 'info', icon: '🗑️', title: 'Message Removed', lines: [kv(c, '🔢', 'Number', id)] }),
        );
      }
      if (!HHMM.test(a0)) return c.reply(alert(c, '✏️', 'Usage', `${p}schedule 09:00 <message>   (24-hour, ${config.timeZone})`, 'info'));
      const text = rest(c).replace(/^\S+\s*/, '').trim().slice(0, 500);
      if (!text) return c.reply(alert(c, '✏️', 'Message Missing', `${p}schedule ${a0} <message>`, 'info'));
      if (g.announcements.length >= 5) return c.reply(alert(c, '📛', 'Limit Reached', 'You can keep up to 5 scheduled messages.', 'info'));
      const id = Math.max(0, ...g.announcements.map((x) => x.id)) + 1;
      g.announcements.push({ id, at: a0, text, last: '' });
      persist();
      await c.reply(
        note(c, {
          kind: 'announce',
          icon: '📅',
          title: 'Message Scheduled',
          lines: [kv(c, '🔢', 'Number', id), kv(c, '⏰', 'Time', `${a0} daily`), kv(c, '🌍', 'Zone', config.timeZone)],
          extra: [`📝 ${f(short(text, 120))}`],
          foot: '📢 It will be posted automatically every day.',
        }),
      );
    },
  };

  /* ---- অটো-রিপ্লাই ---- */
  commands.addreply = {
    alias: ['setreply'],
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const body = rest(c);
      const i = body.indexOf('=>');
      const k = (i > 0 ? body.slice(0, i) : '').trim().toLowerCase().slice(0, 40);
      const r = (i > 0 ? body.slice(i + 2) : '').trim().slice(0, 600);
      if (!k || !r) return c.reply(alert(c, '✏️', 'Usage', `${p}addreply price => The price is 500 BDT`, 'info'));
      const old = g.autoreplies.find((x) => x.k === k);
      if (old) old.r = r;
      else if (g.autoreplies.length >= 30) return c.reply(alert(c, '📛', 'Limit Reached', 'You can keep up to 30 auto-replies.', 'info'));
      else g.autoreplies.push({ k, r });
      persist();
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'ok',
          icon: '💡',
          title: old ? 'Reply Updated' : 'Reply Saved',
          lines: [kv(c, '🔑', 'Keyword', f(k))],
          extra: [`💬 ${f(short(r, 120))}`],
          foot: g.settings.autoreply ? '' : `⚠️ Auto-Reply is OFF — turn it on: ${p}help autoreply on`,
        }),
      );
    },
  };
  commands.delreply = {
    alias: ['removereply'],
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const k = rest(c).toLowerCase();
      const before = g.autoreplies.length;
      g.autoreplies = g.autoreplies.filter((x) => x.k !== k);
      persist();
      await c.reply(
        before === g.autoreplies.length
          ? alert(c, '❓', 'Not Found', `No auto-reply for "${short(k || '?', 30)}".`, 'info')
          : note(c, { kind: 'info', icon: '🗑️', title: 'Reply Removed', lines: [kv(c, '🔑', 'Keyword', k)] }),
      );
    },
  };
  commands.replies = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      if (!g.autoreplies.length) return c.reply(alert(c, '📭', 'No Auto-Replies', `Add one: ${p}addreply price => The price is 500 BDT`, 'info'));
      await c.reply(
        note(c, {
          kind: 'info',
          icon: '💡',
          title: 'Auto-Replies',
          lines: g.autoreplies.slice(0, 30).map((x, i) => `${i + 1}. ${short(x.k, 20)} ➜ ${short(x.r.replace(/\n/g, ' '), 32)}`),
          extra: [kv(c, '🔘', 'Status', on(g.settings.autoreply))],
          foot: `Remove: ${p}delreply <keyword>`,
        }),
      );
    },
  };

  /* ================= এনগেজমেন্ট ================= */

  commands.poll = {
    group: true,
    admin: true,
    run: async (c) => {
      // --multi শুরুতে বা শেষে — যেখানেই থাকুক চলবে (একাধিক উত্তর বাছাই করা যাবে)
      let body = rest(c);
      const multi = /(^|\s)--multi(?=\s|$)/i.test(body);
      if (multi) body = body.replace(/(^|\s)--multi(?=\s|$)/gi, ' ');
      const [name, ...raw] = body.split('|').map((x) => x.trim()).filter(Boolean);
      const values = [...new Set(raw)]; // একই অপশন দুবার থাকলে WhatsApp পোল প্রত্যাখ্যান করে
      if (!name || values.length < 2 || values.length > 12) {
        return c.reply(alert(c, '✏️', 'Usage', `${p}poll Favourite colour? | Red | Blue | Green   (2–12 options • add --multi to allow several answers)`, 'info'));
      }
      await c.sock.sendMessage(c.jid, {
        poll: { name: name.slice(0, 250), values: values.map((v) => v.slice(0, 100)), selectableCount: multi ? values.length : 1 },
      });
    },
  };

  commands.giveaway = {
    group: true,
    admin: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const { f } = D(c);
      const sub = (c.args[0] || '').toLowerCase();
      if (sub === 'end' || sub === 'cancel') {
        if (!g.giveaway) return c.reply(alert(c, '❓', 'No Giveaway', 'There is no running giveaway.', 'info'));
        if (sub === 'cancel') {
          g.giveaway = null;
          persist();
          return c.reply(note(c, { kind: 'info', icon: '🛑', title: 'Giveaway Cancelled', lines: [kv(c, '🛡️', 'By', at(c.sender))] }), { mentions: [c.sender] });
        }
        return finishGiveaway(c.sock, c.jid, g);
      }
      if (!c.args.length) {
        const gw = g.giveaway;
        return c.reply(
          gw
            ? note(c, {
                kind: 'gift',
                icon: '🎁',
                title: 'Giveaway Running',
                lines: [kv(c, '🏆', 'Prize', f(gw.prize)), kv(c, '👥', 'Entries', gw.entries.length), kv(c, '⏳', 'Ends in', fmtDuration(gw.endsAt - Date.now()))],
                foot: `Finish now: ${p}giveaway end  •  Cancel: ${p}giveaway cancel`,
              })
            : alert(c, '🎁', 'Start A Giveaway', `${p}giveaway 30m 1 Netflix Premium   (time • winners • prize)`, 'info'),
        );
      }
      if (g.giveaway) return c.reply(alert(c, '⏳', 'Already Running', `Finish it first: ${p}giveaway end`, 'info'));
      const ms = parseDuration(c.args[0]);
      const winners = Number(c.args[1]);
      const prize = c.args.slice(2).join(' ').trim().slice(0, 100);
      if (!ms || ms < 60_000 || ms > 7 * 864e5 || !Number.isInteger(winners) || winners < 1 || winners > 10 || !prize) {
        return c.reply(alert(c, '✏️', 'Usage', `${p}giveaway 30m 1 Netflix Premium   (1m–7d • 1–10 winners • prize)`, 'info'));
      }
      g.giveaway = { prize, winners, endsAt: Date.now() + ms, entries: [], by: c.sender };
      persist();
      await c.reply(
        note(c, {
          kind: 'gift',
          icon: '🎁',
          title: 'Giveaway Time!',
          lines: [kv(c, '🏆', 'Prize', f(prize)), kv(c, '🎯', 'Winners', winners), kv(c, '⏳', 'Ends in', fmtDuration(ms)), kv(c, '🛡️', 'Host', at(c.sender))],
          extra: [`✍️ ${f('Send')} ${p}enter ${f('to join')}`],
          foot: '🍀 Good luck, everyone!',
        }),
        { mentions: [c.sender] },
      );
    },
  };
  commands.enter = {
    alias: ['join'],
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const gw = g.giveaway;
      if (!gw) return c.reply(alert(c, '🎁', 'No Giveaway', 'There is no running giveaway right now.', 'info'));
      if (gw.entries.some((j) => areJidsSameUser(j, c.sender))) return c.reply(alert(c, '✅', 'Already Entered', 'You are already in. Good luck!', 'info'));
      gw.entries.push(c.sender);
      persist();
      await c.reply(
        note(c, {
          kind: 'gift',
          icon: '🎟️',
          title: 'Entry Confirmed',
          lines: [kv(c, '👤', 'User', at(c.sender)), kv(c, '👥', 'Entries', gw.entries.length)],
          foot: '🍀 Good luck!',
        }),
        { mentions: [c.sender] },
      );
    },
  };

  /* ---- কুইজ ---- */
  commands.quiz = {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      if (!g.settings.quiz) return c.reply(alert(c, '🧠', 'Quiz Is Off', `Admins can turn it on: ${p}help quizgame on`, 'info'));
      if (g.quiz && g.quiz.endsAt > Date.now()) {
        return c.reply(alert(c, '⏳', 'Quiz Running', `Answer with ${p}a ${p}b ${p}c ${p}d — ${Math.ceil((g.quiz.endsAt - Date.now()) / 1000)}s left.`, 'info'));
      }
      const seen = recentQuiz.get(c.jid) || [];
      let idx;
      do idx = crypto.randomInt(QUIZ.length);
      while (seen.includes(idx) && seen.length < QUIZ.length - 1);
      recentQuiz.set(c.jid, [...seen.slice(-15), idx]);
      const item = QUIZ[idx];
      const order = shuffle([0, 1, 2, 3]);
      const o = order.map((i) => item.o[i]);
      g.quiz = { q: item.q, o, a: order.indexOf(item.a), endsAt: Date.now() + 30_000, tried: [] };
      persist();
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'quiz',
          icon: '🧠',
          title: 'Quiz Time',
          lines: [kv(c, '🏷️', 'Category', item.c), kv(c, '⏳', 'Time', '30s'), kv(c, '🎁', 'Reward', `+${config.quizXp} XP`)],
          extra: [`❓ ${f(item.q)}`, ...o.map((t, i) => `${LETTERS[i]}) ${t}`)],
          foot: `✍️ ${f('Answer with')} ${p}a  ${p}b  ${p}c  ${p}d`,
        }),
      );
    },
  };
  const answer = async (c, letter) => {
    const g = getGroup(c.jid);
    const qz = g.quiz;
    if (!qz || qz.endsAt <= Date.now()) return c.reply(alert(c, '🧠', 'No Active Quiz', `Start one with ${p}quiz`, 'info'));
    if (qz.tried.some((j) => areJidsSameUser(j, c.sender))) return undefined; // একজন একবারই চেষ্টা করতে পারবে
    const idx = LETTERS.indexOf(String(letter).toUpperCase());
    if (idx === -1) return c.reply(alert(c, '❓', 'Choose A, B, C Or D', `e.g. ${p}b`, 'info'));
    qz.tried.push(c.sender);
    if (idx !== qz.a) {
      persist();
      return c.reply(alert(c, '❌', 'Wrong Answer', 'Not quite — you are out for this round.'), { mentions: [c.sender] });
    }
    g.quiz = null;
    persist();
    const { xp, level } = await awardXp(c.sock, c.jid, c.sender, config.quizXp);
    const { f } = D(c);
    return c.reply(
      note(c, {
        kind: 'quiz',
        icon: '🏆',
        title: 'Correct!',
        lines: [kv(c, '🏆', 'Winner', at(c.sender)), kv(c, '✅', 'Answer', `${LETTERS[qz.a]}. ${f(qz.o[qz.a])}`)],
        extra: [kv(c, '✨', 'XP', `+${config.quizXp}`), kv(c, '⭐', 'Level', level)],
        foot: `🧠 ${f('Next round:')} ${p}quiz`,
      }),
      { mentions: [c.sender] },
    );
  };
  for (const L of LETTERS) commands[L.toLowerCase()] = { group: true, run: (c) => answer(c, L) };
  commands.ans = { alias: ['answer'], group: true, run: (c) => answer(c, c.args[0] || '') };

  /* ---- ডেইলি বোনাস, AFK, জন্মদিন ---- */
  commands.daily = {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const m = (g.members[c.sender] ??= { count: 0 });
      const today = tzNow(config.timeZone).date;
      const { f } = D(c);
      if (m.dailyAt === today) {
        return c.reply(
          note(c, {
            kind: 'info',
            icon: '⏳',
            title: 'Already Claimed',
            lines: [kv(c, '👤', 'User', at(c.sender)), kv(c, '🔥', 'Streak', `${m.streak || 1} day(s)`)],
            foot: `🌙 ${f('Come back tomorrow for your next bonus.')}`,
          }),
          { mentions: [c.sender] },
        );
      }
      const yesterday = tzNow(config.timeZone, new Date(Date.now() - 864e5)).date;
      m.streak = m.dailyAt === yesterday ? (m.streak || 0) + 1 : 1;
      m.dailyAt = today;
      const bonus =
        config.dailyXpMin + crypto.randomInt(config.dailyXpMax - config.dailyXpMin + 1) + Math.min(m.streak, 7) * 10;
      const { xp } = await awardXp(c.sock, c.jid, c.sender, bonus);
      const pr = progress(xp);
      await c.reply(
        note(c, {
          kind: 'daily',
          icon: '🎁',
          title: 'Daily Bonus',
          lines: [kv(c, '👤', 'User', at(c.sender)), kv(c, '✨', 'XP', `+${bonus}`), kv(c, '🔥', 'Streak', `${m.streak} day(s)`)],
          extra: [kv(c, '⭐', 'Level', pr.level), `${bar(pr.pct)} ${pr.pct}%`],
          foot: `🔁 ${f('Claim every day to grow your streak bonus (up to +70 XP).')}`,
        }),
        { mentions: [c.sender] },
      );
    },
  };

  commands.afk = {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const reason = rest(c).slice(0, 80);
      g.afk[c.sender] = { at: Date.now(), reason };
      persist();
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'afk',
          icon: '💤',
          title: 'AFK Mode On',
          lines: [kv(c, '👤', 'User', at(c.sender))],
          extra: [kv(c, '📝', 'Reason', f(reason || 'Away'))],
          foot: `🌙 ${f('I will let others know. Send any message to turn it off.')}`,
        }),
        { mentions: [c.sender] },
      );
    },
  };

  commands.birthday = {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const arg = (c.args[0] || '').toLowerCase();
      const k = findKey(g.birthdays, c.sender);
      if (arg === 'off' || arg === 'remove') {
        if (k) delete g.birthdays[k];
        persist();
        return c.reply(note(c, { kind: 'info', icon: '🗑️', title: 'Birthday Removed', lines: [kv(c, '👤', 'User', at(c.sender))] }), { mentions: [c.sender] });
      }
      if (!arg) {
        const v = k ? g.birthdays[k] : null;
        return c.reply(
          alert(c, '🎂', 'Your Birthday', v ? `Saved: ${Number(v.slice(0, 2))} ${MONTHS[Number(v.slice(3)) - 1]}. Change: ${p}birthday 25-12` : `Set yours: ${p}birthday 25-12  (day-month)`, 'info'),
        );
      }
      const mt = /^(\d{1,2})[-/.](\d{1,2})$/.exec(arg);
      const dd = mt ? Number(mt[1]) : 0;
      const mm = mt ? Number(mt[2]) : 0;
      const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (!mt || mm < 1 || mm > 12 || dd < 1 || dd > dim[mm - 1]) {
        return c.reply(alert(c, '❓', 'Invalid Date', `Use day-month, e.g. ${p}birthday 25-12`, 'info'));
      }
      g.birthdays[k || c.sender] = `${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}`;
      persist();
      const { f } = D(c);
      await c.reply(
        note(c, {
          kind: 'birthday',
          icon: '🎂',
          title: 'Birthday Saved',
          lines: [kv(c, '👤', 'User', at(c.sender)), kv(c, '📅', 'Date', `${dd} ${MONTHS[mm - 1]}`)],
          foot: `🎈 ${f('The group will wish you on your day!')}${g.settings.birthday ? '' : ` (Wishes are OFF: ${p}help birthdaywish on)`}`,
        }),
        { mentions: [c.sender] },
      );
    },
  };
  commands.birthdays = {
    group: true,
    run: async (c) => {
      const g = getGroup(c.jid);
      const [y, mo, d] = tzNow(config.timeZone).date.split('-').map(Number);
      const base = Date.UTC(y, mo - 1, d);
      const days = (v) => {
        const [dd, mm] = v.split('-').map(Number);
        let t = Date.UTC(y, mm - 1, dd);
        if (t < base) t = Date.UTC(y + 1, mm - 1, dd);
        return Math.round((t - base) / 864e5);
      };
      const list = Object.entries(g.birthdays)
        .map(([j, v]) => ({ j, v, n: days(v) }))
        .sort((a, b) => a.n - b.n)
        .slice(0, 10);
      if (!list.length) return c.reply(alert(c, '🎂', 'No Birthdays Yet', `Add yours: ${p}birthday 25-12`, 'info'));
      await c.reply(
        note(c, {
          kind: 'birthday',
          icon: '🎂',
          title: 'Upcoming Birthdays',
          lines: list.map((x) => `🎉 ${at(x.j)} — ${Number(x.v.slice(0, 2))} ${MONTHS[Number(x.v.slice(3)) - 1]} (${x.n === 0 ? 'today!' : `in ${x.n}d`})`),
        }),
        { mentions: list.map((x) => x.j) },
      );
    },
  };

  /* ================= অনুবাদ ও AI ================= */

  commands.translate = {
    alias: ['tr'],
    run: async (c) => {
      if (!c.isGroup && !c.isOwner) return c.reply(alert(c, 'ℹ️', 'Group Only', 'Translation works inside groups.', 'info'));
      const words = [...c.args];
      let target = null;
      if (words.length && LANGS[words[0].toLowerCase()]) target = words.shift().toLowerCase();
      const text = words.join(' ').trim() || quotedText(c).trim();
      if (!text) {
        return c.reply(alert(c, '✏️', 'Usage', `${p}translate bn Hello world   •   or reply to a message with ${p}translate en`, 'info'));
      }
      if (hit(c, 'translate', 5)) return c.reply(alert(c, '⏳', 'Please Wait', 'Try again in a few seconds.', 'info'));
      target ??= guessTarget(text);
      const out = await translate(text, target, c.isGroup ? c.jid : 'dm');
      await c.reply(
        note(c, {
          kind: 'translate',
          icon: '🌐',
          title: 'Translation',
          lines: [kv(c, '🔤', 'To', `${LANGS[target]} (${target})`), kv(c, '📝', 'Original', `"${short(text, 60)}"`)],
          foot: out,
        }),
      );
    },
  };

  commands.ai = {
    alias: ['ask', 'gemini'],
    run: async (c) => {
      if (!c.isGroup && !c.isOwner) return c.reply(alert(c, 'ℹ️', 'Group Only', 'AI chat works inside groups.', 'info'));
      if (c.isGroup && !getGroup(c.jid).settings.aichat) {
        return c.reply(alert(c, '🤖', 'AI Chat Is Off', `Admins can turn it on: ${p}help aichat on`, 'info'));
      }
      if (!aiReady()) return c.reply(alert(c, '🤖', 'AI Not Set Up', 'The bot owner must set GEMINI_API_KEY first.'));
      const histKey = `${c.jid}|${numberOf(c.sender)}`;
      const sub = (c.args[0] || '').toLowerCase();
      if (sub === 'reset' || sub === 'clear') {
        clearHistory(histKey);
        return c.reply(note(c, { kind: 'ai', icon: '🧹', title: 'AI Memory Cleared', lines: [kv(c, '👤', 'User', at(c.sender))], foot: '✨ Starting a fresh conversation.' }), { mentions: [c.sender] });
      }
      const quoted = quotedText(c);
      const q = rest(c) || (quoted ? 'Please respond to the quoted message.' : '');
      if (!q) return c.reply(alert(c, '✏️', 'Usage', `${p}ai <your question>   •   ${p}ai reset`, 'info'));
      if (!c.isOwner && hit(c, 'ai', config.aiCooldown)) {
        return c.reply(alert(c, '⏳', 'Please Wait', `You can ask once every ${config.aiCooldown} seconds.`, 'info'));
      }
      if (!takeQuota(c.isGroup ? c.jid : 'dm')) {
        return c.reply(alert(c, '📛', 'Daily Limit Reached', 'This group used all of its AI questions for today. Try again tomorrow.'));
      }
      try {
        await c.sock.sendPresenceUpdate?.('composing', c.jid);
      } catch {
        /* গুরুত্বপূর্ণ নয় */
      }
      const out = await askAI(histKey, q, quoted);
      await c.reply(
        note(c, {
          kind: 'ai',
          icon: '🤖',
          title: 'AI Assistant',
          lines: [kv(c, '🙋', 'Asked by', at(c.sender)), kv(c, '❓', 'Question', `"${short(q, 70)}"`)],
          foot: out,
        }),
        { mentions: [c.sender] },
      );
    },
  };

  /* ================= ডিজাইন ================= */

  commands.banner = {
    group: true,
    admin: true,
    run: async (c) => {
      const s = getGroup(c.jid).settings;
      const arg = (c.args[0] || '').toLowerCase();
      if (arg === 'off') s.bannerOff = true;
      else if (arg === 'on') s.bannerOff = false;
      else if (arg === 'reset') {
        s.bannerOff = false;
        delete s.bannerEmoji;
      } else if (c.args.length) {
        const found = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(rest(c))]
          .map((x) => x.segment)
          .filter((x) => /\p{Extended_Pictographic}/u.test(x))
          .slice(0, 2);
        if (!found.length) return c.reply(alert(c, '✏️', 'Usage', `${p}banner 🌸 ✨   •   ${p}banner off   •   ${p}banner reset`, 'info'));
        s.bannerEmoji = found;
        s.bannerOff = false;
      }
      persist();
      const shown = s.bannerOff ? 'OFF' : s.bannerEmoji?.length ? s.bannerEmoji.join(' ') : 'Automatic (by notice type)';
      await c.reply(
        note(c, {
          kind: 'ok',
          icon: '🎨',
          title: 'Notice Banner',
          lines: [kv(c, '🖼️', 'Banner', shown)],
          foot: `Set: ${p}banner 🌸 ✨  •  Off: ${p}banner off  •  Reset: ${p}banner reset`,
        }),
      );
    },
  };
}
