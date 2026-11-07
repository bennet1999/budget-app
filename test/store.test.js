import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getState, loadSample, insertRow, updateRow, deleteRow, putSettings } from '../db.js';

// Minimal localStorage so the browser store runs under Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { request } = await import('../public/store.js');
const { currentMonth } = await import('../public/projection.js');

test('sample plan matches the SQLite implementation', async () => {
  const db = openDb(':memory:');
  loadSample(db, currentMonth());
  assert.deepEqual(await request('POST', 'sample'), getState(db));
});

test('row CRUD, goal delete clean-up and import round-trip match SQLite', async () => {
  const db = openDb(':memory:');
  loadSample(db, currentMonth());
  await request('POST', 'sample');
  const a = await request('POST', 'expenses', { name: 'X', amount: '12.5', one_off: true });
  const b = insertRow(db, 'expenses', { name: 'X', amount: '12.5', one_off: true });
  assert.deepEqual(a, b);
  assert.deepEqual(await request('PUT', `expenses/${a.id}`, { amount: 99, end_month: '' }), updateRow(db, 'expenses', b.id, { amount: 99, end_month: '' }));
  const goalId = getState(db).goals[0].id;
  deleteRow(db, 'goals', goalId);
  assert.equal(await request('DELETE', `goals/${goalId}`), null);
  assert.deepEqual(await request('GET', 'state'), getState(db));
  // restoring an undone delete keeps its id, and persists across a "reload"
  const back = await request('POST', 'expenses', { ...a });
  assert.equal(back.id, a.id);
  const exported = await request('GET', 'state');
  const imported = await request('POST', 'import', exported);
  assert.deepEqual(imported, exported);
  assert.equal((await request('POST', 'expenses', { name: 'next' })).id, Math.max(...exported.expenses.map((r) => r.id)) + 1);
  assert.deepEqual(JSON.parse(mem.get('budget.v1')).tables.expenses.length, exported.expenses.length + 1);
});

test('settings and errors', async () => {
  await request('POST', 'reset');
  assert.deepEqual(await request('GET', 'state').then((s) => s.settings), {});
  const db = openDb(':memory:'); putSettings(db, { base_salary: 5, start_month: '2026-01' });
  assert.deepEqual(await request('PUT', 'settings', { base_salary: 5, start_month: '2026-01' }), getState(db).settings);
  await assert.rejects(request('POST', 'nope', {}), /Unknown resource/);
  await assert.rejects(request('PUT', 'expenses/9999', { name: 'z' }), /Not found/);
});
