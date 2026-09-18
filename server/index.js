import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { RoomManager, GameError } from './rooms.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
export function lanAddresses(port) {
  return Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal)
    .map(x => `http://${x.address}:${port}`);
}
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(res, code, data) {
  if (res.headersSent) return;
  res.writeHead(code, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new GameError('JSON requis.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new GameError('Requête trop volumineuse.', 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new GameError('JSON invalide.'); }
}

function getClientIp(req) {
  const xForwarded = req.headers['x-forwarded-for'];
  if (typeof xForwarded === 'string') {
    const candidate = xForwarded.split(',')[0].trim();
    if (/^[0-9a-fA-F:.]+$/.test(candidate) && candidate.length <= 45) {
      return candidate;
    }
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/** Native HTTP + authenticated SSE: no external packages and no install step. */
export function createApp(options = {}) {
  const manager = new RoomManager(options);
  const streams = new Map(), limits = new Map();
  const broadcast = r => {
    for (const p of r.players) {
      const res = streams.get(p.token);
      if (!res || res.destroyed) continue;
      const data = `event: state\ndata: ${JSON.stringify(manager.view(r, p))}\n\n`;
      if (res.writableLength > 256000) { res.destroy(); continue; }
      res.write(data);
    }
  };
  manager.onChange = broadcast;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw new GameError('Origine invalide.', 403); }
        const publicHost = options.publicBaseUrl ? new URL(options.publicBaseUrl).host : null;
        const forwardedHost = req.headers['x-forwarded-host'] ? req.headers['x-forwarded-host'].split(',')[0].trim() : null;
        if (origin.host !== req.headers.host && origin.host !== publicHost && origin.host !== forwardedHost) throw new GameError('Origine non autorisée.', 403);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/info') {
        const port = server.address()?.port ?? 3000;
        const isProd = Boolean(options.publicBaseUrl || process.env.NODE_ENV === 'production' || process.env.RENDER);
        return json(res, 200, { lan: isProd ? [] : lanAddresses(port), port, publicBaseUrl: options.publicBaseUrl || null });
      }
      if (url.pathname.startsWith('/api/')) {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const isEntry = ['/api/create', '/api/join'].includes(url.pathname);
        const ip = getClientIp(req), now = Date.now();
        // Classroom shares IP: rate limit actions by token when available, entry by validated IP
        const key = isEntry ? `entry:${ip}` : (token ? `action:${token}` : `action:${ip}`);
        let limit = limits.get(key);
        if (!limit || now - limit.start > 60000) { limit = { start: now, count: 0 }; limits.set(key, limit); }
        const maxRequests = isEntry ? 180 : (token ? 300 : 1800);
        if (++limit.count > maxRequests) throw new GameError('Trop de requêtes. Patiente un instant.', 429);
        if (req.method === 'GET' && url.pathname === '/api/events') {
          const { r, p } = manager.auth(token);
          const previous = streams.get(token);
          if (previous) { previous.write('event: replaced\ndata: {}\n\n'); previous.end(); }
          res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders(); req.socket.setTimeout(0);
          streams.set(token, res); manager.connect(token);
          res.on('close', () => {
            if (streams.get(token) === res) { streams.delete(token); manager.disconnect(token); }
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/state') {
          const { r, p } = manager.auth(token); return json(res, 200, manager.view(r, p));
        }
        if (req.method === 'POST') {
          const msg = await body(req);
          if (url.pathname === '/api/create') return json(res, 200, manager.create(msg));
          if (url.pathname === '/api/join') return json(res, 200, manager.join(msg));
          if (url.pathname === '/api/action') return json(res, 200, manager.act(token, msg));
          if (url.pathname === '/api/leave') {
            manager.leave(token); const stream = streams.get(token); streams.delete(token); stream?.end();
            return json(res, 200, { ok: true });
          }
        }
        throw new GameError('Route inconnue.', 404);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && assets.has(url.pathname)) {
        const [name, mime] = assets.get(url.pathname), file = path.join(root, 'public', name);
        const metadata = await stat(file);
        res.writeHead(200, { ...securityHeaders, 'Content-Type': mime, 'Content-Length': metadata.size });
        return res.end(req.method === 'HEAD' ? undefined : await readFile(file));
      }
      json(res, 404, { error: 'Page introuvable.' });
    } catch (error) {
      const status = error.status ?? 400;
      if (!(error instanceof GameError) && !['Ce n’est pas ton tour.'].includes(error.message)) {
        // No request payloads or tokens in logs.
        if (error.code) console.error(error.code);
      }
      json(res, status, { error: error.message || 'Impossible de traiter cette action.' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const clock = setInterval(() => manager.tick(), options.tickMs ?? 200); clock.unref();
  const heartbeat = setInterval(() => {
    for (const [token, res] of streams) {
      if (!manager.tokens.has(token)) { res.write('event: expired\ndata: {}\n\n'); res.end(); streams.delete(token); }
      else res.write(': heartbeat\n\n');
    }
    for (const [key, value] of limits) if (Date.now() - value.start > 60000) limits.delete(key);
  }, 10000); heartbeat.unref();
  async function stop() {
    clearInterval(clock); clearInterval(heartbeat);
    for (const res of streams.values()) res.end(); streams.clear();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  return { server, manager, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT doit être compris entre 1 et 65535.'); process.exit(1); }
  let publicBaseUrl = process.env.PUBLIC_BASE_URL || '';
  if (publicBaseUrl) {
    try { const u = new URL(publicBaseUrl); if (!['http:', 'https:'].includes(u.protocol)) throw Error(); publicBaseUrl = u.origin; }
    catch { console.error('PUBLIC_BASE_URL doit être une adresse HTTP(S) valide.'); process.exit(1); }
  }
  const app = createApp({ publicBaseUrl });
  app.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé. Choisis un autre PORT dans .env. Aucun autre programme n’a été arrêté.` : error.message);
    process.exitCode = 1;
  });
  app.server.listen(port, '0.0.0.0', () => {
    console.log('\n  ♠  CLUB ROYAL — Poker & Blackjack\n');
    console.log(`  Sur ce PC : http://localhost:${port}`);
    for (const url of lanAddresses(port)) console.log(`  Adresse réseau candidate : ${url}`);
    if (publicBaseUrl) console.log(`  Adresse publique configurée : ${publicBaseUrl}`);
    console.log('\n  Garde cette fenêtre ouverte. Ctrl+C pour arrêter.');
    console.log('  Les autres joueurs ouvrent une adresse réseau de CE PC.');
    console.log('  Le pare-feu et le réseau de l’école doivent autoriser cette connexion.');
    console.log('  Jetons fictifs uniquement — aucune valeur monétaire.\n');
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.stop(); process.exit(0); });
}
