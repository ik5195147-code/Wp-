import 'dotenv/config';
import path from 'node:path';

const list = (v = '') => v.split(',').map((s) => s.trim()).filter(Boolean);
const prefix = process.env.PREFIX || '.';

// ডাটা (সেশন + ডাটাবেস) কোথায় থাকবে। Railway-তে Volume মাউন্ট করলে সেটিই ব্যবহৃত হয়।
const dataDir =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve('data');

export const config = {
  dataDir,
  prefix,
  botName: process.env.BOT_NAME || 'GroupGuard',
  owners: list(process.env.OWNER_NUMBERS).map((n) => n.replace(/\D/g, '')).filter(Boolean),
  timeZone: process.env.TIMEZONE || 'Asia/Dhaka',
  helpLink: process.env.HELP_LINK || '',

  // মডারেশন
  mentionLimit: Number(process.env.MENTION_LIMIT || 5),
  linkWarnLimit: Math.max(1, Number(process.env.LINK_WARN_LIMIT || 1)),
  linkWhitelist: list(process.env.LINK_WHITELIST).map((s) => s.toLowerCase()),

  // ফ্লাড কন্ট্রোল: FLOOD_SECONDS সেকেন্ডে FLOOD_MESSAGES বা তার বেশি মেসেজ = ফ্লাড
  floodMessages: Math.max(3, Number(process.env.FLOOD_MESSAGES || 7)),
  floodSeconds: Math.max(2, Number(process.env.FLOOD_SECONDS || 8)),

  // ওয়ার্ন সিস্টেম: এতবার ওয়ার্ন হলে অটো-কিক
  warnLimit: Math.max(2, Number(process.env.WARN_LIMIT || 3)),

  // লেভেল/XP: প্রতি মেসেজে XP_MIN–XP_MAX (প্রতি XP_COOLDOWN সেকেন্ডে একবার)
  xpMin: 5,
  xpMax: 10,
  xpCooldown: Number(process.env.XP_COOLDOWN || 25),

  // ভেরিফিকেশন: নতুন সদস্য কত মিনিটের মধ্যে উত্তর না দিলে রিমুভ
  verifyMinutes: Math.max(1, Number(process.env.VERIFY_MINUTES || 5)),

  // ওয়েলকাম-কার্ডে ট্যাপ করলে যে লিঙ্ক খুলবে
  cardLink: process.env.CARD_LINK || 'https://www.whatsapp.com',

  // অ্যাডমিন ট্র্যাকিং
  adminLogNotify: (process.env.ADMIN_LOG_NOTIFY ?? 'true') === 'true',

  // টপ মেসেজেস: প্রতি গ্রুপে সর্বোচ্চ কতগুলো মেসেজের প্রিভিউ মনে রাখবে
  maxStoredMessages: 1500,

  // API কী
  youtubeKey: process.env.YOUTUBE_API_KEY || '',
  spotifyId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifySecret: process.env.SPOTIFY_CLIENT_SECRET || '',

  // নতুন গ্রুপের ডিফল্ট সেটিংস (প্রতিটি গ্রুপে কমান্ড দিয়ে বদলানো যায়)
  defaults: {
    // সুরক্ষা (ডিফল্টে বন্ধ — অ্যাডমিন চাইলে .help <নম্বর> on দিয়ে চালু করবেন)
    antilink: false,
    antisticker: false,
    antimention: false,
    antiflood: false,
    antiword: false,
    antidelete: false,
    // মেসেজ ও অন্যান্য
    welcome: true,
    goodbye: true,
    adminlog: true,
    levelup: false,
    verify: false,
    // ডিজাইন: থিম, ফন্ট ('auto' = থিমের নিজস্ব ফন্ট-মিশ্রণ), ভাষা (en|bn), ওয়েলকাম স্টাইল (card|photo|text)
    theme: process.env.DEFAULT_THEME || 'blossom',
    font: process.env.DEFAULT_FONT || 'auto',
    lang: process.env.DEFAULT_LANG || 'en',
    welcomeStyle: process.env.WELCOME_STYLE || 'card',
    // খালি = থিমের ডিফল্ট ডিজাইন। .setwelcome / .setgoodbye দিয়ে নিজের টেক্সট বসানো যায়
    welcomeCustom: '',
    goodbyeCustom: '',
    rules: '1️⃣ No links or spam\n2️⃣ Respect everyone\n3️⃣ No unwanted stickers or mass mentions',
  },
};
