import { project, currentMonth, addMonths, monthDiff, loanEmi, FREE } from './projection.js';
import { inr, inrCompact, pct, monthLabel, monthShort } from './format.js';
import { icon, EV } from './icons.js';
import { esc, toast, numInput, parseNum, fmtNum, monthButton, closeMonthPicker, kpiHtml } from './ui.js';
import { request as storeRequest, requestPersistence } from './store.js';
import { renderCalendar, renderMonth, renderMonthLive, onAllocInput, allocSummary } from './calendar.js';

// ---------------------------------------------------------------- state & api
let state = { settings: {}, raises: [], bonuses: [], expenses: [], loans: [], goals: [], allocations: [] };
let proj = null;
let view = null; // set by route()
let viewArg = null;
let pendingFocus = null;
const charts = {};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- save status: "✓ All changes saved" / "Saving…" / "Not saved — retry"
let pending = 0;
let failed = []; // writes that didn't reach storage; replayed by Retry
function paintStatus() {
  const el = $('#save-state');
  const st = failed.length ? 'error' : pending > 0 ? 'busy' : 'ok';
  el.className = `brand-sub status ${st}`;
  el.innerHTML = st === 'error'
    ? `${icon('alert', 12)} Not saved · <button type="button" class="link-btn" data-action="retry">Retry</button>`
    : st === 'busy' ? `<span class="spin" aria-hidden="true"></span> Saving…` : `${icon('check', 12)} All changes saved`;
}
const request = storeRequest; // data lives on this device (see store.js)
async function api(method, path, body) {
  if (method === 'GET') return request(method, path, body); // reads never show "Saving…"
  pending++;
  paintStatus();
  try {
    return await request(method, path, body);
  } catch (e) {
    failed.push({ method, path, body });
    toast('Couldn’t save — device storage may be full or blocked', { action: 'Retry', onAction: retryFailed, sticky: true });
    throw e;
  } finally {
    pending--;
    paintStatus();
  }
}
async function retryFailed() {
  const queue = failed;
  failed = [];
  paintStatus();
  for (const r of queue) {
    try { await api(r.method, r.path, r.body); } catch { return; } // re-queued by api()
  }
  setState(await request('GET', 'state')); // pick up ids for rows created during the outage
  toast('All changes saved');
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------------------------------------------------------------- colours
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const slot = (i) => css(`--s${i}`); // 1..8
// A goal's colour follows the goal (stored slot index), never its position.
const goalColor = (g) => (g && g.color >= 1 && g.color <= 7 ? slot(g.color + 1) : css('--muted'));
const FREE_COLOR = () => slot(1);
const alpha = (hex, a) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// ---------------------------------------------------------------- helpers
const startMonth = () => state.settings.start_month || currentMonth();
const goalName = (id) => {
  if (!id || id === FREE) return 'Free savings';
  const g = state.goals.find((x) => String(x.id) === String(id));
  return g ? g.name || 'Untitled goal' : 'Free savings';
};
const destOptions = (excludeId) => [
  { v: FREE, t: 'Free savings' },
  ...state.goals.filter((g) => String(g.id) !== String(excludeId)).map((g) => ({ v: String(g.id), t: g.name || 'Untitled goal' })),
];
const extendBtn = (ym) => ` <button type="button" class="link-btn" data-extend="${ym}">Extend projection</button>`;
const isEmpty = () => !Number(state.settings.base_salary) && !['expenses', 'goals', 'loans'].some((t) => state[t].length);
const inPlan = (ym) => proj && ym >= proj.start && ym <= proj.months.at(-1).month;
const focusMonth = () => (inPlan(currentMonth()) ? currentMonth() : proj?.start || currentMonth());

function recompute() { proj = project(state); }

const ctx = {
  get state() { return state; },
  get proj() { return proj; },
  api, slot, goalColor, FREE_COLOR, goalName, destOptions, isEmpty: () => isEmpty(),
};

// ---------------------------------------------------------------- plan: row schemas
const ROWS = {
  raises: {
    noun: 'Appraisal',
    fields: [
      { key: 'month', label: 'Effective from', type: 'month', placeholder: 'Choose month', clearable: false },
      { key: 'type', label: 'Kind', type: 'select', options: () => [{ v: 'percent', t: '% raise' }, { v: 'new_amount', t: 'New salary' }] },
      { key: 'value', label: (r) => (r.type === 'new_amount' ? 'New in-hand salary' : 'Raise %'), head: 'Raise or new salary', type: 'number', money: (r) => r.type === 'new_amount' },
      { key: 'note', label: 'Note', type: 'text', placeholder: 'Appraisal' },
    ],
    defaults: () => ({ month: addMonths(startMonth(), 12), type: 'percent', value: 10, note: 'Appraisal' }),
    hint: (r) => {
      const m = proj?.months.find((x) => x.month === r.month);
      if (!r.month) return 'Pick the month the new salary starts.';
      if (!m) return r.month < startMonth() ? 'Before your plan starts — assumed to be in your salary already.' : `After your projection ends (${monthLabel(proj.months.at(-1).month)}).${extendBtn(r.month)}`;
      return `Salary becomes <b>${inr(m.salary)}</b> from ${monthLabel(r.month)}`;
    },
  },
  bonuses: {
    noun: 'Extra income',
    fields: [
      { key: 'note', label: 'What', type: 'text', placeholder: 'Diwali bonus' },
      { key: 'month', label: 'Month', type: 'month', placeholder: 'Choose month', clearable: false },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '0', money: true },
      { key: 'target', label: 'Goes to', type: 'select', options: () => destOptions() },
      { key: 'repeat_yearly', label: 'Every year', type: 'check' },
    ],
    defaults: () => ({ note: 'Bonus', month: addMonths(startMonth(), 3), amount: null, target: FREE, repeat_yearly: 0 }),
    hint: (r) => {
      if (!r.month) return '';
      const hits = proj.months.filter((m) => m.bonusItems.some((b) => b.id === r.id)).map((m) => m.month);
      if (!hits.length) return r.month < startMonth() && !Number(r.repeat_yearly) ? 'Before your plan starts.' : `After your projection ends.${extendBtn(r.month)}`;
      return `Lands in ${hits.slice(0, 4).map((h) => `<a href="#month/${h}">${monthShort(h)}</a>`).join(', ')}${hits.length > 4 ? '…' : ''} → ${esc(goalName(r.target))}`;
    },
  },
  expenses: {
    noun: 'Expense',
    fields: [
      { key: 'name', label: 'Expense', type: 'text', placeholder: 'Rent' },
      { key: 'category', label: 'Category', type: 'text', placeholder: 'optional', list: 'cat-list' },
      { key: 'amount', label: 'Per month', type: 'number', placeholder: '0', money: true },
      { key: 'start_month', label: 'From', opt: true, type: 'month', placeholder: 'Plan start' },
      { key: 'end_month', label: 'Until', opt: true, type: 'month', placeholder: 'No end date' },
    ],
    defaults: () => ({ name: '', category: '', amount: null, one_off: 0 }),
    hint: (r) => {
      const amt = Number(r.amount) || 0;
      if (Number(r.one_off)) {
        return r.start_month ? `${inr(amt)} once, in <a href="#month/${r.start_month}">${monthLabel(r.start_month)}</a>` : 'Pick the month this is spent in.';
      }
      const from = r.start_month || startMonth();
      if (r.end_month && r.end_month < from) return `<span class="neg err">Ends (${monthLabel(r.end_month)}) before it starts (${monthLabel(from)})</span> — fix “Until”, or clear it with ✕ for no end date.`;
      const span = r.end_month ? `until ${monthLabel(r.end_month)} (${monthDiff(from, r.end_month) + 1} months)` : 'every month, no end date';
      return `${inr(amt)}/mo from ${monthLabel(from)}, ${span}`;
    },
  },
  loans: {
    noun: 'Loan',
    fields: [
      { key: 'name', label: 'Loan', type: 'text', placeholder: 'Bike loan' },
      { key: 'emi', label: 'EMI / month', type: 'number', money: true, placeholder: (r) => { const e = loanEmi({ ...r, emi: null }); return e ? `≈ ${fmtNum(Math.round(e))}` : '0'; } },
      { key: 'principal', label: 'Loan amount', opt: true, type: 'number', placeholder: '', money: true },
      { key: 'annual_rate', label: 'Interest % / yr', opt: true, type: 'number', placeholder: '' },
      { key: 'start_month', label: 'First EMI', type: 'month', placeholder: 'Choose month', clearable: false },
      { key: 'tenure_months', label: 'Number of EMIs', type: 'number' },
      { key: 'divert_to', label: 'When it ends, send EMI to', type: 'select', options: () => destOptions() },
    ],
    defaults: () => ({ name: '', start_month: startMonth(), tenure_months: 12, divert_to: FREE }),
    hint: (r) => {
      const emi = loanEmi(r);
      if (!emi || !r.start_month || !Number(r.tenure_months)) return 'Enter the EMI — or the loan amount and interest rate, and it’s calculated for you.';
      const last = addMonths(r.start_month, Number(r.tenure_months) - 1);
      const paid = Math.max(0, Math.min(Number(r.tenure_months), monthDiff(r.start_month, startMonth())));
      const left = Number(r.tenure_months) - paid;
      const total = emi * Number(r.tenure_months);
      const interest = Number(r.principal) ? total - Number(r.principal) : null;
      return `<b>${inr(emi)}</b>/mo · last EMI <b>${monthLabel(last)}</b> · ${left} EMI${left === 1 ? '' : 's'} left at plan start`
        + (interest !== null && interest > 0 ? ` · total interest ${inr(interest)}` : '')
        + ` · then ${inr(emi)}/mo → ${esc(goalName(r.divert_to))}`
        + (last > proj.months.at(-1).month ? ` · <span class="muted">ends after your projection.</span>${extendBtn(addMonths(last, 1))}` : '');
    },
  },
  goals: {
    noun: 'Goal',
    fields: [
      { key: 'name', label: 'Goal / fund', type: 'text', placeholder: 'e.g. Emergency fund', dot: true },
      { key: 'monthly_amount', label: 'Save / month', opt: true, type: 'number', placeholder: 'None', money: true },
      { key: 'target_amount', label: 'Target', opt: true, type: 'number', placeholder: 'No limit', money: true },
      { key: 'opening_balance', label: 'Saved so far', opt: true, type: 'number', placeholder: '0', money: true },
      { key: 'start_month', label: 'Start saving', opt: true, type: 'month', placeholder: 'Right away' },
      { key: 'on_complete', label: 'When reached', type: 'select', options: () => [{ v: 'divert', t: 'Keep it saved' }, { v: 'spend', t: 'Buy it (spend)' }], hidden: (r) => !Number(r.target_amount) },
      { key: 'divert_to', label: 'Then send its savings to', type: 'select', options: (r) => destOptions(r.id), hidden: (r) => !Number(r.target_amount) },
    ],
    defaults: () => ({ name: '', monthly_amount: null, target_amount: null, opening_balance: null, on_complete: 'divert', divert_to: FREE }),
    hint: (r) => {
      const s = proj?.goals.find((g) => g.id === String(r.id));
      if (!s) return '';
      const a = allocSummary(state, r.id);
      const extra = a.count ? ` · ${inr(a.total)} extra added in ${a.count} month${a.count === 1 ? '' : 's'} (Calendar)` : '';
      const fedBy = !Number(r.monthly_amount) && !a.count
        ? ' — <a href="#calendar">add money month by month from the Calendar</a>, or set a monthly amount'
        : '';
      if (!Number(r.target_amount)) {
        return `Open-ended — grows to <b>${inr(s.balance)}</b> by ${monthLabel(proj.months.at(-1)?.month)}${extra}${fedBy}`;
      }
      if (s.reachedMonth) {
        const n = monthDiff(startMonth(), s.reachedMonth) + 1;
        return `Reaches ${inr(r.target_amount)} in <a href="#month/${s.reachedMonth}"><b>${monthLabel(s.reachedMonth)}</b></a> (${n} month${n === 1 ? '' : 's'})`
          + (r.on_complete === 'spend' ? ' and gets spent' : '') + ` · then → ${esc(goalName(r.divert_to))}${extra}`;
      }
      const need = Number(r.target_amount) - (s.balance || 0);
      return `<span class="neg">Not reached within the projection</span> — ${inr(need)} short at the end${extra}${fedBy}${(Number(r.monthly_amount) > 0) ? extendBtn(addMonths(proj.months.at(-1).month, Math.min(120, Math.ceil(need / Number(r.monthly_amount))))) : ''}`;
    },
  },
};

function fieldHtml(table, row, f) {
  const v = row[f.key];
  const label = typeof f.label === 'function' ? f.label(row) : f.label;
  const opt = typeof f.opt === 'function' ? f.opt(row) : f.opt;
  const labelHtml = `<span class="lt">${esc(label)}${opt ? ' <em>optional</em>' : ''}</span>`;
  if (f.hidden && f.hidden(row)) return '<span class="cell-skip" aria-hidden="true"></span>';
  const attrs = `data-table="${table}" data-id="${row.id}" data-key="${f.key}"`;
  const ph = typeof f.placeholder === 'function' ? f.placeholder(row) : f.placeholder || '';
  if (f.type === 'check') {
    return `<label class="check"><input type="checkbox" ${attrs} ${Number(v) ? 'checked' : ''}/>${esc(label)}</label>`;
  }
  let input;
  if (f.type === 'select') {
    const opts = f.options(row);
    const cur = v == null || v === '' ? opts[0]?.v : String(v);
    input = `<select ${attrs}>${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === cur ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
  } else if (f.type === 'month') {
    input = monthButton(attrs, v, ph, f.clearable !== false, row.start_month || startMonth());
  } else if (f.type === 'number') {
    input = numInput(attrs, v, ph, typeof f.money === 'function' ? f.money(row) : !!f.money);
  } else {
    input = `<input type="text" ${attrs} ${f.list ? `list="${f.list}"` : ''} value="${esc(v ?? '')}" placeholder="${esc(ph)}" />`;
  }
  if (f.dot) {
    const g = state.goals.find((x) => x.id === row.id);
    return `<label>${labelHtml}<span class="name-wrap"><span class="dot" style="background:${goalColor(g)}"></span>${input}</span></label>`;
  }
  return `<label>${labelHtml}${input}</label>`;
}

const HEADED = new Set(['raises', 'bonuses', 'expenses']);
function headHtml(table) {
  const sample = ROWS[table].defaults();
  return `<div class="row-head row-${table}" aria-hidden="true">${ROWS[table].fields.map((f) => {
    if (f.type === 'check') return '<span></span>';
    const label = f.head || (typeof f.label === 'function' ? f.label(sample) : f.label);
    const opt = typeof f.opt === 'function' ? f.opt(sample) : f.opt;
    return `<span>${esc(label)}${opt ? ' <em>optional</em>' : ''}</span>`;
  }).join('')}<span></span></div>`;
}

function rowHtml(table, row) {
  const def = ROWS[table];
  const hint = def.hint ? `<div class="row-hint" data-hint="${table}:${row.id}">${def.hint(row)}</div>` : '';
  return `<div class="row row-${table}" data-row="${table}:${row.id}">
    ${def.fields.map((f) => fieldHtml(table, row, f)).join('')}
    <button class="del" data-del="${table}:${row.id}" title="Remove" aria-label="Remove ${def.noun.toLowerCase()}">${icon('x')}</button>
    ${hint}
  </div>`;
}

const EMPTY_TEXT = {
  raises: 'No appraisals yet — add one to see how a raise changes your savings.',
  bonuses: 'No extra income yet — add bonuses or other lump sums you expect.',
  expenses: 'No expenses yet — start with rent, food, bills…',
  loans: 'No loans or EMIs. Lucky you!',
  goals: 'No goals yet. Only a name is needed — everything else is optional.',
};

const SECTIONS = [
  ['income', 'Income'], ['raises', 'Appraisals'], ['bonuses', 'Extra income'], ['expenses', 'Expenses'], ['loans', 'Loans & EMIs'], ['goals', 'Goals'],
];

function renderPlan() {
  const s = state.settings;
  $('#settings-fields').innerHTML = `
    <label><span class="lt">In-hand salary / month</span>${numInput('data-setting="base_salary"', s.base_salary, 'e.g. 85,000', true)}</label>
    <label><span class="lt">Plan starts</span>${monthButton('data-setting="start_month"', s.start_month || currentMonth(), 'Choose month', false)}</label>
    <label><span class="lt">Free savings today <em>optional</em></span>${numInput('data-setting="opening_balance"', s.opening_balance, '0', true)}<small>Cash you’ve saved that isn’t in a goal</small></label>
    <label><span class="lt">Project for</span><select data-setting="horizon_months">${[12, 24, 36, 60, 120].map((n) => `<option value="${n}" ${Number(s.horizon_months || 36) === n ? 'selected' : ''}>${n / 12} year${n > 12 ? 's' : ''}</option>`).join('')}${![12, 24, 36, 60, 120].includes(Number(s.horizon_months || 36)) ? `<option value="${s.horizon_months}" selected>${s.horizon_months} months</option>` : ''}</select></label>`;

  for (const list of $$('[data-list]')) {
    const t = list.dataset.list;
    let rows = state[t];
    if (!rows.length) { list.innerHTML = `<div class="empty-rows">${EMPTY_TEXT[t]}</div>`; continue; }
    if (t === 'expenses') {
      // Regular costs are edited here; one-offs belong to a month and are edited on that month's page.
      const rec = rows.filter((e) => !Number(e.one_off));
      const one = rows.filter((e) => Number(e.one_off)).sort((a, b) => String(a.start_month).localeCompare(String(b.start_month)));
      list.classList.toggle('with-head', rec.length > 0);
      list.innerHTML = (rec.length ? headHtml(t) + rec.map((r) => rowHtml(t, r)).join('') : '<div class="empty-rows">No regular monthly expenses yet.</div>')
        + (one.length ? `<div class="sub-head">${icon('sparkles', 13)} One-off expenses · ${inr(one.reduce((a, e) => a + (Number(e.amount) || 0), 0))}
            <span class="muted">— edited on their month’s page</span></div>
            <div class="oneoff-list">${one.map((e) => `<a class="oneoff" href="#month/${e.start_month}"><span class="tag">${e.start_month ? monthShort(e.start_month) : 'No month'}</span><b>${esc(e.name || 'Expense')}</b><span class="amt">${inr(e.amount)}</span>${icon('right', 14)}</a>`).join('')}</div>` : '');
      continue;
    }
    if (t === 'raises') rows = [...rows].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    list.classList.toggle('with-head', HEADED.has(t));
    list.innerHTML = (HEADED.has(t) ? headHtml(t) : '') + rows.map((r) => rowHtml(t, r)).join('');
  }
  let dl = $('#cat-list');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'cat-list'; document.body.append(dl); }
  const cats = new Set(['Housing', 'Food', 'Bills', 'Transport', 'Family', 'Health', 'Insurance', 'Fun', 'Shopping', 'Travel', ...state.expenses.map((e) => e.category).filter(Boolean)]);
  dl.innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join('');

  $('#plan-nav').innerHTML = SECTIONS.map(([k, label]) => {
    const n = k === 'income' ? '' : state[k].length;
    return `<button type="button" data-scroll="${k}">${label}${n ? `<span>${n}</span>` : ''}</button>`;
  }).join('');
  renderPlanLive();
}

// Cheap updates while typing (inputs are not re-rendered, so focus is kept).
function renderPlanLive() {
  for (const el of $$('[data-hint]')) {
    const [t, id] = el.dataset.hint.split(':');
    const row = state[t].find((r) => String(r.id) === id);
    if (row) el.innerHTML = ROWS[t].hint(row);
  }
  const monthly = state.expenses.filter((e) => !Number(e.one_off)).reduce((a, e) => a + (Number(e.amount) || 0), 0);
  $('#exp-total').innerHTML = monthly ? `Regular total: <b>${inr(monthly)}</b>/mo.` : '';
  for (const el of $$('.row-hint .err')) el.closest('.row')?.classList.add('has-error');
  renderSummary();
}

function renderSummary() {
  const m = proj?.months.find((x) => x.month === focusMonth()) || proj?.months[0];
  const el = $('#plan-summary');
  if (!m) { el.innerHTML = ''; return; }
  const parts = [
    { k: 'Expenses', v: m.expenses, c: slot(2) },
    { k: 'EMIs', v: m.emi, c: slot(3) },
    { k: 'To goals', v: m.toGoals, c: slot(4) },
    { k: 'Left over', v: Math.max(0, m.freeFlow), c: slot(1) },
  ];
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  const later = proj.months[Math.min(11, proj.months.length - 1)];
  el.innerHTML = `
    <h2>${monthLabel(m.month)} at a glance</h2>
    <div class="sum-month">${m.month === currentMonth() ? 'This month' : 'First month of your plan'} · <a href="#month/${m.month}">open month</a></div>
    <div class="sum-line"><span>In-hand income</span><span>${inr(m.income)}</span></div>
    ${parts.slice(0, 3).filter((p, i) => i === 0 || p.v).map((p) => `<div class="sum-line"><span><i class="dot" style="background:${p.c}"></i>${p.k}</span><span>− ${inr(p.v)}</span></div>`).join('')}
    <div class="sum-line total ${m.freeFlow < 0 ? 'neg' : 'pos'}"><span>Left over</span><span>${inr(m.freeFlow)}</span></div>
    <div class="sum-bar" role="img" aria-label="Share of income">${parts.filter((p) => p.v > 0).map((p) => `<span title="${p.k}: ${inr(p.v)}" style="width:${(p.v / total) * 100}%;background:${p.c}"></span>`).join('')}</div>
    <div class="sum-line"><span>Savings rate</span><span>${pct(m.savingsRate)}</span></div>
    <div class="sum-line"><span>Total saved by ${monthShort(later.month)}</span><span>${inr(later.totalSaved)}</span></div>`;
}

// ---------------------------------------------------------------- editing (Plan + Month pages)
const saveRow = (() => {
  const timers = new Map();
  return (table, id, patch) => {
    const key = `${table}:${id}`;
    const prev = timers.get(key) || { patch: {} };
    clearTimeout(prev.t);
    const merged = { ...prev.patch, ...patch };
    timers.set(key, { patch: merged, t: setTimeout(() => { timers.delete(key); api('PUT', `${table}/${id}`, merged).catch(() => {}); }, 400) });
  };
})();
const saveSettings = debounce(() => api('PUT', 'settings', state.settings).catch(() => {}), 400); // failures are queued for Retry by api()
const liveUpdate = debounce(() => { recompute(); renderLive(); }, 120);

function renderLive() {
  if (view === 'plan') renderPlanLive();
  else if (view === 'month') renderMonthLive(ctx, viewArg);
}

function readInput(el) {
  if (el.classList.contains('mp')) return el.dataset.month || null;
  if (el.type === 'checkbox') return el.checked ? 1 : 0;
  if ('num' in el.dataset) return parseNum(el.value);
  return el.value === '' ? null : el.value;
}

function onFieldInput(e) {
  const el = e.target;
  if (el.dataset.alloc) { onAllocInput(ctx, el); liveUpdate(); return; }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    const v = readInput(el);
    state.settings[k] = k === 'horizon_months' ? Number(v) : v;
    saveSettings();
    if (e.type === 'change' && (k === 'start_month' || k === 'horizon_months')) { recompute(); renderCurrentKeepFocus(); } else liveUpdate();
    return;
  }
  const { table, id, key } = el.dataset;
  if (!table || !key) return;
  const row = state[table].find((r) => String(r.id) === id);
  if (!row) return;
  row[key] = readInput(el);
  saveRow(table, id, { [key]: row[key] });
  // Structural edits change labels, hidden fields, or names shown in dropdowns → re-render.
  const structural = e.type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.classList.contains('mp')
    || (table === 'goals' && (key === 'name' || key === 'target_amount')));
  if (structural) { recompute(); renderCurrentKeepFocus(); } else liveUpdate();
}

function renderCurrentKeepFocus() {
  const a = document.activeElement;
  let sel = null;
  if (a?.dataset?.key) sel = `[data-table="${a.dataset.table}"][data-id="${a.dataset.id}"][data-key="${a.dataset.key}"]`;
  else if (a?.dataset?.setting) sel = `[data-setting="${a.dataset.setting}"]`;
  renderCurrent();
  if (sel) $(sel)?.focus();
}

async function addRow(table, extra = {}) {
  const row = await api('POST', table, { ...ROWS[table].defaults(), ...extra });
  state[table].push(row);
  recompute();
  renderCurrent();
  const first = $(`[data-row="${table}:${row.id}"] input, [data-row="${table}:${row.id}"] select`);
  first?.focus();
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function deleteRow(table, id) {
  const row = state[table].find((r) => String(r.id) === String(id));
  if (!row) return;
  const snapshot = { ...row };
  const restore = [];
  let allocs = [];
  await api('DELETE', `${table}/${id}`);
  state[table] = state[table].filter((r) => r !== row);
  if (table === 'goals') {
    // mirror the server-side clean-up, remembering what to put back on undo
    for (const [t, k] of [['goals', 'divert_to'], ['loans', 'divert_to'], ['bonuses', 'target']]) {
      for (const r of state[t]) if (String(r[k]) === String(id)) { restore.push([t, r.id, k]); r[k] = FREE; }
    }
    allocs = state.allocations.filter((a) => String(a.goal_id) === String(id));
    state.allocations = state.allocations.filter((a) => !allocs.includes(a));
  }
  recompute();
  renderCurrent();
  const name = snapshot.name || snapshot.note || ROWS[table]?.noun || 'Item';
  toast(`${name} removed`, {
    action: 'Undo',
    onAction: async () => {
      const back = await api('POST', table, snapshot);
      state[table].push(back);
      state[table].sort((a, b) => a.id - b.id);
      for (const [t, rid, k] of restore) {
        const r = state[t].find((x) => x.id === rid);
        if (r) { r[k] = String(back.id); await api('PUT', `${t}/${rid}`, { [k]: r[k] }); }
      }
      for (const a of allocs) state.allocations.push(await api('POST', 'allocations', { ...a }));
      recompute();
      renderCurrent();
    },
  });
}

// ---------------------------------------------------------------- dashboard
function renderDashboard() {
  const empty = isEmpty();
  $('#empty-state').hidden = !empty;
  $('#dash').hidden = empty;
  if (empty) return;

  const ms = proj.months;
  const fm = focusMonth();
  const m0 = ms.find((m) => m.month === fm) || ms[0];
  const last = ms.at(-1);
  const at12 = ms[Math.min(11, ms.length - 1)];
  const openingTotal = Number(state.settings.opening_balance || 0) + state.goals.reduce((a, g) => a + Number(g.opening_balance || 0), 0);
  const spent = proj.goals.reduce((a, g) => a + (g.spent || 0), 0);

  $('#dash-sub').textContent = `${monthLabel(proj.start)} → ${monthLabel(last.month)} · ${ms.length} months projected`;
  $('#dash-month-link').href = `#month/${m0.month}`;
  $('#dash-month-link').innerHTML = `${icon('calendar', 15)} Open ${monthShort(m0.month)} <span class="btn-ico">${icon('arrowRight', 14)}</span>`;
  for (const b of $$('#horizon-seg button')) b.classList.toggle('on', Number(b.dataset.h) === proj.horizon);

  const later = ms.find((m) => m.month > m0.month && m.salary !== m0.salary);
  $('#kpis').innerHTML = [
    {
      label: `Left over in ${monthShort(m0.month)}`,
      value: inr(m0.freeFlow),
      note: `after ${inr(m0.expenses + m0.emi)} spending &amp; ${inr(m0.toGoals)} to goals · goes to free savings`,
      href: `#month/${m0.month}`,
      neg: m0.freeFlow < -0.5,
      icon: 'coins', tone: 'violet', featured: true,
    },
    {
      label: 'Savings rate',
      value: pct(m0.savingsRate),
      note: later ? `${pct(later.savingsRate)} after your raise in ${monthShort(later.month)}` : `of ${inr(m0.income)} in-hand`,
      icon: 'percent', tone: 'pink',
    },
    at12 !== last ? {
      label: `Total saved by ${monthShort(at12.month)}`,
      value: inr(at12.totalSaved),
      note: `<span class="${at12.totalSaved >= openingTotal ? 'up' : 'down'}">${at12.totalSaved >= openingTotal ? '+' : ''}${inr(at12.totalSaved - openingTotal)}</span> vs today`,
      icon: 'trend', tone: 'yellow',
    } : { ...nextMilestone(m0.month), icon: 'flag', tone: 'yellow' },
    {
      label: `Total saved by ${monthShort(last.month)}`,
      value: inr(last.totalSaved),
      note: spent > 0 ? `plus ${inr(spent)} spent on goals you bought` : 'across all funds + free savings',
      icon: 'piggy', tone: 'mint',
    },
  ].map(kpiHtml).join('');

  const shortMonths = ms.filter((m) => m.freeFlow < -0.5);
  const negBal = ms.find((m) => m.freeBalance < -0.5);
  let alerts = '';
  if (negBal) {
    alerts = `<div class="alert">${icon('alert', 18)}<div><b>Free savings run out in <a href="#month/${negBal.month}">${monthLabel(negBal.month)}</a>.</b> Your expenses, EMIs and goal savings add up to more than you earn. Lower a goal’s monthly amount or an expense.</div></div>`;
  } else if (shortMonths.length) {
    alerts = `<div class="alert warn">${icon('alert', 18)}<div><b>${shortMonths.length} month${shortMonths.length > 1 ? 's' : ''} spend more than you earn</b> (first: <a href="#month/${shortMonths[0].month}">${monthLabel(shortMonths[0].month)}</a>). Your free savings cover it, but keep an eye on it.</div></div>`;
  }
  $('#alerts').innerHTML = alerts;

  renderCharts();
  renderGoalCards();
  renderTimeline();
}

function nextMilestone(from) {
  const e = proj.events.find((x) => x.month >= from && ['goal_reached', 'goal_spent', 'loan_closed', 'raise'].includes(x.type)
    && !(x.type === 'goal_reached' && proj.events.some((y) => y.type === 'goal_spent' && y.goalId === x.goalId && y.month === x.month)));
  if (!e) return { label: 'Next milestone', value: '—', note: 'Add a goal target, loan or appraisal' };
  const n = monthDiff(from, e.month);
  const what = { goal_reached: e.text, goal_spent: e.text.replace(/ purchased$/, ' bought'), loan_closed: e.text.replace(/ — last EMI paid$/, ' paid off'), raise: 'Salary raise' }[e.type];
  return { label: 'Next milestone', value: monthShort(e.month), note: `${esc(what)} · ${n <= 0 ? 'this month' : `in ${n} month${n === 1 ? '' : 's'}`}`, href: `#month/${e.month}` };
}

function chartDefaults(ms) {
  const ink2 = css('--ink-2');
  Chart.defaults.font.family = css('--font');
  Chart.defaults.font.weight = '500';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    onClick: (_e, _els, chart) => {
      const i = chart.tooltip?.dataPoints?.[0]?.dataIndex;
      if (i != null) location.hash = `month/${ms[i].month}`;
    },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, color: ink2 } },
      tooltip: {
        backgroundColor: css('--card'),
        titleColor: css('--ink'),
        bodyColor: ink2,
        footerColor: css('--ink'),
        borderColor: css('--line'),
        borderWidth: 2,
        cornerRadius: 12,
        padding: 12,
        boxPadding: 4,
        titleFont: { family: css('--font-head'), weight: '700', size: 13 },
        usePointStyle: true,
        callbacks: {
          title: (c) => monthLabel(ms[c[0].dataIndex].month),
          label: (c) => ` ${c.dataset.label}: ${inr(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
      y: { stacked: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => inrCompact(v), maxTicksLimit: 6 } },
    },
  };
}

function withFooter(base, footer) {
  return { ...base, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { ...base.plugins.tooltip.callbacks, footer } } } };
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const ms = proj.months;
  const labels = ms.map((m) => monthShort(m.month));
  const surface = css('--card');

  // Goals are stacked areas (never below zero); free savings is its own line so a negative
  // balance reads as "below zero" instead of dragging the goal bands down with it.
  // At most 5 goals get their own band — the rest fold into "Other goals".
  const MAX_GOALS = 5;
  const goalSeries = state.goals.map((g) => ({ g, data: ms.map((m) => Math.round(m.balances[String(g.id)] || 0)) }))
    .filter((x) => x.data.some((v) => v > 0));
  const ranked = [...goalSeries].sort((a, b) => Math.max(...b.data) - Math.max(...a.data));
  const shown = new Set(ranked.slice(0, ranked.length > MAX_GOALS ? MAX_GOALS - 1 : MAX_GOALS).map((x) => x.g.id));
  const series = goalSeries.filter((x) => shown.has(x.g.id)).map((x) => ({ label: x.g.name || 'Untitled goal', color: goalColor(x.g), data: x.data }));
  const rest = goalSeries.filter((x) => !shown.has(x.g.id));
  if (rest.length) series.push({ label: `Other goals (${rest.length})`, color: css('--muted'), data: ms.map((_, i) => rest.reduce((a, x) => a + x.data[i], 0)) });
  const area = (s, i) => ({
    label: s.label, data: s.data, stack: 'goals', order: 2,
    borderColor: s.color, backgroundColor: alpha(s.color, 0.45), borderWidth: 2,
    pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2, pointBackgroundColor: s.color,
    tension: 0.25, fill: i === 0 ? 'origin' : '-1',
  });
  const freeLine = {
    label: 'Free savings', data: ms.map((m) => Math.round(m.freeBalance)), stack: 'free', order: 1,
    borderColor: FREE_COLOR(), backgroundColor: FREE_COLOR(), borderWidth: 3.5, fill: false,
    pointRadius: 0, pointHoverRadius: 6, pointHoverBorderColor: surface, pointHoverBorderWidth: 2, pointBackgroundColor: FREE_COLOR(),
    tension: 0.25,
  };
  charts.balances?.destroy();
  charts.balances = new Chart($('#chart-balances'), {
    type: 'line',
    data: { labels, datasets: [...series.map(area), freeLine] },
    options: withFooter(chartDefaults(ms), (c) => `Total saved: ${inr(ms[c[0].dataIndex].totalSaved)}`),
  });

  const flow = [
    { label: 'Expenses', color: slot(2), data: ms.map((m) => Math.round(m.expenses)) },
    { label: 'EMIs', color: slot(3), data: ms.map((m) => Math.round(m.emi)) },
    { label: 'To goals', color: slot(4), data: ms.map((m) => Math.round(m.toGoals)) },
    { label: 'Left over', color: slot(1), data: ms.map((m) => Math.round(m.freeFlow)) },
  ].filter((s) => s.data.some((v) => v !== 0));
  const base2 = withFooter(chartDefaults(ms), (c) => `In-hand income: ${inr(ms[c[0].dataIndex].income)}`);
  charts.flow?.destroy();
  charts.flow = new Chart($('#chart-flow'), {
    type: 'bar',
    data: {
      labels,
      datasets: flow.map((s) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color,
        hoverBackgroundColor: s.color,
        borderColor: surface,
        borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
        borderSkipped: false,
        borderRadius: 4,
        categoryPercentage: 0.82,
        barPercentage: 0.92,
      })),
    },
    options: { ...base2, scales: { ...base2.scales, x: { ...base2.scales.x, stacked: true } } },
  });
}

function renderGoalCards() {
  const el = $('#goal-cards');
  if (!state.goals.length) {
    el.innerHTML = `<div class="card goal-card"><p class="muted">No goals yet. Add an emergency fund, a PC build, a bike — anything you’re saving for.</p><a class="btn" href="#plan" data-focus="goals">${icon('plus', 14)} Add a goal</a></div>`;
    return;
  }
  const fm = focusMonth();
  const mNow = proj.months.find((m) => m.month === fm) || proj.months[0];
  el.innerHTML = state.goals.map((g) => {
    const id = String(g.id);
    const s = proj.goals.find((x) => x.id === id);
    const color = goalColor(g);
    const target = Number(g.target_amount) || 0;
    const nowBal = mNow.balances[id] ?? 0;
    const maxRegular = Math.max(0, ...proj.months.map((m) => (m.contributions[id] || 0) - (m.lumpContributions[id] || 0)));
    const monthly = Number(g.monthly_amount) || 0;
    const a = allocSummary(state, id);
    let chip;
    let body;
    if (!target) {
      chip = '<span class="chip">Open-ended</span>';
      body = `<div class="goal-amt"><span class="big">${inr(s.balance)}</span><span class="muted">by ${monthShort(proj.months.at(-1).month)}</span></div>
        <div class="goal-meta"><span>${inr(nowBal)} saved by ${monthShort(mNow.month)}</span></div>`;
    } else {
      const reached = s.reachedMonth;
      const n = reached ? monthDiff(fm, reached) : null;
      chip = reached
        ? `<a class="chip ${g.on_complete === 'spend' ? 'info' : 'good'}" href="#month/${reached}">${icon(g.on_complete === 'spend' ? 'bag' : 'check', 12)} ${g.on_complete === 'spend' ? 'Buy' : 'Reached'} ${monthShort(reached)}</a>`
        : '<span class="chip bad">Not reached</span>';
      const shown = g.on_complete === 'spend' && reached && reached <= mNow.month ? target : Math.min(nowBal, target);
      const progress = Math.min(1, shown / target);
      const eta = reached
        ? (n <= 0 ? (g.on_complete === 'spend' ? 'Bought' : 'Done') : `${n} month${n === 1 ? '' : 's'} to go`)
        : `${inr(target - s.balance)} short by ${monthShort(proj.months.at(-1).month)}`;
      body = `<div class="goal-amt"><span class="big">${inr(shown)}</span><span class="muted">of ${inr(target)}</span></div>
        <div class="bar striped" role="img" aria-label="${Math.round(progress * 100)}% saved by ${monthLabel(mNow.month)}"><span style="width:${progress * 100}%;background:${color}"></span></div>
        <div class="goal-meta"><span>Saved by ${monthShort(mNow.month)}</span><span>${eta}</span></div>`;
    }
    const flowBits = [];
    if (monthly) flowBits.push(`${inr(monthly)}/mo`);
    if (maxRegular > monthly + 0.5) flowBits.push(`up to ${inr(maxRegular)}/mo with diverted money`);
    if (a.count) flowBits.push(`${inr(a.total)} extra in ${a.count} month${a.count === 1 ? '' : 's'}`);
    if (!flowBits.length) flowBits.push('<a href="#calendar">Add money from the Calendar</a>');
    const after = target ? ` · then → ${esc(goalName(g.divert_to))}` : '';
    return `<article class="card goal-card" style="--gc:${color}">
      <div class="goal-top"><span class="goal-ico">${icon(target ? 'target' : 'piggy', 16)}</span><div class="goal-title"><h3 title="${esc(g.name || 'Untitled goal')}">${esc(g.name || 'Untitled goal')}</h3>${chip}</div></div>
      <div class="goal-body">
        ${body}
        <div class="goal-flow">${flowBits.join(' · ')}${after}</div>
      </div>
    </article>`;
  }).join('');
}

function eventText(e) {
  switch (e.type) {
    case 'raise': return `<b>${esc(e.text)}</b><span class="muted">${inr(e.from)} → ${inr(e.to)}</span>`;
    case 'bonus': return `<b>${esc(e.text)}</b><span class="muted">${inr(e.amount)}</span>`;
    case 'goal_reached': return `<b>${esc(e.text)}</b><span class="muted">${inr(e.amount)} saved</span>`;
    case 'goal_spent': return `<b>${esc(e.text)}</b><span class="muted">${inr(e.amount)} spent</span>`;
    case 'loan_closed': return `<b>${esc(e.text)}</b><span class="muted">frees up ${inr(e.amount)}/mo</span>`;
    default: return `<b>${esc(e.text)}</b>`;
  }
}

function renderTimeline() {
  const items = [];
  let run = null;
  for (const e of proj.events) {
    if (e.type === 'shortfall') {
      if (run && monthDiff(run.end, e.month) === 1) { run.end = e.month; run.count++; continue; }
      run = { type: 'shortfall', month: e.month, end: e.month, count: 1 };
      items.push(run);
      continue;
    }
    if (e.type === 'goal_reached' && proj.events.some((x) => x.type === 'goal_spent' && x.goalId === e.goalId && x.month === e.month)) continue;
    items.push(e);
  }
  for (const m of proj.months) {
    const extra = m.expenseItems.filter((x) => x.oneOff);
    if (extra.length) items.push({ type: 'extra', month: m.month, text: extra.length === 1 ? extra[0].name || 'Extra expense' : `${extra.length} extra expenses`, amount: extra.reduce((a, x) => a + x.amount, 0) });
  }
  items.sort((a, b) => a.month.localeCompare(b.month));
  $('#timeline').innerHTML = items.length
    ? items.map((e) => {
      const ev = e.type === 'extra' ? { icon: 'receipt', cls: 'warn' } : EV[e.type];
      let text;
      if (e.type === 'shortfall') text = `<b>Spending is more than income</b><span class="muted">${e.count > 1 ? `${e.count} months, until ${monthLabel(e.end)}` : 'this month'}</span>`;
      else if (e.type === 'extra') text = `<b>${esc(e.text)}</b><span class="muted">${inr(e.amount)}</span>`;
      else text = eventText(e);
      return `<li><a href="#month/${e.month}"><span class="when">${monthLabel(e.month)}</span><span class="ico ${ev.cls}">${icon(ev.icon, 15)}</span><span class="what">${text}</span>${icon('right', 14, 'go')}</a></li>`;
    }).join('')
    : '<li class="empty-line">Nothing notable yet — add appraisals, bonuses, loans or goals with targets.</li>';
}

// ---------------------------------------------------------------- months table
const openMonths = new Set();
function renderTable() {
  const t = $('#months-table');
  if (!proj || isEmpty()) { t.innerHTML = '<tbody><tr><td class="muted" style="padding:24px">Add your salary and expenses in the Plan tab to see the month-by-month breakdown.</td></tr></tbody>'; return; }
  const hasEmi = proj.months.some((m) => m.emi > 0);
  const cols = hasEmi ? 8 : 7;
  const head = `<thead><tr><th>Month</th><th>Income</th><th>Expenses</th>${hasEmi ? '<th>EMIs</th>' : ''}<th>To goals</th><th>Left over</th><th>Free savings</th><th>Total saved</th></tr></thead>`;
  const now = currentMonth();
  const rows = proj.months.map((m, i) => {
    const types = [...new Set(m.events.map((e) => e.type))];
    const chips = types.map((ty) => `<span class="ico sm ${EV[ty].cls}" title="${esc(EV[ty].label)}">${icon(EV[ty].icon, 12)}</span>`).join('')
      + (m.expenseItems.some((x) => x.oneOff) ? `<span class="ico sm warn" title="Extra expense">${icon('receipt', 12)}</span>` : '')
      + (m.allocItems.length ? `<span class="ico sm good" title="Extra to goals">${icon('piggy', 12)}</span>` : '');
    const open = openMonths.has(m.month);
    const main = `<tr class="m ${open ? 'open' : ''} ${i > 0 && m.month.endsWith('-01') ? 'year-start' : ''} ${m.month === now ? 'is-now' : ''}" data-month="${m.month}" tabindex="0" aria-expanded="${open}">
      <td><span class="mcell"><span class="caret">${icon('right', 12)}</span>${monthLabel(m.month)}<span class="chips">${chips}</span></span></td>
      <td>${inr(m.income)}</td><td>${inr(m.expenses)}</td>${hasEmi ? `<td>${m.emi ? inr(m.emi) : '—'}</td>` : ''}
      <td>${inr(m.toGoals)}</td><td class="${m.freeFlow < 0 ? 'neg' : ''}">${inr(m.freeFlow)}</td>
      <td class="${m.freeBalance < 0 ? 'neg' : ''}">${inr(m.freeBalance)}</td><td><b>${inr(m.totalSaved)}</b></td></tr>`;
    return main + (open ? detailRow(m, cols) : '');
  }).join('');
  t.innerHTML = head + `<tbody>${rows}</tbody>`;
}

function detailRow(m, cols) {
  const dl = (k, v, color) => `<div class="dl"><span>${color ? `<i class="dot" style="background:${color}"></i>` : ''}${k}</span><span>${v}</span></div>`;
  const goals = state.goals.map((g) => dl(esc(g.name || 'Untitled goal'), `${m.contributions[String(g.id)] ? '+' + inr(m.contributions[String(g.id)]) + ' → ' : ''}${inr(m.balances[String(g.id)] || 0)}`, goalColor(g))).join('') || '<div class="muted">No goals</div>';
  return `<tr class="detail"><td colspan="${cols}"><div class="detail-grid">
    <div><h4>Income</h4>${dl('Salary', inr(m.salary))}${m.bonusItems.map((b) => dl(esc(b.name), inr(b.amount))).join('')}${dl('<b>Total</b>', `<b>${inr(m.income)}</b>`)}</div>
    <div><h4>Spending</h4>${m.expenseItems.map((e) => dl(`${esc(e.name || 'Expense')}${e.oneOff ? ' <span class="muted">· one-off</span>' : ''}`, inr(e.amount))).join('') || '<div class="muted">No expenses</div>'}
      ${m.loanItems.map((l) => dl(`${esc(l.name || 'Loan')} <span class="muted">· ${inr(l.outstanding)} left</span>`, inr(l.emi))).join('')}</div>
    <div><h4>Goals: added → balance</h4>${goals}${dl('Free savings', `${m.freeFlow >= 0 ? '+' : ''}${inr(m.freeFlow)} → ${inr(m.freeBalance)}`, FREE_COLOR())}</div>
    <div>${m.events.length ? `<h4>Events</h4>${m.events.map((e) => `<div class="dl"><span>${icon(EV[e.type].icon, 13)} ${esc(e.text)}</span></div>`).join('')}` : ''}
      <a class="btn sm" href="#month/${m.month}">Open ${monthShort(m.month)} ${icon('arrowRight', 14)}</a></div>
  </div></td></tr>`;
}

// ---------------------------------------------------------------- routing
const PANELS = { dashboard: 'tab-dashboard', plan: 'tab-plan', calendar: 'tab-calendar', month: 'tab-month', table: 'tab-table' };

function route() {
  closeMonthPicker();
  const [v, arg] = (location.hash.slice(1) || 'dashboard').split('/');
  const prevView = view;
  const prevArg = viewArg;
  view = PANELS[v] ? v : v === 'months' ? 'table' : 'dashboard';
  viewArg = arg || null;
  if (view === 'month' && !/^\d{4}-\d{2}$/.test(viewArg || '')) { view = 'calendar'; viewArg = null; }
  const tabName = view === 'month' ? 'calendar' : view;
  for (const b of $$('.tabs a')) b.setAttribute('aria-current', b.dataset.tab === tabName ? 'page' : 'false');
  for (const [k, id] of Object.entries(PANELS)) $(`#${id}`).hidden = k !== view;
  renderCurrent();
  if (prevView !== view || prevArg !== viewArg) {
    const panel = $(`#${PANELS[view]}`);
    panel.classList.remove('entering');
    void panel.offsetWidth; // restart the pop-in animation
    panel.classList.add('entering');
    clearTimeout(route.t);
    route.t = setTimeout(() => panel.classList.remove('entering'), 900);
  }
  if (pendingFocus) {
    const target = $(`#sec-${pendingFocus}`);
    pendingFocus = null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (prevView !== view || prevArg !== viewArg) {
    window.scrollTo({ top: 0 });
  }
}

function renderCurrent() {
  if (!proj || !view) return;
  if (view === 'dashboard') renderDashboard();
  else if (view === 'plan') renderPlan();
  else if (view === 'calendar') renderCalendar(ctx, viewArg);
  else if (view === 'month') renderMonth(ctx, viewArg);
  else renderTable();
}

function setState(s) {
  state = { allocations: [], ...s };
  recompute();
  renderCurrent();
}

async function action(name) {
  $('#menu-list').hidden = true;
  if (name === 'retry') return retryFailed();
  if (name === 'reload') return load();
  if (name === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `budget-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (name === 'import') {
    $('#import-file').click();
  } else if (name === 'sample') {
    if (!isEmpty() && !confirm('Replace your current plan with the example plan? Export a backup first if you want to keep it.')) return;
    setState(await api('POST', 'sample'));
    toast('Example plan loaded');
  } else if (name === 'reset') {
    if (!confirm('Delete everything in your plan? This can’t be undone — export a backup first if unsure.')) return;
    setState(await api('POST', 'reset'));
    toast('Plan cleared');
  }
}

function themeIsDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function paintThemeButton() {
  const dark = themeIsDark();
  $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon', 18);
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  $('#theme-toggle').title = dark ? 'Light mode' : 'Dark mode';
}

function wire() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-focus]');
    if (link) pendingFocus = link.dataset.focus;
    const act = e.target.closest('[data-action]');
    if (act) return action(act.dataset.action);
    const add = e.target.closest('[data-add]');
    if (add) return addRow(add.dataset.add, add.dataset.defaults ? JSON.parse(add.dataset.defaults) : {});
    const del = e.target.closest('[data-del]');
    if (del) { const [t, id] = del.dataset.del.split(':'); return deleteRow(t, id); }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) return $(`#sec-${scroll.dataset.scroll}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ext = e.target.closest('[data-extend]');
    if (ext) {
      const need = monthDiff(proj.start, ext.dataset.extend) + 1;
      state.settings.horizon_months = Math.min(600, Math.max(proj.horizon, Math.ceil(need / 12) * 12));
      api('PUT', 'settings', state.settings).catch(() => {});
      recompute();
      return renderCurrent();
    }
    const mrow = e.target.closest('tr.m');
    if (mrow) return toggleMonthRow(mrow.dataset.month);
    if (!e.target.closest('.menu')) $('#menu-list').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    const mrow = e.target.closest?.('tr.m');
    if (mrow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleMonthRow(mrow.dataset.month); }
    if (e.key === 'Escape') $('#menu-list').hidden = true;
  });
  $('#menu-btn').addEventListener('click', () => {
    const l = $('#menu-list');
    l.hidden = !l.hidden;
    $('#menu-btn').setAttribute('aria-expanded', String(!l.hidden));
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm('Replace your current plan with this backup?')) return;
      setState(await api('POST', 'import', data));
      toast('Backup imported');
    } catch (err) { toast(`Import failed: ${err.message}`); }
  });
  for (const id of ['#tab-plan', '#tab-month']) {
    $(id).addEventListener('input', onFieldInput);
    $(id).addEventListener('change', onFieldInput);
  }
  $('#horizon-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.settings.horizon_months = Number(b.dataset.h);
    api('PUT', 'settings', state.settings).catch(() => {});
    recompute();
    renderDashboard();
  });
  $('#theme-toggle').addEventListener('click', () => {
    const next = themeIsDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
    paintThemeButton();
    renderCurrent();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paintThemeButton(); renderCurrent(); });
  window.addEventListener('hashchange', route);
}

function toggleMonthRow(k) {
  if (openMonths.has(k)) openMonths.delete(k); else openMonths.add(k);
  renderTable();
  $(`tr.m[data-month="${k}"]`)?.focus();
}

async function load() {
  const boot = $('#boot');
  boot.hidden = false;
  boot.classList.toggle('failed', false);
  $('#save-state').textContent = 'Loading your plan…';
  try {
    setState(await request('GET', 'state'));
  } catch {
    boot.classList.toggle('failed', true);
    $('#save-state').className = 'brand-sub status error';
    $('#save-state').textContent = 'Offline';
    return;
  }
  boot.hidden = true;
  paintStatus();
  route();
}

// Another tab (or a restore) may have changed the data: re-sync when this tab regains focus,
// unless the user is mid-edit or there are unsaved changes.
async function resync() {
  if (pending || failed.length || !proj || document.activeElement?.matches?.('input, select, .mp')) return;
  try {
    const fresh = await request('GET', 'state');
    const strip = (x) => JSON.stringify(x, (k, v) => (k === 'saving' ? undefined : v));
    if (strip(fresh) !== strip(state)) setState(fresh);
  } catch { /* offline — the status pill shows it on the next save */ }
}

function init() {
  for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);
  paintThemeButton();
  wire();
  window.addEventListener('focus', resync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  load();
  requestPersistence();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
