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
    antisticker: false,
    antimention: false,
    antilink: false,
    welcome: true,
    goodbye: true,
    adminlog: true,
    welcomeText:
      `👋 স্বাগতম {user}!\n*{group}* গ্রুপে আপনাকে ধন্যবাদ। বর্তমান সদস্য: {count} জন।\nনিয়ম ও কমান্ড দেখতে লিখুন: ${prefix}help`,
    goodbyeText: '🚶 {user} গ্রুপ ছেড়ে চলে গেছেন। ভালো থাকবেন!',
    rules:
      '1️⃣ কোনো লিঙ্ক বা স্প্যাম পাঠানো যাবে না\n2️⃣ সবাইকে সম্মান করুন\n3️⃣ অপ্রয়োজনীয় স্টিকার ও মাস-মেনশন নিষিদ্ধ',
  },
};
