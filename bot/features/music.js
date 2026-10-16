import { config } from '../config.js';
import { UserError } from '../lib/utils.js';

/**
 * মিউজিক সার্চ (শুধু অফিসিয়াল API)।
 *
 * গুরুত্বপূর্ণ: YouTube ও Spotify এর অফিসিয়াল API দিয়ে গানের অডিও ফাইল
 * ডাউনলোড/স্ট্রিম করে অন্য অ্যাপে পাঠানো যায় না (ToS ও কপিরাইট)।
 * তাই বট গান খুঁজে কভার ছবি, টাইটেল ও প্লে-লিঙ্ক পাঠায় — লিঙ্কে ট্যাপ করলেই
 * ইউটিউব/স্পটিফাই অ্যাপে গান বাজে। লাইসেন্সপ্রাপ্ত নিজস্ব অডিও পাঠানোর
 * উদাহরণ README-তে দেওয়া আছে।
 */

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/* ----------------------------- YouTube ----------------------------- */

export async function youtubeSearch(query, max = 5) {
  if (!config.youtubeKey) throw new UserError('YOUTUBE_API_KEY সেট করা নেই (.env দেখুন)।');

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10', // Music
    maxResults: String(max),
    safeSearch: 'moderate',
    q: query,
    key: config.youtubeKey,
  }).toString();

  const res = await fetch(url);
  if (res.status === 403) throw new UserError('YouTube API কোটা শেষ বা কী সীমাবদ্ধ। পরে চেষ্টা করুন।');
  if (!res.ok) throw new UserError(`YouTube API সমস্যা (${res.status})`);

  const json = await res.json();
  return (json.items || []).map((i) => ({
    title: decode(i.snippet.title),
    channel: decode(i.snippet.channelTitle),
    thumb: i.snippet.thumbnails?.high?.url || i.snippet.thumbnails?.medium?.url,
    url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
  }));
}

/* ----------------------------- Spotify ----------------------------- */

let token = { value: null, exp: 0 };

async function spotifyToken() {
  if (token.value && Date.now() < token.exp) return token.value;
  if (!config.spotifyId || !config.spotifySecret) {
    throw new UserError('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET সেট করা নেই (.env দেখুন)।');
  }
  const basic = Buffer.from(`${config.spotifyId}:${config.spotifySecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new UserError(`Spotify অথেন্টিকেশন ব্যর্থ (${res.status})`);
  const json = await res.json();
  token = { value: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return token.value;
}

export async function spotifySearch(query, limit = 5) {
  const t = await spotifyToken();
  const qs = new URLSearchParams({ q: query, type: 'track', limit: String(limit) });
  const res = await fetch(`https://api.spotify.com/v1/search?${qs}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (res.status === 429) throw new UserError('Spotify রেট লিমিট — একটু পরে চেষ্টা করুন।');
  if (!res.ok) throw new UserError(`Spotify API সমস্যা (${res.status})`);

  const json = await res.json();
  return (json.tracks?.items || []).map((t) => ({
    title: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    album: t.album?.name,
    thumb: t.album?.images?.[0]?.url,
    url: t.external_urls?.spotify,
    duration: fmt(t.duration_ms),
  }));
}

function fmt(ms = 0) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
