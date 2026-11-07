import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, TABLES, getState, putSettings, insertRow, updateRow, deleteRow, resetAll, loadSample } from './db.js';
import { currentMonth } from './public/projection.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const db = openDb(process.env.BUDGET_DB || join(ROOT, 'data', 'budget.db'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const STATIC_ALIASES = {};

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error('Body too large'); }
  return raw ? JSON.parse(raw) : {};
}

async function api(req, res, parts) {
  const [, , table, id] = parts; // ['', 'api', table, id]
  const method = req.method;

  if (table === 'state' && method === 'GET') return send(res, 200, getState(db));
  if (table === 'settings' && method === 'PUT') { putSettings(db, await readBody(req)); return send(res, 200, getState(db).settings); }
  if (table === 'reset' && method === 'POST') { resetAll(db); return send(res, 200, getState(db)); }
  if (table === 'sample' && method === 'POST') { loadSample(db, currentMonth()); return send(res, 200, getState(db)); }
  if (table === 'import' && method === 'POST') {
    const data = await readBody(req);
    db.exec('BEGIN');
    try {
      resetAll(db);
      putSettings(db, data.settings || {});
      // Preserve ids so divert/target references stay intact.
      for (const t of Object.keys(TABLES)) for (const row of data[t] || []) insertRow(db, t, row, true);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return send(res, 200, getState(db));
  }

  if (!Object.hasOwn(TABLES, table)) return send(res, 404, { error: 'Unknown resource' });
  const rowId = id === undefined ? null : Number(id);
  if (id !== undefined && !Number.isInteger(rowId)) return send(res, 400, { error: 'Bad id' });

  if (method === 'POST' && rowId === null) {
    const body = await readBody(req);
    return send(res, 201, insertRow(db, table, body, body.id != null)); // id is kept when restoring an undone delete
  }
  if (method === 'PUT' && rowId !== null) {
    const row = updateRow(db, table, rowId, await readBody(req));
    return row ? send(res, 200, row) : send(res, 404, { error: 'Not found' });
  }
  if (method === 'DELETE' && rowId !== null) { deleteRow(db, table, rowId); return send(res, 204); }
  return send(res, 405, { error: 'Method not allowed' });
}

async function serveStatic(req, res, pathname) {
  let file = STATIC_ALIASES[pathname];
  if (!file) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname.split('/'));
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    return await serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`Budget planner running at http://localhost:${PORT}`);
});
