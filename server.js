const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'redirects.json');

function loadRedirects() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}

function saveRedirects(map) {
  fs.writeFileSync(DB_FILE, JSON.stringify(map, null, 2));
}

let redirects = loadRedirects();

function randomSlug(len = 6) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) reject(new Error('Too large')); });
    req.on('end',  () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

const STATIC = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.ico':'image/x-icon' };

function serveStatic(res, filePath) {
  const ext  = path.extname(filePath);
  const mime = STATIC[ext] || 'text/plain';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE','Access-Control-Allow-Headers':'Content-Type' });
    res.end(); return;
  }


  if (method === 'GET' && pathname === '/api/redirects') {
    return jsonResponse(res, 200, redirects);
  }


  if (method === 'POST' && pathname === '/api/redirects') {
    let body;
    try { body = await parseBody(req); } catch { return jsonResponse(res, 400, { error: 'Invalid JSON' }); }

    let { slug, destination } = body;

    if (!destination || !destination.startsWith('http')) {
      return jsonResponse(res, 400, { error: 'destination must be a full URL starting with http(s)://' });
    }

    slug = (slug || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!slug) slug = randomSlug();

    if (redirects[`/${slug}`]) {
      return jsonResponse(res, 409, { error: `Slug "/${slug}" is already taken` });
    }

    redirects[`/${slug}`] = destination;
    saveRedirects(redirects);

    console.log(`[CREATE] /${slug}  →  ${destination}`);
    return jsonResponse(res, 201, { slug: `/${slug}`, destination });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/redirects/')) {
    const slug = '/' + pathname.replace('/api/redirects/', '');
    if (!redirects[slug]) return jsonResponse(res, 404, { error: 'Not found' });
    delete redirects[slug];
    saveRedirects(redirects);
    console.log(`[DELETE] ${slug}`);
    return jsonResponse(res, 200, { deleted: slug });
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveStatic(res, path.join(__dirname, 'index.html'));
  }

  const destination = redirects[pathname];
  if (destination) {
    res.writeHead(302, { 'Location': destination, 'Content-Type': 'text/plain' });
    res.end(`Redirecting to ${destination}`);
    console.log(`[302] ${pathname}  →  ${destination}`);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`404 — no redirect for "${pathname}"\n`);
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
