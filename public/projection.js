// Pure projection engine — shared by the browser and the tests.
// Input: the full plan state. Output: one row per month + events + goal summaries.

export const FREE = 'free';

// ---------- month helpers ("YYYY-MM") ----------
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthDiff(a, b) {
  // number of months from a to b (b - a)
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}
export function currentMonth(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)) && Number(v) > 0;
const destOf = (v) => (v === null || v === undefined || v === '' || v === FREE ? FREE : String(v));

// ---------- loans ----------
export function loanEmi(loan) {
  if (has(loan.emi)) return num(loan.emi);
  const P = num(loan.principal);
  const n = Math.max(1, num(loan.tenure_months));
  const r = num(loan.annual_rate) / 1200;
  if (!P) return 0;
  if (!r) return P / n;
  const f = Math.pow(1 + r, n);
  return (P * r * f) / (f - 1);
}

// Outstanding after k payments.
export function loanOutstanding(loan, k) {
  const n = Math.max(1, num(loan.tenure_months));
  if (k >= n) return 0;
  const emi = loanEmi(loan);
  const P = num(loan.principal);
  const r = num(loan.annual_rate) / 1200;
  if (!P) return emi * (n - k);
  if (!r) return Math.max(0, P - emi * k);
  const f = Math.pow(1 + r, k);
  return Math.max(0, P * f - (emi * (f - 1)) / r);
}

// ---------- main ----------
export function project(state) {
  const s = state.settings || {};
  const start = s.start_month || currentMonth();
  const horizon = Math.max(1, Math.min(600, num(s.horizon_months) || 36));
  const raises = [...(state.raises || [])].filter((r) => r.month).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.id - b.id));
  const bonuses = state.bonuses || [];
  const expenses = state.expenses || [];
  const loans = (state.loans || []).filter((l) => l.start_month && num(l.tenure_months) > 0);
  const goals = state.goals || [];
  const allocations = state.allocations || [];
  const goalById = new Map(goals.map((g) => [String(g.id), g]));

  let salary = num(s.base_salary);
  // Raises dated before the plan start are assumed to already be in base salary.
  let freeBalance = num(s.opening_balance);
  const bal = new Map(goals.map((g) => [String(g.id), num(g.opening_balance)]));
  const done = new Map(); // goalId -> month reached
  const spentTotal = new Map(goals.map((g) => [String(g.id), 0]));
  const months = [];
  const events = [];

  const target = (g) => (has(g.target_amount) ? num(g.target_amount) : Infinity);

  for (let i = 0; i < horizon; i++) {
    const ym = addMonths(start, i);
    const ev = [];
    const pushEv = (type, text, extra = {}) => { const e = { month: ym, type, text, ...extra }; ev.push(e); events.push(e); };

    // 1. Salary + raises
    for (const r of raises) {
      if (r.month !== ym) continue;
      const before = salary;
      if (r.type === 'new_amount') salary = num(r.value);
      else salary = Math.round(salary * (1 + num(r.value) / 100));
      pushEv('raise', `${r.note ? r.note + ': ' : ''}salary ${r.type === 'new_amount' ? 'set' : `+${num(r.value)}%`}`, { from: before, to: salary });
    }

    // 2. Bonuses (one-off or yearly)
    const bonusLumps = [];
    let bonus = 0;
    for (const b of bonuses) {
      if (!b.month || !has(b.amount)) continue;
      const hit = b.month === ym || (Number(b.repeat_yearly) && ym > b.month && ym.slice(5) === b.month.slice(5));
      if (!hit) continue;
      bonus += num(b.amount);
      bonusLumps.push({ amount: num(b.amount), dest: destOf(b.target) });
      pushEv('bonus', `${b.note || 'Bonus'} received`, { amount: num(b.amount) });
    }
    const income = salary + bonus;
    const bonusItems = bonuses.filter((b) => b.month && has(b.amount) && (b.month === ym || (Number(b.repeat_yearly) && ym > b.month && ym.slice(5) === b.month.slice(5))))
      .map((b) => ({ id: b.id, name: b.note || 'Bonus', amount: num(b.amount), recurring: Number(b.repeat_yearly) && b.month !== ym, dest: destOf(b.target) }));

    // 3. Expenses
    let exp = 0;
    const expenseItems = [];
    for (const e of expenses) {
      if (!has(e.amount)) continue;
      let active;
      if (Number(e.one_off)) active = (e.start_month || start) === ym;
      else active = (!e.start_month || e.start_month <= ym) && (!e.end_month || ym <= e.end_month);
      if (active) { exp += num(e.amount); expenseItems.push({ id: e.id, name: e.name, category: e.category, amount: num(e.amount), oneOff: !!Number(e.one_off) }); }
    }

    // 4. Loans / EMIs
    let emi = 0;
    let loanOut = 0;
    const freedStreams = [];
    const loanItems = [];
    for (const l of loans) {
      const k = monthDiff(l.start_month, ym); // payment index (0-based) this month
      const n = num(l.tenure_months);
      const amt = loanEmi(l);
      if (k >= 0 && k < n) {
        emi += amt;
        const out = loanOutstanding(l, k + 1);
        loanOut += out;
        loanItems.push({ id: l.id, name: l.name, emi: amt, outstanding: out });
        if (k === n - 1) pushEv('loan_closed', `${l.name || 'Loan'} — last EMI paid`, { amount: amt });
      } else if (k < 0) {
        loanOut += has(l.principal) ? num(l.principal) : amt * n;
      } else if (k >= n) {
        // EMI is freed up; route it to the chosen destination.
        const dest = destOf(l.divert_to);
        if (dest !== FREE) freedStreams.push({ amount: amt, dest });
      }
    }

    // 5. Goal contributions — route every stream through a queue so a goal that
    //    fills up spills its overflow (and future contributions) into its divert target.
    const contrib = new Map(goals.map((g) => [String(g.id), 0]));
    const lumpContrib = new Map(goals.map((g) => [String(g.id), 0])); // part of contrib that came from bonuses
    const queue = [];
    for (const g of goals) {
      if (!has(g.monthly_amount)) continue;
      if (g.start_month && ym < g.start_month) continue;
      queue.push({ amount: num(g.monthly_amount), dest: String(g.id), hops: 0 });
    }
    for (const f of freedStreams) queue.push({ ...f, hops: 0 });
    for (const b of bonusLumps) queue.push({ ...b, hops: 0, lump: true });
    const allocItems = [];
    for (const a of allocations) {
      if (a.month !== ym || !has(a.amount)) continue;
      allocItems.push({ id: a.id, goalId: String(a.goal_id), amount: num(a.amount) });
      queue.push({ amount: num(a.amount), dest: destOf(a.goal_id), hops: 0, lump: true });
    }

    // Goals whose opening balance already meets the target
    for (const g of goals) {
      const id = String(g.id);
      if (!done.has(id) && bal.get(id) >= target(g)) markDone(g);
    }

    function markDone(g) {
      const id = String(g.id);
      done.set(id, ym);
      pushEv('goal_reached', `${g.name || 'Goal'} reached`, { goalId: id, amount: bal.get(id) });
    }

    let guard = 0;
    while (queue.length && guard++ < 10000) {
      const item = queue.shift();
      if (item.amount <= 0) continue;
      const g = item.dest === FREE ? null : goalById.get(item.dest);
      if (!g || item.hops > goals.length) continue; // → free savings (implicit)
      const id = String(g.id);
      if (done.has(id)) { queue.push({ ...item, dest: destOf(g.divert_to), hops: item.hops + 1 }); continue; }
      const room = target(g) - bal.get(id);
      const take = Math.min(item.amount, room);
      bal.set(id, bal.get(id) + take);
      contrib.set(id, contrib.get(id) + take);
      if (item.lump) lumpContrib.set(id, lumpContrib.get(id) + take);
      if (bal.get(id) >= target(g) - 0.005) {
        markDone(g);
        const rest = item.amount - take;
        if (rest > 0) queue.push({ ...item, amount: rest, dest: destOf(g.divert_to), hops: item.hops + 1 });
      }
    }

    // "Spend" goals are bought the month they complete.
    for (const g of goals) {
      const id = String(g.id);
      if (done.get(id) === ym && g.on_complete === 'spend' && bal.get(id) > 0) {
        spentTotal.set(id, spentTotal.get(id) + bal.get(id));
        pushEv('goal_spent', `${g.name || 'Goal'} purchased`, { goalId: id, amount: bal.get(id) });
        bal.set(id, 0);
      }
    }

    let toGoals = 0;
    for (const v of contrib.values()) toGoals += v;
    const freeFlow = income - exp - emi - toGoals;
    freeBalance += freeFlow;
    if (freeFlow < -0.5) pushEv('shortfall', `Spending exceeds income by ${Math.round(-freeFlow)}`, { amount: -freeFlow });

    let goalsBalance = 0;
    for (const v of bal.values()) goalsBalance += v;

    months.push({
      month: ym,
      salary,
      bonus,
      income,
      expenses: exp,
      expenseItems,
      bonusItems,
      allocItems,
      emi,
      loanItems,
      loanOutstanding: loanOut,
      toGoals,
      contributions: Object.fromEntries(contrib),
      lumpContributions: Object.fromEntries(lumpContrib),
      balances: Object.fromEntries(bal),
      freeFlow,
      freeBalance,
      goalsBalance,
      totalSaved: goalsBalance + freeBalance,
      savingsRate: income > 0 ? (toGoals + freeFlow) / income : 0,
      events: ev,
    });
  }

  const goalSummaries = goals.map((g) => {
    const id = String(g.id);
    const last = months[months.length - 1];
    return {
      id,
      name: g.name,
      target: has(g.target_amount) ? num(g.target_amount) : null,
      balance: last ? last.balances[id] : num(g.opening_balance),
      reachedMonth: done.get(id) || null,
      spent: spentTotal.get(id),
    };
  });

  return { start, horizon, months, events, goals: goalSummaries };
}
