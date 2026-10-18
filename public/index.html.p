<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>WA Bot Host</title>
<style>
  :root {
    --bg: #f4f6f8; --card: #ffffff; --text: #17212b; --muted: #5d6b79;
    --line: #dde3ea; --accent: #128c7e; --accent-text: #ffffff;
    --ok: #1a8f4c; --warn: #b36b00; --bad: #c62828; --log-bg: #0f1720; --log-text: #cfe3f1;
  }
  :root:not([data-theme="light"]) { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e141a; --card: #17202a; --text: #e8eef4; --muted: #94a3b2;
      --line: #2a3541; --accent: #25b8a6; --accent-text: #04201c;
      --ok: #4ade80; --warn: #fbbf24; --bad: #f87171; --log-bg: #0a0f14; --log-text: #cfe3f1;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Kalpurush", sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 20px; margin: 4px 0 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .muted { color: var(--muted); font-size: 13px; }
  .hidden { display: none !important; }
  input[type=password], input[type=tel] {
    width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-size: 16px;
  }
  button {
    border: 1px solid var(--line); background: var(--card); color: var(--text);
    padding: 11px 14px; border-radius: 10px; font-size: 14px; cursor: pointer;
  }
  button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
  button.danger { color: var(--bad); border-color: var(--bad); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row > * { flex: 1 1 auto; }
  .pill { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; border: 1px solid currentColor; }
  .pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); } .pill.bad { color: var(--bad); } .pill.off { color: var(--muted); }
  .qr { display: block; margin: 8px auto; width: 100%; max-width: 300px; background: #fff; padding: 8px; border-radius: 12px; }
  .code { font: 700 30px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 3px; text-align: center; padding: 12px; border: 2px dashed var(--accent); border-radius: 12px; margin: 10px 0; user-select: all; }
  .banner { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--warn); color: var(--warn); margin-bottom: 14px; font-size: 14px; }
  .banner.bad { border-color: var(--bad); color: var(--bad); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip { font-size: 12px; padding: 3px 9px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); }
  #logs { background: var(--log-bg); color: var(--log-text); border-radius: 10px; padding: 10px; height: 260px; overflow: auto; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; word-break: break-word; }
  #logs div.error { color: #ff8a80; } #logs div.warn, #logs div.pino { color: #ffd180; }
  ol { margin: 6px 0 0; padding-left: 20px; }
  .err { color: var(--bad); font-size: 13px; margin-top: 8px; min-height: 18px; }
</style>
</head>
<body>
<div class="wrap">

  <!-- লগইন -->
  <section id="loginView" class="hidden">
    <h1>🤖 WA Bot Host</h1>
    <div class="card">
      <h2>অ্যাডমিন লগইন</h2>
      <input id="pw" type="password" placeholder="ADMIN_PASSWORD" autocomplete="current-password">
      <div class="row" style="margin-top:10px"><button class="primary" id="loginBtn">লগইন</button></div>
      <div class="err" id="loginErr"></div>
    </div>
  </section>

  <!-- ড্যাশবোর্ড -->
  <section id="appView" class="hidden">
    <h1>
      <span>🤖 <span id="botName">WA Bot Host</span></span>
      <button id="signoutBtn" style="flex:0 0 auto">সাইন-আউট</button>
    </h1>

    <div id="volWarn" class="banner hidden">
      ⚠️ Railway Volume শনাক্ত হয়নি। রিডিপ্লয় করলে WhatsApp সেশন হারিয়ে যাবে — README অনুযায়ী Volume যোগ করুন।
    </div>
    <div id="errBox" class="banner bad hidden"></div>

    <div class="card">
      <div class="row" style="align-items:center">
        <div style="flex:1 1 60%">
          <div class="muted">বটের অবস্থা</div>
          <span id="statusPill" class="pill off">…</span>
          <div id="userLine" class="muted" style="margin-top:6px"></div>
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="startBtn">▶️ স্টার্ট</button>
        <button id="stopBtn">⏹ স্টপ</button>
        <button id="restartBtn">🔄 রিস্টার্ট</button>
        <button id="logoutBtn" class="danger">🚪 WhatsApp লগআউট</button>
      </div>
      <div id="chips" class="chips"></div>
    </div>

    <!-- লগইন কার্ড: QR / পেয়ারিং কোড -->
    <div id="loginCard" class="card hidden">
      <h2>📱 WhatsApp লিংক করুন</h2>
      <p class="muted" style="margin-top:0">
        <b>ফোন থেকেই চালালে পেয়ারিং কোড সহজ।</b> কম্পিউটার/অন্য ফোনে ড্যাশবোর্ড খুললে QR স্ক্যান করুন।
      </p>

      <h2>পদ্ধতি ১ — পেয়ারিং কোড</h2>
      <input id="phone" type="tel" inputmode="numeric" placeholder="বটের নম্বর, যেমন 8801XXXXXXXXX">
      <div class="row" style="margin-top:8px"><button class="primary" id="pairBtn">কোড নিন</button></div>
      <div id="pairBox" class="hidden">
        <div class="code" id="pairCode"></div>
        <ol class="muted">
          <li>বটের নম্বরের WhatsApp খুলুন → <b>Settings → Linked devices → Link a device</b></li>
          <li><b>"Link with phone number instead"</b> চাপুন</li>
          <li>উপরের কোডটি বসান</li>
        </ol>
      </div>
      <div class="err" id="pairErr"></div>

      <h2 style="margin-top:16px">পদ্ধতি ২ — QR কোড</h2>
      <img id="qrImg" class="qr hidden" alt="WhatsApp QR">
      <div id="qrWait" class="muted">QR তৈরি হচ্ছে…</div>
      <div class="muted">WhatsApp → Linked devices → Link a device → QR স্ক্যান। QR কিছুক্ষণ পরপর বদলায়।</div>
    </div>

    <div class="card">
      <h2>📜 লাইভ লগ</h2>
      <div id="logs"></div>
    </div>
    <p class="muted" style="text-align:center">সার্ভার চালু আছে: <span id="srvUp">–</span></p>
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
const STATUS = {
  stopped:       ['বন্ধ', 'off'],
  starting:      ['চালু হচ্ছে…', 'warn'],
  waiting_login: ['লগইনের অপেক্ষায়', 'warn'],
  connected:     ['✅ সংযুক্ত', 'ok'],
  reconnecting:  ['আবার সংযোগ হচ্ছে…', 'warn'],
  logged_out:    ['লগআউট হয়েছে', 'bad'],
  replaced:      ['অন্য জায়গায় সেশন খুলেছে', 'bad'],
};
let timers = [];

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('unauthorized'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'কিছু ভুল হয়েছে');
  return json;
}

function showLogin() {
  timers.forEach(clearInterval); timers = [];
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}
function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  refresh(); refreshLogs();
  timers.push(setInterval(refresh, 2500), setInterval(refreshLogs, 5000));
}

function fmtDur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d ? d + 'দিন ' : '') + (h ? h + 'ঘ ' : '') + m + 'মি';
}

async function refresh() {
  let s;
  try { s = await api('/api/status'); } catch { return; }

  const [label, cls] = STATUS[s.status] || [s.status, 'off'];
  const pill = $('statusPill');
  pill.textContent = label; pill.className = 'pill ' + cls;

  $('botName').textContent = s.config.botName;
  $('userLine').textContent = s.status === 'connected'
    ? `নম্বর: ${String(s.user || '').split(':')[0].split('@')[0]} • সংযুক্ত: ${fmtDur(Math.round(s.uptimeMs / 1000))}` : '';

  const eb = $('errBox');
  if (s.lastError) { eb.textContent = s.lastError; eb.classList.remove('hidden'); } else eb.classList.add('hidden');
  $('volWarn').classList.toggle('hidden', !s.server.volumeWarning);

  const running = ['starting', 'waiting_login', 'connected', 'reconnecting'].includes(s.status);
  $('startBtn').disabled = running;
  $('stopBtn').disabled = !running;
  $('restartBtn').disabled = !running;

  // QR / পেয়ারিং কার্ড
  const waiting = s.status === 'waiting_login';
  $('loginCard').classList.toggle('hidden', !waiting);
  if (waiting) {
    if (s.qr) { $('qrImg').src = s.qr; $('qrImg').classList.remove('hidden'); $('qrWait').classList.add('hidden'); }
    if (s.pairing) { $('pairCode').textContent = s.pairing.code; $('pairBox').classList.remove('hidden'); }
  } else { $('pairBox').classList.add('hidden'); $('qrImg').classList.add('hidden'); }

  const chips = [
    `প্রিফিক্স: ${s.config.prefix}`,
    `মালিক: ${s.config.owners} জন`,
    `YouTube: ${s.config.youtube ? '✅' : '❌'}`,
    `Spotify: ${s.config.spotify ? '✅' : '❌'}`,
    `ডাটা: ${s.server.dataDir}`,
  ];
  $('chips').replaceChildren(...chips.map((t) => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = t; return c; }));
  $('srvUp').textContent = fmtDur(s.server.uptimeSec);
}

async function refreshLogs() {
  let r;
  try { r = await api('/api/logs?n=150'); } catch { return; }
  const box = $('logs');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  // লগে WhatsApp মেসেজের অংশ থাকতে পারে, তাই শুধু textContent ব্যবহার (XSS নিরাপদ)
  box.replaceChildren(...r.logs.map((l) => {
    const d = document.createElement('div');
    d.className = l.level;
    d.textContent = new Date(l.t).toLocaleTimeString('bn-BD', { hour12: false }) + '  ' + l.line;
    return d;
  }));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function action(path, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try { await api(path, 'POST'); } catch (e) { if (e.message !== 'unauthorized') alert(e.message); }
  refresh();
}

$('loginBtn').onclick = async () => {
  $('loginErr').textContent = '';
  try { await api('/api/login', 'POST', { password: $('pw').value }); $('pw').value = ''; showApp(); }
  catch (e) { $('loginErr').textContent = e.message; }
};
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });
$('signoutBtn').onclick = async () => { await api('/api/signout', 'POST').catch(() => {}); showLogin(); };
$('startBtn').onclick = () => action('/api/bot/start');
$('stopBtn').onclick = () => action('/api/bot/stop');
$('restartBtn').onclick = () => action('/api/bot/restart');
$('logoutBtn').onclick = () => action('/api/bot/logout', 'WhatsApp থেকে বটের ডিভাইস আনলিংক হবে এবং সেভ করা সেশন মুছে যাবে। নিশ্চিত?');
$('pairBtn').onclick = async () => {
  $('pairErr').textContent = ''; $('pairBtn').disabled = true;
  try { const { code } = await api('/api/bot/pair', 'POST', { phone: $('phone').value }); $('pairCode').textContent = code; $('pairBox').classList.remove('hidden'); }
  catch (e) { $('pairErr').textContent = e.message; }
  $('pairBtn').disabled = false;
};

// পেজ লোডে লগইন আছে কিনা দেখা
api('/api/status').then(showApp).catch(() => showLogin());
</script>
</body>
  </html>
