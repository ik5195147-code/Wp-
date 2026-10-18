/**
 * চালু/বন্ধ করা যায় এমন ফিচারের তালিকা (সেটিংস-কী, কমান্ড-নাম, লেবেল)।
 * `.help` প্যানেল ও `.help <নম্বর/নাম> on|off` দুটোই এটি ব্যবহার করে।
 */
export const FEATURES = [
  { key: 'antilink', cmd: 'antilink', label: 'Anti-Link', bn: 'অ্যান্টি-লিঙ্ক (ডিলিট + অটো-কিক)', needsBotAdmin: true },
  { key: 'antisticker', cmd: 'antisticker', label: 'Anti-Sticker', bn: 'অ্যান্টি-স্টিকার', needsBotAdmin: true },
  { key: 'antimention', cmd: 'antimention', label: 'Anti-Mention', bn: 'অ্যান্টি-মেনশন', needsBotAdmin: true },
  { key: 'welcome', cmd: 'welcome', label: 'Welcome', bn: 'ওয়েলকাম মেসেজ' },
  { key: 'goodbye', cmd: 'goodbye', label: 'Goodbye', bn: 'গুডবাই মেসেজ' },
  { key: 'adminlog', cmd: 'adminnotify', label: 'Admin Alerts', bn: 'অ্যাডমিন ইভেন্ট নোটিফিকেশন' },
];

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** নম্বর (১–৬), কী, কমান্ড-নাম বা লেবেল দিয়ে ফিচার খোঁজে। */
export function findFeature(arg) {
  const a = clean(arg);
  if (!a) return undefined;
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= FEATURES.length) return FEATURES[n - 1];
  return FEATURES.find((f) => f.key === a || f.cmd === a || clean(f.label) === a);
}
