// Calendar (year grid of month cards) and the per-month page.
import { addMonths, currentMonth, FREE } from './projection.js';
import { inr, inrCompact, monthLabel } from './format.js';
import { icon, EV } from './icons.js';
import { esc, numInput, parseNum, kpiHtml, hico } from './ui.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (s, r = document) => r.querySelector(s);

const range = (ctx) => ({ first: ctx.proj.start, last: ctx.proj.months.at(-1).month });
const monthOf = (ctx, ym) => ctx.proj.months.find((m) => m.month === ym);

// ================================================================= calendar grid
// Amounts on small cards: full rupees up to a crore, compact (₹2.4Cr) beyond so cards never overflow.
const fit = (v) => (Math.abs(v) >= 1e7 ? inrCompact(v) : inr(v));

const NEEDS_PLAN = `<div class="card empty-card">
    <span class="hico violet">${icon('calendar', 16)}</span>
    <h2>Your calendar fills in once you have a plan</h2>
    <p class="muted">Add your in-hand salary and regular expenses first — every month here then shows what comes in, what goes out and what’s left.</p>
    <div class="empty-actions"><a class="btn primary" href="#plan">Set up my plan <span class="btn-ico">${icon('arrowRight', 14)}</span></a><button class="btn" type="button" data-action="sample">Try an example</button></div>
  </div>`;

export function renderCalendar(ctx, year) {
  const el = $('#tab-calendar');
  if (ctx.isEmpty()) {
    el.innerHTML = `<div class="dash-head"><div><h1>Calendar</h1><p class="muted">Every month of your plan, at a glance.</p></div></div>${NEEDS_PLAN}`;
    return;
  }
  const { first, last } = range(ctx);
  const firstY = Number(first.slice(0, 4));
  const lastY = Number(last.slice(0, 4));
  const now = currentMonth();
  const y = Math.min(lastY, Math.max(firstY, Number(year) || Number((now >= first && now <= last ? now : first).slice(0, 4))));

  const inYear = ctx.proj.months.filter((m) => m.month.startsWith(`${y}-`));
  const sum = (k) => inYear.reduce((a, m) => a + m[k], 0);
  const endOfYear = inYear.at(-1);

  const cards = MONTH_NAMES.map((name, i) => {
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    const m = monthOf(ctx, ym);
    if (!m) {
      const before = ym < first;
      return `<div class="mcard off" aria-disabled="true">
        <div class="mc-top"><span class="mc-name">${name}</span></div>
        <p class="muted">${before ? 'Before your plan starts' : 'Beyond the projection'}</p>
        ${before ? '' : `<button type="button" class="link-btn" data-extend="${ym}">Extend projection →</button>`}
      </div>`;
    }
    const out = m.expenses + m.emi;
    const parts = [
      { v: m.expenses, c: ctx.slot(2) },
      { v: m.emi, c: ctx.slot(3) },
      { v: m.toGoals, c: ctx.slot(4) },
      { v: Math.max(0, m.freeFlow), c: ctx.slot(1) },
    ];
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    const tags = [];
    const extraExp = m.expenseItems.filter((e) => e.oneOff);
    const allocTotal = m.allocItems.reduce((a, x) => a + x.amount, 0);
    if (allocTotal) tags.push(`<span class="tag good">${icon('piggy', 12)}+${inrCompact(allocTotal)} to ${m.allocItems.length === 1 ? esc(ctx.goalName(m.allocItems[0].goalId)) : `${m.allocItems.length} goals`}</span>`);
    if (extraExp.length) tags.push(`<span class="tag warn">${icon('receipt', 12)}${extraExp.length === 1 ? esc(extraExp[0].name || 'Expense') : `${extraExp.length} extra expenses`} ${inrCompact(extraExp.reduce((a, e) => a + e.amount, 0))}</span>`);
    for (const e of m.events) {
      if (e.type === 'shortfall') continue;
      if (e.type === 'goal_reached' && m.events.some((x) => x.type === 'goal_spent' && x.goalId === e.goalId)) continue;
      tags.push(`<span class="tag ${EV[e.type].cls}">${icon(EV[e.type].icon, 12)}${esc(shortEvent(e))}</span>`);
    }
    const shown = tags.slice(0, 3).join('') + (tags.length > 3 ? `<span class="tag">+${tags.length - 3} more</span>` : '');
    return `<a class="mcard ${m.freeFlow < -0.5 ? 'is-neg' : ''} ${ym === now ? 'is-now' : ''}" href="#month/${ym}">
      <div class="mc-top"><span class="mc-name">${name}</span>${ym === now ? '<span class="now-badge">This month</span>' : ''}<span class="go-ico" aria-hidden="true">${icon('arrowRight', 14)}</span></div>
      <div class="mc-left"><span class="lbl">Left over</span><span class="val">${fit(m.freeFlow)}</span></div>
      <div class="mc-bar">${parts.filter((p) => p.v > 0).map((p) => `<span style="width:${(p.v / tot) * 100}%;background:${p.c}"></span>`).join('')}</div>
      <dl class="mc-rows">
        <div><dt>In</dt><dd>${inrCompact(m.income)}</dd></div>
        <div><dt>Spending</dt><dd>${inrCompact(out)}</dd></div>
        <div><dt>To goals</dt><dd>${inrCompact(m.toGoals)}</dd></div>
      </dl>
      ${shown ? `<div class="mc-tags">${shown}</div>` : ''}
    </a>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-head">
      <div><h1>Calendar</h1><p class="muted">Open a month to add one-off expenses, extra income, or extra money for a goal.</p></div>
      <div class="year-switch">
        <a class="icon-btn ${y <= firstY ? 'disabled' : ''}" href="#calendar/${y - 1}" aria-label="Previous year">${icon('left')}</a>
        <b>${y}</b>
        <a class="icon-btn ${y >= lastY ? 'disabled' : ''}" href="#calendar/${y + 1}" aria-label="Next year">${icon('right')}</a>
      </div>
    </div>
    <div class="card year-strip">
      <div><span>Income</span><b>${fit(sum('income'))}</b></div>
      <div><span>Spending</span><b>${fit(sum('expenses') + sum('emi'))}</b></div>
      <div><span>To goals</span><b>${fit(sum('toGoals'))}</b></div>
      <div><span>Left over</span><b class="${sum('freeFlow') < 0 ? 'neg' : ''}">${fit(sum('freeFlow'))}</b></div>
      <div><span>Total saved by ${endOfYear ? MONTH_NAMES[Number(endOfYear.month.slice(5)) - 1].slice(0, 3) : ''}</span><b>${fit(endOfYear?.totalSaved || 0)}</b></div>
    </div>
    <div class="cal-grid">${cards}</div>
    <div class="legend-row">
      <span><i class="dot" style="background:${ctx.slot(2)}"></i>Expenses</span>
      <span><i class="dot" style="background:${ctx.slot(3)}"></i>EMIs</span>
      <span><i class="dot" style="background:${ctx.slot(4)}"></i>To goals</span>
      <span><i class="dot" style="background:${ctx.slot(1)}"></i>Left over</span>
    </div>`;
}

function shortEvent(e) {
  switch (e.type) {
    case 'raise': return 'Raise';
    case 'bonus': return `${e.text.replace(/ received$/, '')} ${inrCompact(e.amount)}`;
    case 'goal_reached': return e.text;
    case 'goal_spent': return e.text.replace(/ purchased$/, ' bought');
    case 'loan_closed': return e.text.replace(/ — last EMI paid$/, ' paid off');
    default: return e.text;
  }
}

// ================================================================= month page
export function renderMonth(ctx, ym) {
  const el = $('#tab-month');
  const { first, last } = range(ctx);
  if (ctx.isEmpty()) { el.innerHTML = NEEDS_PLAN; return; }
  const m = monthOf(ctx, ym);
  const [y, mo] = ym.split('-');
  const title = `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  const prev = addMonths(ym, -1);
  const next = addMonths(ym, 1);

  const head = `
    <a class="crumb" href="#calendar/${y}">${icon('left', 14)} Calendar ${y}</a>
    <div class="month-head">
      <a class="icon-btn ${prev < first ? 'disabled' : ''}" href="#month/${prev}" aria-label="Previous month">${icon('left')}</a>
      <h1>${title}</h1>
      <a class="icon-btn ${next > last ? 'disabled' : ''}" href="#month/${next}" aria-label="Next month">${icon('right')}</a>
      ${ym === currentMonth() ? '<span class="now-badge">This month</span>' : ''}
    </div>`;

  if (!m) {
    const before = ym < first;
    el.innerHTML = `${head}<div class="card empty-card">
      <p>${before ? `This month is before your plan starts (${monthLabel(first)}).` : `This month is beyond your ${ctx.proj.horizon}-month projection.`}</p>
      ${before ? '<a class="btn" href="#plan">Change the start month in Plan</a>' : `<button class="btn primary" data-extend="${ym}">Extend projection to include ${monthLabel(ym)}</button>`}
    </div>`;
    return;
  }

  el.innerHTML = `${head}
    <div class="kpis" id="month-kpis"></div>
    <div class="month-layout">
      <div class="month-main">
        <article class="card plan-card" id="m-expenses">
          <header>
            <h2>${hico('receipt', 'pink')} Spending this month</h2>
            <p class="muted">Everything going out in ${MONTH_NAMES[Number(mo) - 1]} — regular expenses, EMIs and one-off spends.</p>
          </header>
          <div id="exp-regular"></div>
          <div class="sub-head">${icon('sparkles', 13)} One-off this month<span id="oneoff-total"></span></div>
          <div class="rows" id="extra-exp"></div>
          <button class="btn primary add-primary" data-add="expenses" data-defaults='${esc(JSON.stringify({ one_off: 1, start_month: ym }))}'>${icon('plus', 15)} Add one-off expense</button>
        </article>

        <article class="card plan-card">
          <header>
            <h2>${hico('piggy', 'mint')} Add to goals</h2>
            <p class="muted">Regular monthly savings happen automatically. Anything extra you add here comes out of this month’s left over.</p>
          </header>
          <div id="alloc-rows"></div>
        </article>

        <article class="card plan-card">
          <header>
            <h2>${hico('gift', 'yellow')} Extra income this month</h2>
            <p class="muted">Bonus, freelance work, a refund, a gift — and which fund it goes into.</p>
          </header>
          <div class="rows" id="extra-inc"></div>
          <button class="btn add" data-add="bonuses" data-defaults='${esc(JSON.stringify({ note: '', month: ym, repeat_yearly: 0, target: FREE }))}'>${icon('plus', 14)} Add income</button>
        </article>
      </div>
      <aside class="month-side">
        <div class="card" id="month-events"></div>
        <div class="card" id="month-balances"></div>
      </aside>
    </div>`;

  renderMonthRows(ctx, ym);
  renderMonthLive(ctx, ym);
}

// Rows with inputs — only re-rendered on structural changes so typing keeps focus.
function renderMonthRows(ctx, ym) {
  const { state } = ctx;
  const extras = state.expenses.filter((e) => Number(e.one_off) && e.start_month === ym);
  $('#extra-exp').innerHTML = extras.length
    ? extras.map((e) => `<div class="row row-mexp" data-row="expenses:${e.id}">
        <label><span class="lt">What</span><input type="text" data-table="expenses" data-id="${e.id}" data-key="name" value="${esc(e.name)}" placeholder="e.g. New phone" /></label>
        <label><span class="lt">Category <em>optional</em></span><input type="text" list="cat-list" data-table="expenses" data-id="${e.id}" data-key="category" value="${esc(e.category)}" placeholder="e.g. Shopping" /></label>
        <label><span class="lt">Amount</span>${numInput(`data-table="expenses" data-id="${e.id}" data-key="amount"`, e.amount, '0', true)}</label>
        <button class="del" data-del="expenses:${e.id}" title="Remove" aria-label="Remove expense">${icon('x')}</button>
      </div>`).join('')
    : '<div class="empty-rows">No one-off spends this month.</div>';

  const incomes = state.bonuses.filter((b) => b.month === ym && !Number(b.repeat_yearly));
  const m = monthOf(ctx, ym);
  const yearly = m.bonusItems.filter((b) => b.recurring || state.bonuses.find((x) => x.id === b.id && Number(x.repeat_yearly)));
  $('#extra-inc').innerHTML = (incomes.length
    ? incomes.map((b) => `<div class="row row-minc" data-row="bonuses:${b.id}">
        <label><span class="lt">What</span><input type="text" data-table="bonuses" data-id="${b.id}" data-key="note" value="${esc(b.note)}" placeholder="e.g. Freelance project" /></label>
        <label><span class="lt">Amount</span>${numInput(`data-table="bonuses" data-id="${b.id}" data-key="amount"`, b.amount, '0', true)}</label>
        <label><span class="lt">Goes to</span><select data-table="bonuses" data-id="${b.id}" data-key="target">${ctx.destOptions().map((o) => `<option value="${esc(o.v)}" ${String(b.target || FREE) === o.v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>
        <button class="del" data-del="bonuses:${b.id}" title="Remove" aria-label="Remove income">${icon('x')}</button>
      </div>`).join('')
    : '<div class="empty-rows">No extra income this month.</div>')
    + yearly.map((b) => `<div class="note-line">${icon('gift', 14)} ${esc(b.name)} (every year) adds ${inr(b.amount)} → ${esc(ctx.goalName(b.dest))}. <a href="#plan" data-focus="bonuses">Edit in Plan</a></div>`).join('');

  // Goal allocation rows
  const goals = state.goals;
  $('#alloc-rows').innerHTML = goals.length
    ? `<div class="alloc-head"><span>Goal</span><span>Regular</span><span>Extra this month</span><span>Balance after</span></div>`
      + goals.map((g) => {
        const id = String(g.id);
        const a = state.allocations.find((x) => x.month === ym && String(x.goal_id) === id);
        return `<div class="alloc-row" data-goal="${id}">
          <div class="alloc-name"><i class="dot" style="background:${ctx.goalColor(g)}"></i><span>${esc(g.name || 'Untitled goal')}</span><small data-alloc-status="${id}"></small></div>
          <div class="alloc-reg" data-alloc-reg="${id}"></div>
          <label class="alloc-in"><span class="sr">Extra for ${esc(g.name || 'goal')} in ${monthLabel(ym)}</span>${numInput(`data-alloc="${id}" data-month="${ym}"`, a?.amount, '0', true)}</label>
          <div class="alloc-bal" data-alloc-bal="${id}"></div>
        </div>`;
      }).join('')
    : `<div class="empty-rows">No goals yet. <a href="#plan" data-focus="goals">Create a goal in Plan</a> — only a name is needed.</div>`;
}

// Numbers that change while typing.
export function renderMonthLive(ctx, ym) {
  const m = monthOf(ctx, ym);
  if (!m || !$('#month-kpis')) return;
  const { state } = ctx;
  const out = m.expenses + m.emi;
  // One summary row reads like the month's equation: income − spending − to goals = left over.
  const oneOffTotal = m.expenseItems.filter((e) => e.oneOff).reduce((a, e) => a + e.amount, 0);
  const regularTotal = m.expenses - oneOffTotal;
  const spendNote = [regularTotal && `${inr(regularTotal)} regular`, m.emi && `${inr(m.emi)} EMIs`, oneOffTotal && `${inr(oneOffTotal)} one-off`].filter(Boolean).join(' + ') || 'nothing yet';
  const extraGoals = m.allocItems.reduce((a, x) => a + x.amount, 0);
  $('#month-kpis').innerHTML = [
    { label: 'Income', value: inr(m.income), note: m.bonus ? `${inr(m.salary)} salary + ${inr(m.bonus)} extra` : 'in-hand salary', icon: 'wallet', tone: 'violet' },
    { label: 'Spending', value: inr(out), note: spendNote, icon: 'receipt', tone: 'pink', href: '#m-expenses' },
    { label: 'To goals', value: inr(m.toGoals), note: extraGoals ? `incl. ${inr(extraGoals)} extra` : 'regular savings', icon: 'piggy', tone: 'mint' },
    { label: 'Left over', value: inr(m.freeFlow), note: m.freeFlow < 0 ? 'taken from free savings' : 'goes to free savings', neg: m.freeFlow < -0.5, icon: 'coins', tone: 'yellow', featured: true },
  ].map(kpiHtml).join('');

  // Events
  const evs = m.events;
  $('#month-events').innerHTML = `<h2>What happens this month</h2>` + (evs.length
    ? `<ul class="ev-list">${evs.map((e) => `<li><span class="ico ${EV[e.type].cls}">${icon(EV[e.type].icon, 14)}</span>${esc(e.type === 'shortfall' ? 'Spending is more than income' : e.text)}</li>`).join('')}</ul>`
    : '<p class="muted small">Nothing special — a regular month.</p>');

  // Balances
  $('#month-balances').innerHTML = `<h2>Balances after this month</h2>
    ${state.goals.map((g) => `<div class="sum-line"><span><i class="dot" style="background:${ctx.goalColor(g)}"></i>${esc(g.name || 'Untitled goal')}</span><span>${inr(m.balances[String(g.id)] || 0)}</span></div>`).join('')}
    <div class="sum-line"><span><i class="dot" style="background:${ctx.FREE_COLOR()}"></i>Free savings</span><span class="${m.freeBalance < 0 ? 'neg' : ''}">${inr(m.freeBalance)}</span></div>
    <div class="sum-line total"><span>Total saved</span><span>${inr(m.totalSaved)}</span></div>`;

  // Full expense list: regular (recurring) + EMIs (+ one-off rows rendered as inputs above the totals)
  const regular = m.expenseItems.filter((e) => !e.oneOff);
  const oneOff = m.expenseItems.filter((e) => e.oneOff);
  const sumOf = (list, k = 'amount') => list.reduce((a, x) => a + x[k], 0);
  const regTotal = sumOf(regular);
  const oneTotal = sumOf(oneOff);
  const schedule = (e) => {
    const src = state.expenses.find((x) => x.id === e.id) || {};
    const from = src.start_month && src.start_month > ctx.proj.start ? `since ${monthLabel(src.start_month)}` : 'every month';
    return src.end_month ? `${from} · until ${monthLabel(src.end_month)}` : `${from} · no end date`;
  };
  const loanSchedule = (l) => {
    const src = state.loans.find((x) => x.id === l.id) || {};
    const last = src.start_month ? addMonths(src.start_month, Number(src.tenure_months) - 1) : null;
    return `${inr(l.outstanding)} left${last ? ` · last EMI ${monthLabel(last)}` : ''}`;
  };
  const line = (name, cat, meta, amt) => `<div class="exp-line">
      <div class="exp-what"><b>${esc(name)}</b>${cat ? `<span class="tag">${esc(cat)}</span>` : ''}<small>${meta}</small></div>
      <div class="exp-amt">${inr(amt)}</div></div>`;
  const regEl = $('#exp-regular');
  if (regEl) {
    regEl.innerHTML = `
      <div class="sub-head">${icon('receipt', 13)} Regular · ${inr(regTotal)}</div>
      ${regular.length ? regular.map((e) => line(e.name || 'Expense', e.category, schedule(e), e.amount)).join('') : '<div class="empty-rows">No regular expenses this month.</div>'}
      ${m.loanItems.length ? `<div class="sub-head">${icon('landmark', 13)} EMIs · ${inr(m.emi)}</div>${m.loanItems.map((l) => line(`${l.name || 'Loan'}`, 'EMI', loanSchedule(l), l.emi)).join('')}` : ''}
      <a class="small edit-link" href="#plan" data-focus="expenses">Edit regular costs &amp; loans in Plan →</a>`;
    $('#oneoff-total').textContent = oneTotal ? ` · ${inr(oneTotal)}` : '';
  }

  // Allocation row numbers
  for (const g of state.goals) {
    const id = String(g.id);
    const added = m.contributions[id] || 0;
    const lump = m.lumpContributions[id] || 0;
    const regular = added - lump;
    const bal = m.balances[id] || 0;
    const target = Number(g.target_amount) || 0;
    const summary = ctx.proj.goals.find((x) => x.id === id);
    const reachedBefore = summary?.reachedMonth && summary.reachedMonth < ym;
    const regEl = $(`[data-alloc-reg="${id}"]`);
    if (!regEl) continue;
    regEl.textContent = regular > 0 ? inr(regular) : '—';
    const pctDone = target ? Math.min(1, bal / target) : null;
    $(`[data-alloc-bal="${id}"]`).innerHTML = `<b>${inr(bal)}</b>${target ? `<span class="muted"> / ${inrCompact(target)}</span><span class="bar mini"><span style="width:${pctDone * 100}%;background:${ctx.goalColor(g)}"></span></span>` : ''}`;
    let status = '';
    if (reachedBefore) {
      status = `Reached ${monthLabel(summary.reachedMonth)}${g.on_complete === 'spend' ? ' & bought' : ''} — extra goes to ${esc(ctx.goalName(g.divert_to))}`;
    } else if (summary?.reachedMonth === ym) {
      status = g.on_complete === 'spend' ? 'Reached &amp; bought this month' : 'Reaches its target this month';
    } else if (g.start_month && ym < g.start_month && Number(g.monthly_amount) > 0) {
      status = `Regular saving starts ${monthLabel(g.start_month)}`;
    }
    $(`[data-alloc-status="${id}"]`).innerHTML = status;
  }
}

// ---------------------------------------------------------------- allocation editing
const allocTimers = new Map();
export function onAllocInput(ctx, el) {
  const goalId = el.dataset.alloc;
  const ym = el.dataset.month;
  const value = parseNum(el.value);
  const { state } = ctx;
  let row = state.allocations.find((a) => a.month === ym && String(a.goal_id) === goalId);
  if (!row && value) { row = { id: null, month: ym, goal_id: goalId, amount: value }; state.allocations.push(row); }
  else if (row) row.amount = value;
  const key = `${ym}:${goalId}`;
  clearTimeout(allocTimers.get(key));
  allocTimers.set(key, setTimeout(() => flushAlloc(ctx, ym, goalId), 450));
}

async function flushAlloc(ctx, ym, goalId) {
  const { state } = ctx;
  const row = state.allocations.find((a) => a.month === ym && String(a.goal_id) === goalId);
  if (!row) return;
  if (row.saving) { allocTimers.set(`${ym}:${goalId}`, setTimeout(() => flushAlloc(ctx, ym, goalId), 300)); return; }
  row.saving = true;
  try {
    if (!row.amount) {
      if (row.id) await ctx.api('DELETE', `allocations/${row.id}`);
      state.allocations = state.allocations.filter((a) => a !== row);
    } else if (row.id) {
      await ctx.api('PUT', `allocations/${row.id}`, { amount: row.amount });
    } else {
      const saved = await ctx.api('POST', 'allocations', { month: ym, goal_id: goalId, amount: row.amount });
      row.id = saved.id;
    }
  } catch { /* api() queued it for Retry */ } finally {
    row.saving = false;
  }
}

// Months a goal's extra allocations exist in (for Plan hints).
export function allocSummary(state, goalId) {
  const list = state.allocations.filter((a) => String(a.goal_id) === String(goalId) && Number(a.amount) > 0);
  return { count: list.length, total: list.reduce((a, x) => a + Number(x.amount), 0) };
}

