import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { addMonths } from './public/projection.js';

// Whitelisted tables and their editable columns.
export const TABLES = {
  raises:   { month: 'TEXT', type: "TEXT DEFAULT 'percent'", value: 'REAL DEFAULT 0', note: 'TEXT' },
  bonuses:  { month: 'TEXT', amount: 'REAL DEFAULT 0', repeat_yearly: 'INTEGER DEFAULT 0', target: "TEXT DEFAULT 'free'", note: 'TEXT' },
  expenses: { name: 'TEXT', category: 'TEXT', amount: 'REAL DEFAULT 0', start_month: 'TEXT', end_month: 'TEXT', one_off: 'INTEGER DEFAULT 0' },
  loans:    { name: 'TEXT', emi: 'REAL', principal: 'REAL', annual_rate: 'REAL', start_month: 'TEXT', tenure_months: 'INTEGER DEFAULT 12', divert_to: "TEXT DEFAULT 'free'" },
  // One-off extra contributions to a goal in a specific month (added from the Calendar).
  allocations: { month: 'TEXT', goal_id: 'TEXT', amount: 'REAL DEFAULT 0', note: 'TEXT' },
  goals:    { name: 'TEXT', color: 'INTEGER', monthly_amount: 'REAL DEFAULT 0', target_amount: 'REAL', opening_balance: 'REAL DEFAULT 0', start_month: 'TEXT', on_complete: "TEXT DEFAULT 'divert'", divert_to: "TEXT DEFAULT 'free'" },
};
const SETTINGS_KEYS = ['start_month', 'horizon_months', 'base_salary', 'opening_balance'];

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  for (const [t, cols] of Object.entries(TABLES)) {
    const defs = Object.entries(cols).map(([c, d]) => `${c} ${d}`).join(', ');
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs})`);
  }
  return db;
}

const clean = (table, body) => {
  const cols = TABLES[table];
  const out = {};
  for (const k of Object.keys(cols)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (v === '' || v === undefined) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v !== null && /REAL|INTEGER/.test(cols[k])) { v = Number(v); if (Number.isNaN(v)) v = null; }
    out[k] = v;
  }
  return out;
};

export function getState(db) {
  const settings = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) settings[key] = value;
  for (const k of ['horizon_months', 'base_salary', 'opening_balance']) if (settings[k] != null) settings[k] = Number(settings[k]);
  const state = { settings };
  for (const t of Object.keys(TABLES)) state[t] = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all().map((r) => ({ ...r }));
  return state;
}

export function putSettings(db, body) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of SETTINGS_KEYS) if (k in body) stmt.run(k, body[k] === null || body[k] === '' ? null : String(body[k]));
}

export function insertRow(db, table, body, keepId = false) {
  const data = clean(table, body);
  if (keepId && body.id != null && Number.isInteger(Number(body.id))) data.id = Number(body.id);
  if (table === 'goals' && data.color == null) {
    const used = new Set(db.prepare('SELECT color FROM goals').all().map((r) => r.color));
    data.color = [1, 2, 3, 4, 5, 6, 7, 0].find((c) => !used.has(c)) ?? 0;
  }
  const keys = Object.keys(data);
  const info = keys.length
    ? db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => data[k]))
    : db.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run();
  return { ...db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid) };
}

export function updateRow(db, table, id, body) {
  const data = clean(table, body);
  const keys = Object.keys(data);
  if (keys.length) db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), id);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return row ? { ...row } : null;
}

export function deleteRow(db, table, id) {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  // Anything pointing at a deleted goal falls back to free savings.
  if (table === 'goals') {
    db.prepare("UPDATE goals SET divert_to = 'free' WHERE divert_to = ?").run(String(id));
    db.prepare("UPDATE loans SET divert_to = 'free' WHERE divert_to = ?").run(String(id));
    db.prepare("UPDATE bonuses SET target = 'free' WHERE target = ?").run(String(id));
    db.prepare('DELETE FROM allocations WHERE goal_id = ?').run(String(id));
  }
}

export function resetAll(db) {
  db.exec('DELETE FROM settings');
  for (const t of Object.keys(TABLES)) db.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name = '${t}';`);
}

// Example plan so a new user can see the app working immediately.
export function loadSample(db, startMonth) {
  resetAll(db);
  const [y, m] = startMonth.split('-').map(Number);
  const ym = (dy, mm) => `${y + dy}-${String(mm).padStart(2, '0')}`;
  putSettings(db, { start_month: startMonth, horizon_months: 36, base_salary: 95000, opening_balance: 40000 });
  const ef = insertRow(db, 'goals', { name: 'Emergency fund', monthly_amount: 15000, target_amount: 300000, opening_balance: 60000, on_complete: 'divert', divert_to: 'free' });
  const bike = insertRow(db, 'goals', { name: 'Bike', monthly_amount: 6000, target_amount: 180000, on_complete: 'spend', divert_to: 'free' });
  const pc = insertRow(db, 'goals', { name: 'PC build', monthly_amount: 8000, target_amount: 150000, on_complete: 'spend', divert_to: String(bike.id) });
  updateRow(db, 'goals', ef.id, { divert_to: String(pc.id) });
  for (const e of [
    { name: 'Rent', category: 'Housing', amount: 22000 },
    { name: 'Groceries & food', category: 'Living', amount: 12000 },
    { name: 'Utilities & internet', category: 'Living', amount: 3500 },
    { name: 'Transport', category: 'Living', amount: 4000 },
    { name: 'Subscriptions', category: 'Fun', amount: 1200 },
    { name: 'Eating out & fun', category: 'Fun', amount: 6000 },
  ]) insertRow(db, 'expenses', e);
  insertRow(db, 'expenses', { name: 'Goa trip', category: 'Travel', amount: 35000, one_off: 1, start_month: ym(1, 2) });
  insertRow(db, 'loans', { name: 'Phone EMI', emi: 4500, start_month: startMonth, tenure_months: 9, divert_to: String(pc.id) });
  insertRow(db, 'allocations', { month: addMonths(startMonth, 2), goal_id: String(bike.id), amount: 20000, note: 'Extra from savings' });
  insertRow(db, 'expenses', { name: 'New headphones', category: 'Shopping', amount: 12000, one_off: 1, start_month: addMonths(startMonth, 4) });
  insertRow(db, 'raises', { month: ym(1, 4), type: 'percent', value: 30, note: 'Appraisal' });
  insertRow(db, 'raises', { month: ym(2, 4), type: 'percent', value: 12, note: 'Appraisal' });
  insertRow(db, 'bonuses', { month: ym(m > 10 ? 1 : 0, 10), amount: 50000, repeat_yearly: 1, target: String(ef.id), note: 'Diwali bonus' });
}
