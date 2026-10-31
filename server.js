// T4P × Thaura hackathon — submissions
// Zero-dependency Node server: JSON file storage, rate limits, input sanitizing.
// Run locally:  PORT=3000 node server.js
// In Docker the data lives on a persistent volume at /app/data.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'submissions.json');
const ASSETS_DIR = path.join(__dirname, 'assets');
const PUBLIC_DIR = __dirname;

const MAX_SUBMISSIONS = 100;   // hard cap on the board
const MAX_NAME = 80;
const MAX_MEMBER = 60;
const MAX_MEMBERS = 8;
const MAX_URL = 200;

// Rate limits
const SUB_LIMITS = { client: { n: 8, ms: 3600e3 }, ip: { n: 60, ms: 3600e3 } };

// Admin key: set ADMIN_KEY env when you can. On the build platform there is no
// env override, so if unset we generate one on first boot, persist it in
// DATA_DIR/admin.json (which survives redeploys) and log it once in the build log.
let ADMIN_KEY = process.env.ADMIN_KEY || '';
(function initAdminKey() {
  if (ADMIN_KEY) return;
  const f = path.join(DATA_DIR, 'admin.json');
  try {
    const stored = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (stored && stored.key) { ADMIN_KEY = stored.key; return; }
  } catch (e) { /* not stored yet */ }
  ADMIN_KEY = crypto.randomBytes(12).toString('base64url');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ key: ADMIN_KEY })); } catch (e) {}
  console.log('ADMIN_KEY generated and saved to admin.json:', ADMIN_KEY);
})();

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { submissions: [] };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(db.submissions)) db = { submissions: [] };
} catch (e) { /* first run */ }

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (err) { console.error('save failed', err); return; }
      fs.rename(tmp, DB_FILE, () => {});
    });
  }, 250);
}

// ---------- sanitize ----------
function clean(s, max) {
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}
function cleanUrl(u) {
  if (typeof u !== 'string') return '';
  u = u.trim();
  if (u.length > MAX_URL) u = u.slice(0, MAX_URL);
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return '';
  if (!/\./.test(new URL(u).host)) return '';
  return u;
}

// ---------- rate limit ----------
const hits = new Map(); // key -> [timestamps]
function allow(key, n, ms) {
  const now = Date.now();
  let arr = hits.get(key) || [];
  arr = arr.filter((t) => now - t < ms);
  if (arr.length >= n) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

// ---------- helpers ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function csvField(s) {
  s = String(s == null ? '' : s);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function readBody(req, limit, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { cb(e); }
  });
  req.on('error', (e) => cb(e));
}

function serveStatic(res, filePath, type, cacheable) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cacheable ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.socket.remoteAddress || 'unknown';
  const method = req.method.toUpperCase();

  // ----- API: list -----
  if (method === 'GET' && req.url === '/api/submissions') {
    return json(res, 200, { submissions: db.submissions, cap: MAX_SUBMISSIONS });
  }

  // ----- API: create -----
  if (method === 'POST' && req.url === '/api/submissions') {
    return readBody(req, 16 * 1024, (err, body) => {
      if (err || !body || typeof body !== 'object') {
        return json(res, 400, { error: 'Could not read that submission.' });
      }

      // Honeypot — bots fill it, people don't
      if (typeof body.hp === 'string' && body.hp.trim() !== '') {
        return json(res, 200, { ok: true, submission: { id: 'ignored', name: 'ok', members: [], url: 'https://ok', t: new Date().toISOString() } });
      }

      if (db.submissions.length >= MAX_SUBMISSIONS) {
        return json(res, 409, { error: 'The board is full. Ask Matt at the judging desk.' });
      }

      const clientId = String(req.headers['x-sub-client'] || '').replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!allow('c:' + clientId, SUB_LIMITS.client.n, SUB_LIMITS.client.ms)) {
        return json(res, 429, { error: 'You have submitted a few already today. If you need to change one, tell Matt.' });
      }
      if (!allow('i:' + ip, SUB_LIMITS.ip.n, SUB_LIMITS.ip.ms)) {
        return json(res, 429, { error: 'Too many submissions from this network. Try again in an hour.' });
      }

      const name = clean(body.name, MAX_NAME);
      if (!name) return json(res, 400, { error: 'The project needs a name.' });

      let members = Array.isArray(body.members) ? body.members : [];
      members = members.map((m) => clean(m, MAX_MEMBER)).filter(Boolean).slice(0, MAX_MEMBERS);
      if (!members.length) return json(res, 400, { error: 'Add at least one team member.' });

      const url = cleanUrl(body.url);
      if (!url) return json(res, 400, { error: 'That link does not look right. It needs to start with http:// or https:// and be reachable.' });

      const submission = {
        id: crypto.randomBytes(6).toString('hex'),
        name,
        members,
        url,
        t: new Date().toISOString(),
      };
      db.submissions.unshift(submission);
      save();
      return json(res, 200, { ok: true, submission });
    });
  }

  // ----- API: admin -----
  if (method === 'GET' && req.url === '/api/admin/check') {
    const key = String(req.headers['x-admin-key'] || '');
    return json(res, ADMIN_KEY && key === ADMIN_KEY ? 200 : 403, { ok: key === ADMIN_KEY && !!ADMIN_KEY });
  }

  if (method === 'GET' && req.url === '/api/admin/export.csv') {
    const key = String(req.headers['x-admin-key'] || '');
    if (!ADMIN_KEY || key !== ADMIN_KEY) return json(res, 403, { error: 'Not authorised.' });
    const rows = [['id', 'time', 'project', 'members', 'url']];
    for (const s of db.submissions) {
      rows.push([s.id, s.t, s.name, s.members.join(' | '), s.url]);
    }
    const csv = rows.map((r) => r.map(csvField).join(',')).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="t4p-submissions.csv"',
    });
    return res.end(csv);
  }

  const delMatch = req.url.match(/^\/api\/submissions\/([a-z0-9]+)$/);
  if (method === 'DELETE' && delMatch) {
    const key = String(req.headers['x-admin-key'] || '');
    if (!ADMIN_KEY || key !== ADMIN_KEY) return json(res, 403, { error: 'Not authorised.' });
    const before = db.submissions.length;
    db.submissions = db.submissions.filter((s) => s.id !== delMatch[1]);
    if (db.submissions.length === before) return json(res, 404, { error: 'No such submission.' });
    save();
    return json(res, 200, { ok: true });
  }

  // ----- static -----
  if (method === 'GET' || method === 'HEAD') {
    if (req.url === '/' || req.url === '/index.html') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8', false);
    }
    if (req.url.startsWith('/assets/') && !req.url.includes('..')) {
      const name = path.basename(req.url);
      const types = { '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      const ext = path.extname(name).toLowerCase();
      if (types[ext]) return serveStatic(res, path.join(ASSETS_DIR, name), types[ext], true);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`t4p-submissions listening on :${PORT} — db at ${DB_FILE}`);
});
