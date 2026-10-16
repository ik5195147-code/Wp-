import path from 'node:path';
import fs from 'node:fs/promises';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';

import { config } from '../bot/config.js';
import { groupCache } from '../bot/lib/utils.js';
import { onMessage, onReactions } from '../bot/features/messages.js';
import { onParticipants, onGroupSettings } from '../bot/features/groupEvents.js';
import { pushLog } from './logBuffer.js';

const AUTH_DIR = path.join(config.dataDir, 'auth');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Baileys এর নিজস্ব লগ: Railway লগেও যায়, ড্যাশবোর্ড বাফারেও যায় (লম্বা লাইন ছোট করে)
const logger = pino(
  { level: 'warn' },
  {
    write(s) {
      process.stdout.write(s.length > 600 ? `${s.slice(0, 600)}…\n` : s);
      pushLog('pino', s);
    },
  },
);

/**
 * status মান:
 *  stopped | starting | waiting_login | connected | reconnecting | logged_out | replaced
 */
class BotManager {
  status = 'stopped';
  qr = null; // QR এর data-URL ছবি
  pairing = null; // { code, at }
  user = null;
  lastError = null;
  connectedAt = 0;

  #sock = null;
  #wanted = false;
  #retry = 0;
  #timer = null;
  #starting = false;

  snapshot() {
    return {
      status: this.status,
      qr: this.qr,
      pairing: this.pairing,
      user: this.user,
      lastError: this.lastError,
      uptimeMs: this.connectedAt && this.status === 'connected' ? Date.now() - this.connectedAt : 0,
      wanted: this.#wanted,
    };
  }

  /** সার্ভার চালুর সময় অটো-স্টার্ট (AUTO_START=false দিলে বন্ধ)। */
  async autoStart() {
    if (process.env.AUTO_START === 'false') return;
    await this.start();
  }

  async start() {
    if (this.#sock || this.#starting) return;
    this.#wanted = true;
    this.#retry = 0;
    this.lastError = null;
    await this.#connect();
  }

  async stop() {
    this.#wanted = false;
    clearTimeout(this.#timer);
    const sock = this.#sock;
    this.#sock = null;
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* ইতোমধ্যে বন্ধ */
      }
    }
    this.status = 'stopped';
    this.qr = null;
    this.pairing = null;
    this.user = null;
  }

  async restart() {
    await this.stop();
    await sleep(800);
    await this.start();
  }

  /** WhatsApp থেকে ডিভাইস আনলিংক + সেভ করা সেশন মুছে ফেলে। */
  async logout() {
    this.#wanted = false;
    clearTimeout(this.#timer);
    const sock = this.#sock;
    this.#sock = null;
    if (sock) {
      try {
        if (this.status === 'connected') await sock.logout();
        else sock.end(undefined);
      } catch {
        /* লগআউট ব্যর্থ হলেও লোকাল সেশন মুছব */
      }
    }
    await fs.rm(AUTH_DIR, { recursive: true, force: true });
    this.status = 'stopped';
    this.qr = null;
    this.pairing = null;
    this.user = null;
    this.lastError = null;
  }

  /** QR এর বদলে ফোন-নম্বর দিয়ে ৮ অক্ষরের পেয়ারিং কোড নেওয়া। */
  async requestPairing(phone) {
    const num = String(phone || '').replace(/\D/g, '');
    if (num.length < 8 || num.length > 15) {
      throw new Error('সঠিক নম্বর দিন — কান্ট্রি কোড সহ, যেমন 8801XXXXXXXXX');
    }
    const sock = this.#sock;
    if (!sock || this.status !== 'waiting_login' || sock.authState.creds.registered) {
      throw new Error('এখন কোড নেওয়া যাবে না। "স্টার্ট" দিয়ে QR আসা পর্যন্ত অপেক্ষা করুন।');
    }
    const raw = await sock.requestPairingCode(num);
    const code = String(raw).match(/.{1,4}/g).join('-');
    this.pairing = { code, at: Date.now() };
    return code;
  }

  /* ---------------------------------------------------------------- */

  async #connect() {
    clearTimeout(this.#timer);
    this.#starting = true;
    this.status = this.#retry ? 'reconnecting' : 'starting';

    try {
      await fs.mkdir(AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();
      if (!this.#wanted) {
        this.status = 'stopped'; // অপেক্ষার মধ্যে stop চাপা হয়েছে
        return;
      }

      const sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        cachedGroupMetadata: async (jid) => groupCache.get(jid),
      });
      this.#sock = sock;
      this.#wire(sock, saveCreds);
    } catch (e) {
      this.lastError = e.message;
      console.error('[bot] চালু করতে সমস্যা:', e.message);
      this.#scheduleRetry();
    } finally {
      this.#starting = false;
    }
  }

  #wire(sock, saveCreds) {
    // পুরনো/বন্ধ সকেটের ইভেন্ট উপেক্ষা করতে প্রতিটিতে `sock !== this.#sock` গার্ড আছে
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (sock !== this.#sock) return;

      if (qr) {
        this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        this.status = 'waiting_login';
      }
      if (connection === 'open') {
        this.status = 'connected';
        this.qr = null;
        this.pairing = null;
        this.lastError = null;
        this.#retry = 0;
        this.user = sock.user?.id ?? null;
        this.connectedAt = Date.now();
        console.log(`✅ ${config.botName} সংযুক্ত: ${this.user}`);
      }
      if (connection === 'close') this.#onClose(lastDisconnect?.error);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (sock !== this.#sock || type !== 'notify') return;
      for (const m of messages) onMessage(sock, m).catch((e) => console.error('[message]', e.message));
    });
    sock.ev.on('messages.reaction', (r) => {
      if (sock !== this.#sock) return;
      try {
        onReactions(sock, r);
      } catch (e) {
        console.error('[reaction]', e.message);
      }
    });
    sock.ev.on('group-participants.update', (ev) => {
      if (sock !== this.#sock) return;
      onParticipants(sock, ev).catch((e) => console.error('[participants]', e.message));
    });
    sock.ev.on('groups.update', (u) => {
      if (sock !== this.#sock) return;
      onGroupSettings(sock, u).catch((e) => console.error('[groups.update]', e.message));
    });
    sock.ev.on('groups.upsert', (list) => list.forEach((g) => groupCache.set(g.id, g)));
  }

  async #onClose(err) {
    const code = err?.output?.statusCode;
    this.#sock = null;
    this.qr = null;
    this.user = null;

    if (code === DisconnectReason.loggedOut) {
      // ফোন থেকে ডিভাইস রিমুভ করা হয়েছে — সেভ করা সেশন অকেজো
      this.#wanted = false;
      this.status = 'logged_out';
      this.lastError = 'WhatsApp থেকে লগআউট হয়েছে। আবার স্টার্ট দিয়ে নতুন করে লগইন করুন।';
      await fs.rm(AUTH_DIR, { recursive: true, force: true });
      console.log('🚪 লগআউট — সেশন মুছে ফেলা হয়েছে');
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      // একই সেশন অন্য কোথাও (যেমন Termux) চালু আছে — ঝগড়া এড়াতে থেমে যাই
      this.#wanted = false;
      this.status = 'replaced';
      this.lastError = 'একই সেশন অন্য কোথাও চালু হয়েছে (Termux/অন্য সার্ভারে?)। সেটি বন্ধ করে আবার স্টার্ট দিন।';
      console.log('⚠️ connectionReplaced — অটো-রিকানেক্ট বন্ধ');
      return;
    }
    if (!this.#wanted) {
      this.status = 'stopped';
      return;
    }

    // ৫১৫ = নতুন লিংকের পর WhatsApp এর স্বাভাবিক রিস্টার্ট অনুরোধ
    const delay =
      code === DisconnectReason.restartRequired
        ? 500
        : Math.min(30_000, 2_000 * 2 ** Math.min(this.#retry, 4));
    console.log(`🔄 সংযোগ বিচ্ছিন্ন (কোড: ${code ?? 'অজানা'}) — ${Math.round(delay / 1000)}s পর আবার চেষ্টা`);
    this.#scheduleRetry(delay);
  }

  #scheduleRetry(delay = 3000) {
    if (!this.#wanted) return;
    this.#retry += 1;
    this.status = 'reconnecting';
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#connect(), delay);
  }
}

export const bot = new BotManager();
