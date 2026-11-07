// Reusable UI bits: toast (with undo), month picker, money inputs.
import { icon } from './icons.js';
import { monthLabel, monthShort } from './format.js';
import { currentMonth } from './projection.js';

const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(msg, opts = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
  if (opts.action) t.querySelector('button').onclick = () => { t.classList.remove('show'); opts.onAction(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (!opts.sticky) toastTimer = setTimeout(() => t.classList.remove('show'), opts.action ? 6000 : 2400);
}

// ---------------------------------------------------------------- sticker KPI tile
// { label, value, note, href?, neg?, icon, tone: 'violet' | 'pink' | 'yellow' | 'mint' }
// `featured` makes the tile the visual anchor of its row; `href` makes it clickable (dark sticker shadow + arrow).
export function kpiHtml(k) {
  const tag = k.href ? `a href="${k.href}"` : 'div';
  return `<${tag} class="card kpi ${k.href ? 'link' : ''} ${k.featured ? 'featured' : ''} ${k.neg ? 'kpi-neg' : ''}">
    <span class="float-ico ${k.tone || 'violet'}">${icon(k.icon || 'wallet', 18)}</span>
    ${k.href ? `<span class="go-ico" aria-hidden="true">${icon('arrowRight', 14)}</span>` : ''}
    <div class="label">${k.label}</div><div class="value">${k.value}</div><div class="note">${k.note}</div>
  </${k.href ? 'a' : 'div'}>`;
}
// Section heading icon in a coloured circle
export const hico = (name, tone) => `<span class="hico ${tone}">${icon(name, 16)}</span>`;

// ---------------------------------------------------------------- money inputs
// Plain text inputs that show Indian digit grouping (3,00,000) when not focused.
const grp = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const fmtNum = (v) => (v === null || v === undefined || v === '' ? '' : grp.format(Number(v)));
export const parseNum = (s) => {
  const t = String(s ?? '').replace(/[^\d.]/g, '');
  if (t === '' || t === '.') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};
// money = true shows a ₹ inside the field so amounts are unambiguous.
export function numInput(attrs, value, placeholder = '', money = false) {
  const input = `<input type="text" inputmode="decimal" autocomplete="off" data-num ${attrs} value="${esc(fmtNum(value))}" placeholder="${esc(placeholder)}" />`;
  return money ? `<span class="money"><span class="cur" aria-hidden="true">₹</span>${input}</span>` : input;
}
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (el.matches?.('input[data-num]')) el.value = fmtNum(parseNum(el.value));
});
document.addEventListener('input', (e) => {
  const el = e.target;
  // keep only digits, separators and one decimal point while typing
  if (el.matches?.('input[data-num]')) {
    const clean = el.value.replace(/[^\d.,]/g, '');
    if (clean !== el.value) el.value = clean;
  }
}, true);

// ---------------------------------------------------------------- month picker
// <button class="mp" data-month="2027-04" data-placeholder="Any time" data-clearable> → popover with year + 12 months.
// `clearable` adds an inline ✕ so optional months (e.g. an expense's end date) can be removed again.
export function monthButton(attrs, value, placeholder = 'Choose month', clearable = true, defaultMonth = '') {
  return `<span class="mp-wrap ${value ? 'has' : ''}"><button type="button" class="mp ${value ? '' : 'empty'}" ${attrs} data-month="${esc(value || '')}" data-placeholder="${esc(placeholder)}" ${clearable ? 'data-clearable' : ''} ${defaultMonth ? `data-default="${esc(defaultMonth)}"` : ''} aria-haspopup="dialog" ${value ? `title="${monthLabel(value)}"` : ''}>
    ${icon('calendar', 15)}<span>${value ? monthShort(value) : esc(placeholder)}</span></button>${clearable ? `<button type="button" class="mp-x" aria-label="Clear — ${esc(placeholder)}" title="Clear (${esc(placeholder)})">${icon('x', 13)}</button>` : ''}</span>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let pop;
let target;
let viewYear;

function setMonth(btn, value) {
  btn.dataset.month = value || '';
  btn.classList.toggle('empty', !value);
  btn.parentElement?.classList.toggle('has', !!value);
  btn.querySelector('span').textContent = value ? monthShort(value) : btn.dataset.placeholder;
  btn.title = value ? monthLabel(value) : '';
  btn.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderPop() {
  const sel = target.dataset.month;
  const now = currentMonth();
  pop.innerHTML = `
    <div class="mp-head">
      <button type="button" class="icon-btn sm" data-y="-1" aria-label="Previous year">${icon('left')}</button>
      <b>${viewYear}</b>
      <button type="button" class="icon-btn sm" data-y="1" aria-label="Next year">${icon('right')}</button>
    </div>
    <div class="mp-grid">${MONTHS.map((m, i) => {
      const v = `${viewYear}-${String(i + 1).padStart(2, '0')}`;
      return `<button type="button" data-v="${v}" class="${v === sel ? 'sel' : ''} ${v === now ? 'now' : ''}">${m}</button>`;
    }).join('')}</div>
    <div class="mp-foot">
      <button type="button" class="link-btn" data-v="${now}">This month</button>
      ${'clearable' in target.dataset ? `<button type="button" class="link-btn muted-link" data-clear>${icon('x', 12)} Clear · ${esc(target.dataset.placeholder)}</button>` : ''}
    </div>`;
}

function place() {
  const r = target.getBoundingClientRect();
  const w = 248;
  const h = pop.offsetHeight || 250;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  const below = r.bottom + 6 + h < window.innerHeight;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
}

export function closeMonthPicker() {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  target?.setAttribute('aria-expanded', 'false');
  target?.focus();
  target = null;
}

function openPicker(btn) {
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'mp-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.append(pop);
    pop.addEventListener('click', (e) => {
      e.stopPropagation(); // re-rendering detaches e.target; don't let the outside-click handler close us
      const y = e.target.closest('[data-y]');
      if (y) { viewYear += Number(y.dataset.y); renderPop(); return; }
      const v = e.target.closest('[data-v]');
      if (v) { const t = target; closeMonthPicker(); setMonth(t, v.dataset.v); return; }
      if (e.target.closest('[data-clear]')) { const t = target; closeMonthPicker(); setMonth(t, null); }
    });
  }
  target = btn;
  viewYear = Number((btn.dataset.month || btn.dataset.default || currentMonth()).slice(0, 4));
  renderPop();
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  place();
  (pop.querySelector('.sel') || pop.querySelector('.now') || pop.querySelector('.mp-grid button')).focus();
}

document.addEventListener('click', (e) => {
  const x = e.target.closest('button.mp-x');
  if (x) { e.preventDefault(); closeMonthPicker(); const b = x.parentElement.querySelector('.mp'); setMonth(b, null); b.focus(); return; }
  const btn = e.target.closest('button.mp');
  if (btn) { e.preventDefault(); if (target === btn) closeMonthPicker(); else openPicker(btn); return; }
  if (pop && !pop.hidden && !e.target.closest('.mp-pop')) closeMonthPicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMonthPicker();
  if (pop && !pop.hidden && e.target.closest?.('.mp-grid') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const btns = [...pop.querySelectorAll('.mp-grid button')];
    const i = btns.indexOf(e.target);
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    btns[Math.min(11, Math.max(0, i + d))].focus();
  }
});
window.addEventListener('resize', () => { if (pop && !pop.hidden) place(); });
window.addEventListener('scroll', () => { if (pop && !pop.hidden) place(); }, true);
