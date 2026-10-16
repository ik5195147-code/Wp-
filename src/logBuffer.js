/**
 * console.* ও pino লগ মেমোরিতে (শেষ ৩০০ লাইন) জমায়, যাতে ড্যাশবোর্ডে দেখানো যায়।
 * এটি অবশ্যই সবার আগে import করতে হবে (server.js তে করা আছে)।
 */
const MAX = 300;
const lines = [];

export function pushLog(level, text) {
  const line = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!line) return;
  lines.push({ t: Date.now(), level, line });
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

export const getLogs = (n = 120) => lines.slice(-Math.min(Math.max(n, 1), MAX));

const show = (a) => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};

for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    pushLog(level, args.map(show).join(' '));
  };
    }
