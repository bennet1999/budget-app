# Budget Planner

A month-by-month personal finance planner. It's an installable, offline-first app: all data lives in the browser on the device you use it on (never sent anywhere). Installed on a phone it's a standalone app with its own icon.

```bash
npm install     # once
npm start       # static host for the app at http://localhost:4321   (PORT=xxxx to change)
npm test        # projection engine tests
```

- **Plan** tab: salary, appraisals, bonuses, expenses, loans/EMIs, savings goals (only a name is required). Everything autosaves; deletes can be undone.
- **Dashboard**: savings over time, where each month's pay goes, goal ETAs, timeline of events.
- **Calendar**: switch years, open any month to add one-off expenses, extra income, or extra money for a goal that month.
- **Table**: every month in one table; click a row for the breakdown.
- `⋯` menu: export/import a JSON backup, load the example plan, or clear everything.

How money flows: whatever isn't spent, paid as EMI or put into a goal lands in **Free savings**.
When a goal with a target is reached, its monthly amount (and any overflow) moves to the goal you pick
("Then send monthly to"); "Buy it" goals are spent that month. When a loan ends, its EMI goes where you choose.

## Install on Android
1. Host the `public/` folder over HTTPS (any static host: GitHub Pages, Netlify, Cloudflare Pages…). It contains only code — no data.
2. Open the URL in Chrome on the phone → ⋮ menu → **Install app**. It now runs offline as its own app.
3. Move existing data: on the old setup use `⋯ → Export backup`, then `⋯ → Import backup` in the phone app.

Data is per-device (browser storage); use export/import to back up or move it. The old `data/budget.db` is no longer used.
