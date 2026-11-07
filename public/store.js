// Browser-side data store. Replaces the old server + SQLite: all data lives on this device
// (localStorage), and `request()` mirrors the former HTTP API so app.js barely changes.
import { addMonths, currentMonth } from './projection.js';

const KEY = 'budget.v1';

// Editable columns per table, with the defaults the old SQL schema applied.
export const TABLES = {
  raises:   { month: null, type: 'percent', value: 0, note: null },
  bonuses:  { month: null, amount: 0, repeat_yearly: 0, target: 'free', note: null },
  expenses: { name: null, category: null, amount: 0, start_month: null, end_month: null, one_off: 0 },
  loans:    { name: null, emi: null, principal: null, annual_rate: null, start_month: null, tenure_months: 12, divert_to: 'free' },
  allocations: { month: null, goal_id: null, amount: 0, note: null },
  goals:    { name: null, color: null, monthly_amount: 0, target_amount: null, opening_balance: 0, start_month: null, on_complete: 'divert', divert_to: 'free' },
};
const NUMERIC = new Set(['value', 'amount', 'repeat_yearly', 'one_off', 'emi', 'principal', 'annual_rate', 'tenure_months', 'color', 'monthly_amount', 'target_amount', 'opening_balance']);
const SETTINGS_KEYS = ['start_month', 'horizon_months', 'base_salary', 'opening_balance'];

const empty = () => ({ settings: {}, seq: {}, tables: Object.fromEntries(Object.keys(TABLES).map((t) => [t, []])) });

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const base = empty();
      return { settings: d.settings || {}, seq: d.seq || {}, tables: { ...base.tables, ...(d.tables || {}) } };
    }
  } catch { /* corrupt or unavailable storage — start empty */ }
  return empty();
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(db)); // throws if storage is full/blocked → surfaced as "Not saved"
}

// Ask the browser not to evict our data under storage pressure (best effort).
export function requestPersistence() {
  try { return navigator.storage?.persist?.(); } catch { return undefined; }
}

const clean = (table, body) => {
  const out = {};
  for (const k of Object.keys(TABLES[table])) {
    if (!(k in body)) continue;
    let v = body[k];
    if (v === '' || v === undefined) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v !== null && NUMERIC.has(k)) { v = Number(v); if (Number.isNaN(v)) v = null; }
    out[k] = v;
  }
  return out;
};

const copy = (o) => ({ ...o });

function getState() {
  const settings = { ...db.settings };
  for (const k of ['horizon_months', 'base_salary', 'opening_balance']) if (settings[k] != null) settings[k] = Number(settings[k]);
  const state = { settings };
  for (const t of Object.keys(TABLES)) state[t] = db.tables[t].map(copy);
  return state;
}

function putSettings(body) {
  for (const k of SETTINGS_KEYS) if (k in body) db.settings[k] = body[k] === null || body[k] === '' ? null : String(body[k]);
}

function insertRow(table, body, keepId = false) {
  const data = clean(table, body);
  let id;
  if (keepId && body.id != null && Number.isInteger(Number(body.id))) id = Number(body.id);
  else id = (db.seq[table] || 0) + 1;
  db.seq[table] = Math.max(db.seq[table] || 0, id);
  if (table === 'goals' && data.color == null) {
    const used = new Set(db.tables.goals.map((r) => r.color));
    data.color = [1, 2, 3, 4, 5, 6, 7, 0].find((c) => !used.has(c)) ?? 0;
  }
  db.tables[table] = db.tables[table].filter((r) => r.id !== id); // replace on id clash, like a restored row
  const row = { id, ...TABLES[table], ...data };
  db.tables[table].push(row);
  db.tables[table].sort((a, b) => a.id - b.id);
  return copy(row);
}

function updateRow(table, id, body) {
  const row = db.tables[table].find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, clean(table, body));
  return copy(row);
}

function deleteRow(table, id) {
  db.tables[table] = db.tables[table].filter((r) => r.id !== id);
  // Anything pointing at a deleted goal falls back to free savings.
  if (table === 'goals') {
    const g = String(id);
    for (const r of db.tables.goals) if (r.divert_to === g) r.divert_to = 'free';
    for (const r of db.tables.loans) if (r.divert_to === g) r.divert_to = 'free';
    for (const r of db.tables.bonuses) if (r.target === g) r.target = 'free';
    db.tables.allocations = db.tables.allocations.filter((r) => r.goal_id !== g);
  }
}

function resetAll() {
  db = empty();
}

// Example plan so a new user can see the app working immediately.
function loadSample(startMonth) {
  resetAll();
  const [y, m] = startMonth.split('-').map(Number);
  const ym = (dy, mm) => `${y + dy}-${String(mm).padStart(2, '0')}`;
  putSettings({ start_month: startMonth, horizon_months: 36, base_salary: 95000, opening_balance: 40000 });
  const ef = insertRow('goals', { name: 'Emergency fund', monthly_amount: 15000, target_amount: 300000, opening_balance: 60000, on_complete: 'divert', divert_to: 'free' });
  const bike = insertRow('goals', { name: 'Bike', monthly_amount: 6000, target_amount: 180000, on_complete: 'spend', divert_to: 'free' });
  const pc = insertRow('goals', { name: 'PC build', monthly_amount: 8000, target_amount: 150000, on_complete: 'spend', divert_to: String(bike.id) });
  updateRow('goals', ef.id, { divert_to: String(pc.id) });
  for (const e of [
    { name: 'Rent', category: 'Housing', amount: 22000 },
    { name: 'Groceries & food', category: 'Living', amount: 12000 },
    { name: 'Utilities & internet', category: 'Living', amount: 3500 },
    { name: 'Transport', category: 'Living', amount: 4000 },
    { name: 'Subscriptions', category: 'Fun', amount: 1200 },
    { name: 'Eating out & fun', category: 'Fun', amount: 6000 },
  ]) insertRow('expenses', e);
  insertRow('expenses', { name: 'Goa trip', category: 'Travel', amount: 35000, one_off: 1, start_month: ym(1, 2) });
  insertRow('loans', { name: 'Phone EMI', emi: 4500, start_month: startMonth, tenure_months: 9, divert_to: String(pc.id) });
  insertRow('allocations', { month: addMonths(startMonth, 2), goal_id: String(bike.id), amount: 20000, note: 'Extra from savings' });
  insertRow('expenses', { name: 'New headphones', category: 'Shopping', amount: 12000, one_off: 1, start_month: addMonths(startMonth, 4) });
  insertRow('raises', { month: ym(1, 4), type: 'percent', value: 30, note: 'Appraisal' });
  insertRow('raises', { month: ym(2, 4), type: 'percent', value: 12, note: 'Appraisal' });
  insertRow('bonuses', { month: ym(m > 10 ? 1 : 0, 10), amount: 50000, repeat_yearly: 1, target: String(ef.id), note: 'Diwali bonus' });
}

// Same routes as the old HTTP API. Runs the mutation, then saves; if saving fails the
// in-memory change is rolled back so the UI's "Not saved" state is truthful.
export async function request(method, path, body) {
  const [table, id] = path.split('/');
  const snapshot = method === 'GET' ? null : JSON.stringify(db);
  try {
    const out = route(method, table, id, body);
    if (method !== 'GET') persist();
    return out;
  } catch (e) {
    if (snapshot) db = JSON.parse(snapshot);
    throw e;
  }
}

function route(method, table, id, body = {}) {
  if (table === 'state' && method === 'GET') return getState();
  if (table === 'settings' && method === 'PUT') { putSettings(body); return getState().settings; }
  if (table === 'reset' && method === 'POST') { resetAll(); return getState(); }
  if (table === 'sample' && method === 'POST') { loadSample(currentMonth()); return getState(); }
  if (table === 'import' && method === 'POST') {
    resetAll();
    putSettings(body.settings || {});
    // Preserve ids so divert/target references stay intact.
    for (const t of Object.keys(TABLES)) for (const row of body[t] || []) insertRow(t, row, true);
    return getState();
  }

  if (!Object.hasOwn(TABLES, table)) throw new Error('Unknown resource');
  const rowId = id === undefined ? null : Number(id);
  if (id !== undefined && !Number.isInteger(rowId)) throw new Error('Bad id');

  if (method === 'POST' && rowId === null) return insertRow(table, body, body.id != null); // id kept when restoring an undone delete
  if (method === 'PUT' && rowId !== null) {
    const row = updateRow(table, rowId, body);
    if (!row) throw new Error('Not found');
    return row;
  }
  if (method === 'DELETE' && rowId !== null) { deleteRow(table, rowId); return null; }
  throw new Error('Method not allowed');
}
