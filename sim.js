#!/usr/bin/env node
'use strict';
// Консольный запуск без интерфейса: node sim.js --hands 50000 --bots 200 --tables 3 --seats 6
const NS = require('./src/index.js');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[k] = true;
    else { args[k] = next; i++; }
  }
}
const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);

if (args.help) {
  console.log(`Параметры:
  --hands N      сколько раздач сыграть (по умолч. 20000)
  --bots N       количество ботов (200)
  --tables N     количество столов (3)
  --seats N      игроков за столом, 2..10 (6)
  --sb X --bb X  блайнды в долларах (0.25 / 0.5)
  --rake X       рейк, % (3)
  --seed N       seed для воспроизводимости
  --fixed X      доля ботов с фиксированным стилем (0.25)
  --versus       режим «команда компании vs игроки со случайными seed»
  --players N    сколько игроков (200)         --max-team N  макс. ботов компании за столом (2)
  --seeds FILE   стартовые геномы компании (data/company-seed.json); --no-seeds — без них
  --no-evo       выключить обучение
  --gen N        раздач на поколение (4000)
  --top N        сколько строк рейтинга печатать (15)`);
  process.exit(0);
}

const cfg = {
  bots: num('bots', 200), tables: num('tables', 3), seats: num('seats', 6),
  sb: Math.round(num('sb', 0.25) * 100), bb: Math.round(num('bb', 0.5) * 100),
  rakePct: num('rake', args.versus ? 0 : 3) / 100, fixedShare: num('fixed', 0.25),
  mode: args.versus ? 'versus' : 'solo', players: num('players', 200), maxTeamPerTable: num('max-team', 2),
  evolution: !args['no-evo'], genHands: num("gen", 4000),
  seed: args.seed !== undefined ? Number(args.seed) : undefined,
};
if (args.seeds && args.seeds !== true) cfg.companySeeds = require('fs').existsSync(args.seeds) ? JSON.parse(require('fs').readFileSync(args.seeds, 'utf8')).genomes : [];
if (args['no-seeds']) cfg.companySeeds = [];
const hands = num('hands', 20000);
const sim = new NS.Simulation(cfg);
if (args['no-seeds']) NS.COMPANY_SEEDS = [];
console.log(`Старт: ${cfg.bots} ботов${cfg.mode === 'versus' ? ' компании + ' + cfg.players + ' игроков' : ''}, ${cfg.tables} стола(ов) по ${cfg.seats} мест, NL${cfg.bb / 100 * 100} ($${cfg.sb / 100}/$${cfg.bb / 100}), seed=${sim.cfg.seed}`);

const t0 = Date.now();
let lastPrint = 0;
while (sim.totalHands < hands) {
  sim.runFor(200);
  if (Date.now() - lastPrint > 2000) {
    lastPrint = Date.now();
    process.stdout.write(`\r  раздач: ${sim.totalHands}/${hands}  поколение: ${sim.generation}   `);
  }
}
const sec = (Date.now() - t0) / 1000;
console.log(`\nСыграно ${sim.totalHands} раздач за ${sec.toFixed(1)} c (${Math.round(sim.totalHands / sec)} раздач/с)\n`);

const rows = sim.ranking().sort((a, b) => b.profit - a.profit);
const top = num('top', 15);
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const line = (i, r) => `${padl(i, 3)} ${pad(r.name, 18)} ${pad(r.archLabel, 15)} ${pad(r.style, 15)} ${pad(r.strategy, 4)} ${padl(r.profit.toFixed(2), 9)} ${padl(r.bb100.toFixed(1), 8)} ${padl(r.hands, 6)}  ${(r.vpip * 100).toFixed(0).padStart(3)}/${(r.pfr * 100).toFixed(0).padEnd(3)} g${r.gen}`;
console.log('  #  Имя                Архетип         Стиль (HUD)     Стек   Прибыль$   bb/100  Рук    VPIP/PFR');
rows.slice(0, top).forEach((r, i) => console.log(line(i + 1, r)));
console.log('  ...');
rows.slice(-5).forEach((r, i) => console.log(line(rows.length - 4 + i, r)));

// агрегаты по архетипам
const agg = {};
for (const r of rows) {
  const k = r.fixed ? r.archLabel : 'Эволюционеры';
  const a = agg[k] || (agg[k] = { n: 0, profit: 0, hands: 0, vpip: 0, pfr: 0 });
  a.n++; a.profit += r.profit; a.hands += r.hands; a.vpip += r.vpip; a.pfr += r.pfr;
}
console.log('\nИтоги по группам (средний результат на бота):');
for (const [k, a] of Object.entries(agg)) {
  const bbh = a.hands ? (a.profit * 100 / sim.cfg.bb) / a.hands * 100 : 0;
  console.log(`  ${pad(k, 16)} ботов ${padl(a.n, 3)}  прибыль/бот $${(a.profit / a.n).toFixed(2).padStart(8)}  ≈${bbh.toFixed(1).padStart(6)} bb/100  VPIP/PFR ${(a.vpip / a.n * 100).toFixed(0)}/${(a.pfr / a.n * 100).toFixed(0)}`);
}
const tot = sim.totals();
console.log(`\nРейк собран: $${tot.rake.toFixed(2)}, поколений обучения: ${tot.generation}`);
if (sim.evoLog.length > 1) {
  const f = sim.evoLog[0], l = sim.evoLog[sim.evoLog.length - 1];
  console.log(`Эволюция: VPIP ${(f.vpip * 100).toFixed(1)}% -> ${(l.vpip * 100).toFixed(1)}%, PFR ${(f.pfr * 100).toFixed(1)}% -> ${(l.pfr * 100).toFixed(1)}%, блеф-ген ${f.bluff.toFixed(2)} -> ${l.bluff.toFixed(2)}`);
}

if (sim.versus) {
  const T = sim.teamStats();
  const m = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(0);
  console.log('\n=== Компания vs Игроки ===');
  for (const [k, lab] of [['company', 'Компания'], ['player', 'Игроки']]) {
    const t = T[k];
    console.log(`${pad(lab, 9)} ботов ${padl(t.n, 3)}  прибыль ${padl(m(t.profit), 8)}  ${padl(t.bb100.toFixed(1), 6)} bb/100  оборот ${padl(m(t.turnover), 9)}  закупки ${padl(m(t.drop), 8)}  рейк ${padl(m(t.rake), 6)}  VPIP/PFR ${(t.vpip * 100).toFixed(0)}/${(t.pfr * 100).toFixed(0)}  в плюсе ${(t.winShare * 100).toFixed(0)}%`);
  }
  for (const [d, lab] of [['turnover', 'от оборота игроков'], ['drop', 'от закупок игроков']]) {
    const h = sim.hold(d);
    const ci = Number.isFinite(h.lo) ? `  95% ДИ ${(h.lo * 100).toFixed(2)}% … ${(h.hi * 100).toFixed(2)}%` : '';
    console.log(`Доля компании ${pad(lab, 20)} ${(h.value * 100).toFixed(2)}%${ci}`);
  }
}
