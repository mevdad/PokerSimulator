#!/usr/bin/env node
'use strict';
// Перебор вариантов «компания vs игроки» из консоли.
// Пример: node scripts/scenarios.js --company 50,100,200 --players 100,200 --max-team 1,2,3 --tables 3 --hands 30000 --repeats 2
const fs = require('fs');
const NS = require('../src/index.js');
require('../src/experiments.js');
const E = NS.Experiments;

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true; else { args[a.slice(2)] = next; i++; }
  }
}
if (args.help) {
  console.log(`Параметры:
  --company L     боты компании, список через запятую (200)
  --players L     игроки (200)
  --max-team L    макс. ботов компании за столом (2)
  --tables L      число столов (3)
  --seats N       мест за столом (6)
  --hands N       раздач на один прогон (30000)
  --repeats N     повторов с разными seed (1)
  --target X      целевая доля компании, % (3)
  --flow turnover|drop   что считать потоком денег игроков (turnover)
  --rake X        рейк, % (0)       --no-evo  без обучения      --seed N
  --csv FILE      сохранить таблицу в CSV`);
  process.exit(0);
}
const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);
const o = {
  companies: E.parseList(args.company, [200]), players: E.parseList(args.players, [200]),
  maxTeams: E.parseList(args['max-team'], [2]), tables: E.parseList(args.tables, [3]),
  repeats: Math.max(1, num('repeats', 1)), seed: num('seed', 1),
};
const hands = num('hands', 30000);
const target = num('target', 3) / 100;
const flow = args.flow === 'drop' ? 'drop' : 'turnover';
const base = { seats: num('seats', 6), rakePct: num('rake', 0) / 100, evolution: !args['no-evo'] };
const scenarios = E.buildScenarios(o);
console.log(`Сценариев: ${scenarios.length} × ${hands} раздач (${o.repeats} повтор(а)). Цель: ${(target * 100).toFixed(1)}% от ${flow === 'drop' ? 'закупок' : 'оборота'} игроков\n`);

const runner = new E.Runner(scenarios, hands, base);
const t0 = Date.now();
let lastDone = 0;
while (runner.step(300)) {
  if (runner.results.length !== lastDone) {
    lastDone = runner.results.length;
    process.stdout.write(`\r  выполнено ${lastDone}/${scenarios.length}  (${((Date.now() - t0) / 1000).toFixed(0)} с)   `);
  }
}
console.log(`\r  выполнено ${scenarios.length}/${scenarios.length}  (${((Date.now() - t0) / 1000).toFixed(0)} с)\n`);

const rows = E.aggregate(runner.results);
const key = flow === 'drop' ? 'holdD' : 'holdT';
rows.sort((a, b) => Math.abs(a[key] - target) - Math.abs(b[key] - target));
const pc = (x, d) => (Number.isFinite(x) ? (x * 100).toFixed(d === undefined ? 2 : d) + '%' : '—');
const padl = (s, n) => String(s).padStart(n);
console.log(' столы макс/стол  компания игроки   доля(обор.)  95% ДИ / sd        доля(закуп.)  bb/100 комп.  bb/100 игр.  прибыль $   в плюсе');
for (const r of rows) {
  const spread = r.n > 1 ? `±${pc(r.holdTsd)} (sd)` : `[${pc(r.loT, 1)}…${pc(r.hiT, 1)}]`;
  const hit = Number.isFinite(r.loT) && r.n === 1 ? (target >= r.loT && target <= r.hiT ? ' ✓' : '  ') : '  ';
  console.log(`${padl(r.tables, 5)}${padl(r.maxTeam, 10)}${padl(r.company, 11)}${padl(r.players, 8)}   ${padl(pc(r.holdT), 9)}  ${padl(spread, 18)}${hit}  ${padl(pc(r.holdD, 1), 9)}  ${padl(r.bbC.toFixed(1), 12)}  ${padl(r.bbP.toFixed(1), 11)}  ${padl(r.profitC.toFixed(0), 9)}  ${padl((r.winC * 100).toFixed(0) + '%', 7)}`);
}
console.log('\nСтроки отсортированы по близости к цели. ✓ — цель попала в 95% ДИ данного прогона.');
if (args.csv && args.csv !== true) { fs.writeFileSync(args.csv, E.toCsv(rows)); console.log('CSV сохранён:', args.csv); }
