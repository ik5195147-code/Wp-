import { config } from '../config.js';
import { getGroup, groupIds, persist } from '../lib/store.js';
import { getMeta, findParticipant, norm, numberOf } from '../lib/utils.js';
import { renderClosed, renderOpened, renderVerifyKick } from '../lib/render.js';
import { tickAutomation } from './automation.js';

/**
 * ব্যাকগ্রাউন্ড টাস্ক (প্রতি ৩০ সেকেন্ডে):
 *  ১) .autoclose — নির্ধারিত সময়ে গ্রুপ বন্ধ/খোলা (TIMEZONE অনুযায়ী)
 *  ২) ভেরিফিকেশন — সময়ের মধ্যে উত্তর না দিলে সদস্য রিমুভ
 */
export function startScheduler(sock) {
  const t = setInterval(() => {
    tick(sock).catch((e) => console.error('[scheduler]', e.message));
  }, 30_000);
  return () => clearInterval(t);
}

const hhmmIn = (tz, now) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
const dateIn = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

/** `now` প্যারামিটার শুধু টেস্টের সুবিধার জন্য। */
export async function tick(sock, now = new Date()) {
  const hhmm = hhmmIn(config.timeZone, now);
  const stamp = `${dateIn(config.timeZone, now)} ${hhmm}`;

  for (const jid of groupIds()) {
    const g = getGroup(jid);
    const s = g.settings;

    // ১) অটো ক্লোজ/ওপেন
    for (const [kind, setting, render] of [
      ['close', 'announcement', renderClosed],
      ['open', 'not_announcement', renderOpened],
    ]) {
      const at = g.schedule?.[kind];
      const lastKey = kind === 'close' ? 'lastClose' : 'lastOpen';
      if (at && at === hhmm && g.schedule[lastKey] !== stamp) {
        g.schedule[lastKey] = stamp; // ব্যর্থ হলেও একই মিনিটে আবার চেষ্টা নয়
        persist();
        try {
          await sock.groupSettingUpdate(jid, setting);
          await sock.sendMessage(jid, { text: render(s, '', { scheduled: true, at: `${at} • daily` }) });
        } catch (e) {
          console.error(`[autoclose:${kind}] ${jid}`, e.message);
        }
      }
    }

    // ২) ভেরিফিকেশন টাইমআউট
    const limit = config.verifyMinutes * 60_000;
    for (const [id, p] of Object.entries(g.pending)) {
      if (now.getTime() - p.ts < limit) continue;
      delete g.pending[id];
      persist();
      try {
        const meta = await getMeta(sock, jid);
        const bot = findParticipant(meta, norm(sock.user.id)) || findParticipant(meta, norm(sock.user.lid));
        const stillIn = !!findParticipant(meta, id);
        if (bot?.admin && stillIn) {
          await sock.sendMessage(jid, { text: renderVerifyKick(s, `@${numberOf(id)}`), mentions: [id] });
          await sock.groupParticipantsUpdate(jid, [id], 'remove');
        }
      } catch (e) {
        console.error('[verify-timeout]', e.message);
      }
    }
  }

  // ঘোষণা, গিভঅ্যাওয়ে, কুইজ টাইমআউট, মিউটের মেয়াদ, জন্মদিন
  await tickAutomation(sock, now);
}
