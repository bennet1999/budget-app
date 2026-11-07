const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const inr = (n) => {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `−${inrFmt.format(-v)}` : inrFmt.format(v);
};
export const plainNum = (n) => numFmt.format(Math.round(Number(n) || 0));

// ₹45K · ₹1.25L · ₹2.4Cr
export const inrCompact = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const trim = (x) => String(Number(x.toFixed(x >= 10 ? 1 : 2)));
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
};

export const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;

export const monthLabel = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};
export const monthShort = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ’${y.slice(2)}`;
};
