/**
 * চালু/বন্ধ করা যায় এমন ফিচারের তালিকা (সেটিংস-কী, কমান্ড-নাম, লেবেল)।
 * `.help` প্যানেল ও `.help <নম্বর/নাম> on|off` দুটোই এটি ব্যবহার করে।
 * needsBotAdmin = চালু করলেও বট অ্যাডমিন না হলে কাজ করবে না।
 */
export const FEATURES = [
  { key: 'antilink', cmd: 'antilink', label: 'Anti-Link', desc: 'Deletes links and removes the sender', needsBotAdmin: true },
  { key: 'antisticker', cmd: 'antisticker', label: 'Anti-Sticker', desc: 'Deletes stickers from members', needsBotAdmin: true },
  { key: 'antimention', cmd: 'antimention', label: 'Anti-Mention', desc: 'Deletes mass mentions', needsBotAdmin: true },
  { key: 'antiflood', cmd: 'antiflood', label: 'Anti-Flood', desc: 'Stops message flooding and warns the sender', needsBotAdmin: true },
  { key: 'antiword', cmd: 'wordfilter', label: 'Word Filter', desc: 'Deletes banned words and warns the sender', needsBotAdmin: true },
  { key: 'antidelete', cmd: 'antidelete', label: 'Delete Log', desc: 'Records deleted messages in the admin log (not reposted)' },
  { key: 'welcome', cmd: 'welcome', label: 'Welcome', desc: 'Welcome card for new members' },
  { key: 'goodbye', cmd: 'goodbye', label: 'Goodbye', desc: 'Goodbye message when someone leaves' },
  { key: 'adminlog', cmd: 'adminnotify', label: 'Admin Alerts', desc: 'Announces promotions, demotions and removals' },
  { key: 'levelup', cmd: 'levelup', label: 'Level-Up Alerts', desc: 'Announces when a member levels up' },
  { key: 'verify', cmd: 'captcha', label: 'Verification', desc: 'New members must solve a quick question or get removed', needsBotAdmin: true },
];

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** নম্বর (১–১১), কী, কমান্ড-নাম বা লেবেল দিয়ে ফিচার খোঁজে। */
export function findFeature(arg) {
  const a = clean(arg);
  if (!a) return undefined;
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= FEATURES.length) return FEATURES[n - 1];
  return FEATURES.find((f) => f.key === a || f.cmd === a || clean(f.label) === a);
}
