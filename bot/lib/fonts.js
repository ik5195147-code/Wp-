/**
 * ইউনিকোড "ফ্যান্সি ফন্ট" — ইংরেজি অক্ষর (A–Z, a–z, 0–9) বদলে দেয়।
 * বাংলা, ইমোজি ও চিহ্ন অপরিবর্তিত থাকে।
 */
const mapper =
  ({ upper, lower, digit, ex = {} }) =>
  (ch) => {
    if (ex[ch]) return ex[ch];
    const c = ch.codePointAt(0);
    if (upper !== undefined && c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
    if (lower !== undefined && c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
    if (digit !== undefined && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
    return ch;
  };

const SC = Array.from('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ');
const smallcaps = (ch) => {
  const c = ch.toLowerCase().codePointAt(0);
  return c >= 97 && c <= 122 ? SC[c - 97] : ch;
};

// ⓑⓤⓑⓑⓛⓔ — অক্ষর ও সংখ্যা (০ = ⓪, ১–৯ = ①–⑨)
const circle = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x24b6 + c - 65);
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x24d0 + c - 97);
  if (c === 48) return '\u24ea';
  if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49);
  return ch;
};

// 🄱🄾🅇 — শুধু বড় হাতের অক্ষর (ছোট হাতেরও বড় রূপ দেখায়)
const square = (ch) => {
  const c = ch.toUpperCase().codePointAt(0);
  return c >= 65 && c <= 90 && ch.length === 1 ? String.fromCodePoint(0x1f130 + c - 65) : ch;
};

export const FONTS = {
  normal: (ch) => ch,
  bold: mapper({ upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec }), // 𝗕𝗼𝗹𝗱
  serifbold: mapper({ upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce }), // 𝐁𝐨𝐥𝐝
  italic: mapper({ upper: 0x1d434, lower: 0x1d44e, ex: { h: '\u210e' } }), // 𝐼𝑡𝑎𝑙𝑖𝑐
  bolditalic: mapper({ upper: 0x1d468, lower: 0x1d482 }), // 𝑩𝒐𝒍𝒅𝑰
  sansitalic: mapper({ upper: 0x1d608, lower: 0x1d622 }), // 𝘐𝘵𝘢𝘭𝘪𝘤
  script: mapper({ upper: 0x1d4d0, lower: 0x1d4ea }), // 𝓢𝓬𝓻𝓲𝓹𝓽
  fraktur: mapper({
    upper: 0x1d504,
    lower: 0x1d51e,
    ex: { C: '\u212d', H: '\u210c', I: '\u2111', R: '\u211c', Z: '\u2128' },
  }), // 𝔉𝔯𝔞𝔨𝔱𝔲𝔯
  boldfraktur: mapper({ upper: 0x1d56c, lower: 0x1d586 }), // 𝕭𝖔𝖑𝖉
  double: mapper({
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    ex: { C: '\u2102', H: '\u210d', N: '\u2115', P: '\u2119', Q: '\u211a', R: '\u211d', Z: '\u2124' },
  }), // 𝔻𝕠𝕦𝕓𝕝𝕖
  mono: mapper({ upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 }), // 𝙼𝚘𝚗𝚘
  smallcaps, // ꜱᴍᴀʟʟ ᴄᴀᴘꜱ
  wide: mapper({ upper: 0xff21, lower: 0xff41, digit: 0xff10 }), // ｗｉｄｅ
  circle, // ⓒⓘⓡⓒⓛⓔ
  square, // 🅂🅀🅄🄰🅁🄴
};

export const FONT_NAMES = Object.keys(FONTS);

export function applyFont(name, text) {
  const fn = FONTS[name];
  if (!fn || name === 'normal') return String(text);
  return Array.from(String(text)).map(fn).join('');
}

/**
 * টেমপ্লেটে ফন্ট প্রয়োগ করে, কিন্তু {placeholder} ও ভেতরে বসানো মান (যেমন @মেনশন) অক্ষত রাখে।
 * styled('Hello {user}', { user: '@8801…' }, 'bold') → '𝗛𝗲𝗹𝗹𝗼 @8801…'
 */
export function styled(tpl, vars = {}, font = 'normal') {
  return String(tpl)
    .split(/(\{\w+\})/)
    .map((seg, i) => {
      if (i % 2 === 1) {
        const key = seg.slice(1, -1);
        return key in vars ? String(vars[key]) : seg;
      }
      return applyFont(font, seg);
    })
    .join('');
}
