import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, addMonths, loanEmi, loanOutstanding } from '../public/projection.js';

const base = (over = {}) => ({
  settings: { start_month: '2027-01', horizon_months: 24, base_salary: 100000, opening_balance: 0 },
  raises: [], bonuses: [], expenses: [], loans: [], goals: [],
  ...over,
});
const at = (p, ym) => p.months.find((m) => m.month === ym);

test('month helpers', () => {
  assert.equal(addMonths('2027-11', 3), '2028-02');
  assert.equal(addMonths('2027-01', -1), '2026-12');
});

test('percent raise applies from its month and compounds', () => {
  const p = project(base({ raises: [
    { id: 1, month: '2027-04', type: 'percent', value: 30 },
    { id: 2, month: '2028-04', type: 'percent', value: 10 },
  ] }));
  assert.equal(at(p, '2027-03').salary, 100000);
  assert.equal(at(p, '2027-04').salary, 130000);
  assert.equal(at(p, '2028-04').salary, 143000);
  assert.ok(p.events.some((e) => e.type === 'raise' && e.month === '2027-04'));
});

test('new-amount raise sets salary', () => {
  const p = project(base({ raises: [{ id: 1, month: '2027-06', type: 'new_amount', value: 150000 }] }));
  assert.equal(at(p, '2027-06').salary, 150000);
});

test('yearly bonus repeats in same calendar month', () => {
  const p = project(base({ bonuses: [{ id: 1, month: '2027-10', amount: 50000, repeat_yearly: 1, target: 'free' }] }));
  assert.equal(at(p, '2027-10').bonus, 50000);
  assert.equal(at(p, '2028-10').bonus, 50000);
  assert.equal(at(p, '2027-11').bonus, 0);
  assert.equal(at(p, '2027-10').income, 150000);
});

test('expenses: recurring window and one-off', () => {
  const p = project(base({ expenses: [
    { id: 1, name: 'Rent', amount: 20000, start_month: null, end_month: '2027-06', one_off: 0 },
    { id: 2, name: 'Trip', amount: 30000, start_month: '2027-03', one_off: 1 },
  ] }));
  assert.equal(at(p, '2027-01').expenses, 20000);
  assert.equal(at(p, '2027-03').expenses, 50000);
  assert.equal(at(p, '2027-07').expenses, 0);
});

test('free savings is income minus everything and accumulates', () => {
  const p = project(base({
    settings: { start_month: '2027-01', horizon_months: 3, base_salary: 100000, opening_balance: 10000 },
    expenses: [{ id: 1, name: 'Rent', amount: 30000, one_off: 0 }],
    goals: [{ id: 1, name: 'EF', monthly_amount: 20000, target_amount: null }],
  }));
  assert.equal(at(p, '2027-01').freeFlow, 50000);
  assert.equal(at(p, '2027-03').freeBalance, 160000);
  assert.equal(at(p, '2027-03').balances['1'], 60000);
  assert.equal(at(p, '2027-03').totalSaved, 220000);
});

test('loan EMI math', () => {
  const l = { principal: 100000, annual_rate: 12, tenure_months: 12 };
  assert.ok(Math.abs(loanEmi(l) - 8884.88) < 0.01);
  assert.ok(loanOutstanding(l, 12) === 0);
  assert.ok(Math.abs(loanOutstanding(l, 6) - 51492) < 5);
});

test('loan ends and EMI is diverted to a goal', () => {
  const p = project(base({
    loans: [{ id: 1, name: 'Bike', emi: 5000, start_month: '2026-12', tenure_months: 3, divert_to: '7' }],
    goals: [{ id: 7, name: 'PC', monthly_amount: 1000, target_amount: null }],
  }));
  assert.equal(at(p, '2027-01').emi, 5000);
  assert.equal(at(p, '2027-02').emi, 5000);
  assert.equal(at(p, '2027-03').emi, 0);
  assert.ok(p.events.some((e) => e.type === 'loan_closed' && e.month === '2027-02'));
  assert.equal(at(p, '2027-03').contributions['7'], 6000);
});

test('reached goal diverts overflow and future contributions', () => {
  const p = project(base({ goals: [
    { id: 1, name: 'PC', monthly_amount: 30000, target_amount: 75000, on_complete: 'divert', divert_to: '2' },
    { id: 2, name: 'Bike', monthly_amount: 10000, target_amount: null },
  ] }));
  // Jan 30k, Feb 60k, Mar 75k (15k overflow → bike)
  assert.equal(at(p, '2027-03').balances['1'], 75000);
  assert.equal(at(p, '2027-03').contributions['2'], 25000);
  assert.equal(at(p, '2027-04').contributions['2'], 40000);
  assert.equal(at(p, '2027-04').balances['1'], 75000);
  assert.equal(p.goals.find((g) => g.id === '1').reachedMonth, '2027-03');
});

test('spend goal zeroes balance when reached; rest goes to free savings', () => {
  const p = project(base({ goals: [
    { id: 1, name: 'PC', monthly_amount: 50000, target_amount: 100000, on_complete: 'spend', divert_to: 'free' },
  ] }));
  assert.equal(at(p, '2027-02').balances['1'], 0);
  assert.ok(p.events.some((e) => e.type === 'goal_spent' && e.month === '2027-02'));
  assert.equal(at(p, '2027-03').contributions['1'], 0);
  assert.equal(at(p, '2027-03').freeFlow, 100000);
});

test('divert cycle between reached goals does not loop forever', () => {
  const p = project(base({ goals: [
    { id: 1, name: 'A', monthly_amount: 10000, target_amount: 10000, divert_to: '2' },
    { id: 2, name: 'B', monthly_amount: 10000, target_amount: 10000, divert_to: '1' },
  ] }));
  assert.equal(at(p, '2027-02').toGoals, 0);
  assert.equal(at(p, '2027-02').freeFlow, 100000);
});

test('shortfall is flagged', () => {
  const p = project(base({ expenses: [{ id: 1, name: 'Big', amount: 120000, one_off: 0 }] }));
  assert.ok(p.events.some((e) => e.type === 'shortfall'));
  assert.equal(at(p, '2027-01').freeFlow, -20000);
});

test('bonus routed to a goal', () => {
  const p = project(base({
    bonuses: [{ id: 1, month: '2027-02', amount: 40000, target: '3' }],
    goals: [{ id: 3, name: 'EF', monthly_amount: 0, target_amount: null }],
  }));
  assert.equal(at(p, '2027-02').contributions['3'], 40000);
  assert.equal(at(p, '2027-02').freeFlow, 100000);
});

test('month allocation adds to the goal and comes out of left over', () => {
  const p = project(base({
    goals: [{ id: 5, name: 'PC', monthly_amount: 1000, target_amount: null }],
    allocations: [{ id: 1, month: '2027-03', goal_id: '5', amount: 20000 }],
  }));
  assert.equal(at(p, '2027-03').contributions['5'], 21000);
  assert.equal(at(p, '2027-03').lumpContributions['5'], 20000);
  assert.equal(at(p, '2027-03').freeFlow, 79000);
  assert.equal(at(p, '2027-04').balances['5'], 24000);
  assert.equal(at(p, '2027-03').allocItems.length, 1);
});

test('goal with no monthly amount only grows from allocations', () => {
  const p = project(base({
    goals: [{ id: 1, name: 'Bike', monthly_amount: null, target_amount: 30000, on_complete: 'divert', divert_to: 'free' }],
    allocations: [{ id: 1, month: '2027-02', goal_id: '1', amount: 25000 }, { id: 2, month: '2027-05', goal_id: '1', amount: 10000 }],
  }));
  assert.equal(at(p, '2027-01').balances['1'], 0);
  assert.equal(at(p, '2027-02').balances['1'], 25000);
  // only 5,000 fits; rest spills to free savings
  assert.equal(at(p, '2027-05').balances['1'], 30000);
  assert.equal(at(p, '2027-05').freeFlow, 95000);
  assert.equal(p.goals[0].reachedMonth, '2027-05');
});
