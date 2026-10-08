'use strict';
const assert = require('assert');
const NS = require('../src/index.js');
const { Evaluator, Cards, Simulation, Table, RNG, Preflop } = NS;

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { console.error(`  ✗ ${name}\n${e.stack}`); process.exitCode = 1; }
}

const parse = (s) => s.split(' ').map((x) => {
  const r = Cards.RANKS.indexOf(x[0]), su = Cards.SUITS.indexOf(x[1]);
  return r * 4 + su;
});
const score = (s) => { const c = parse(s); return Evaluator.evaluate(c, c.length); };
const cat = (s) => Evaluator.categoryOf(score(s));

console.log('Оценщик рук');
test('категории комбинаций', () => {
  assert.strictEqual(cat('As Kd 9c 5h 3d 2c 7s'), 0);
  assert.strictEqual(cat('As Ad 9c 5h 3d 2c 7s'), 1);
  assert.strictEqual(cat('As Ad 9c 9h 3d 2c 7s'), 2);
  assert.strictEqual(cat('As Ad Ac 5h 3d 2c 7s'), 3);
  assert.strictEqual(cat('As 2d 3c 4h 5d 9c Ks'), 4);       // колесо
  assert.strictEqual(cat('9s 8d 7c 6h 5d 2c Ks'), 4);
  assert.strictEqual(cat('As Ks 9s 5s 3s 2c 7d'), 5);
  assert.strictEqual(cat('As Ad Ac 5h 5d 2c 7s'), 6);
  assert.strictEqual(cat('As Ad Ac Ah 5d 2c 7s'), 7);
  assert.strictEqual(cat('9s 8s 7s 6s 5s 2c Kd'), 8);
  assert.strictEqual(cat('As Ks Qs Js Ts 2c 3d'), 8);
});
test('сравнение внутри категории', () => {
  assert.ok(score('As Ad 9c 5h 3d 2c 7s') > score('Ks Kd 9c 5h 3d 2c 7s'));
  assert.ok(score('As Ad Kc 5h 3d 2c 7s') > score('As Ad Qc 5h 3d 2c 7s'));         // кикер
  assert.ok(score('As Ad Kc Kh 3d 2c 7s') > score('As Ad Qc Qh 3d 2c 7s'));
  assert.ok(score('6s 5d 4c 3h 2d 9c Ks') < score('7s 6d 5c 4h 3d 9c Ks'));         // колесо слабее
  assert.ok(score('As 2d 3c 4h 5d 9c Ks') < score('6s 2d 3c 4h 5d 9c Ks'));
  assert.ok(score('Ks Kd Kc 2h 2d 9c 7s') > score('Qs Qd Qc Ah Ad 9c 7s'));         // фулл-хаус
  assert.strictEqual(score('As Kd Qc Jh 9d 2c 3s'), score('As Kd Qc Jh 9s 2h 3d'));  // ничья
  assert.strictEqual(score('As Ad Ac 5h 5d 2c 2s'), score('As Ad Ac 5h 5s 5c 2s'));   // AAA55 в обоих случаях
});
test('два сета: фулл-хаус берёт старшую пару из младшего сета', () => {
  assert.strictEqual(cat('Ks Kd Kc 9h 9d 9c 2s'), 6);
  assert.strictEqual(score('Ks Kd Kc 9h 9d 9c 2s'), score('Kh Kd Kc 9s 9d 9c 3s'));
});

console.log('Префлоп-рейтинг');
test('AA сильнейшая, 72o слабейшая', () => {
  const p = (s) => { const c = parse(s); return Preflop.preflopPct(c[0], c[1]); };
  assert.ok(p('As Ad') < p('Ks Kd'));
  assert.ok(p('As Ks') < p('As Kd'));
  assert.ok(p('7s 2d') > 0.9);
  assert.ok(p('Ts 9s') < p('9s 2d'));
});

console.log('Движок стола');
function makeTable(stacks, cfg) {
  const base = Object.assign({ seats: stacks.length, sb: 25, bb: 50, rakePct: 0, rakeCap: 0, minBuyBB: 20, maxBuyBB: 100 }, cfg || {});
  const rng = new RNG(5);
  const bots = stacks.map((_, i) => new NS.Bot(i, 'B' + i, NS.Genome.makeGenome('TAG', rng, 0), 'TAG', true, new RNG(i + 1)));
  const t = new Table(0, base, new RNG(7), {});
  stacks.forEach((s, i) => t.sit(bots[i], i, s));
  return { t, bots };
}
test('сайд-поты: три олл-ина разного размера', () => {
  const { t, bots } = makeTable([1000, 3000, 6000]);
  // сами формируем состояние: committed и hole-карты
  t.board = parse('2c 7d 9h Js 3c');
  t.postOrder = [0, 1, 2];
  const hands = ['As Ad', 'Ks Kd', 'Qs Qd'];     // у #0 лучшая рука, у #2 худшая
  t.seats.forEach((s, i) => { s.inHand = true; s.folded = false; s.hole = parse(hands[i]); s.committed = [1000, 3000, 6000][i]; s.stack = 0; });
  t.pot = 10000; t.handNo = 1; t.phase = 'showdown';
  t.showdown();
  assert.strictEqual(t.seats[0].win, 3000);   // основной банк 3*1000
  assert.strictEqual(t.seats[1].win, 4000);   // сайд-пот 2*2000
  assert.strictEqual(t.seats[2].win, 3000);   // возврат неуравненной ставки
  assert.strictEqual(t.seats.reduce((a, s) => a + s.win, 0), 10000);
});
test('разделённый банк и рейк', () => {
  const { t } = makeTable([5000, 5000], { rakePct: 0.05, rakeCap: 150 });
  t.board = parse('Ac Kd Qh Js Tc');   // борд-стрит: ничья
  t.postOrder = [0, 1]; t.flopSeen = true;
  t.seats.forEach((s, i) => { s.inHand = true; s.folded = false; s.hole = parse(i ? '2s 3d' : '4s 5d'); s.committed = 2000; s.stack = 3000; });
  t.pot = 4000; t.handNo = 1; t.showdown();
  assert.strictEqual(t.lastHand.rake, 150);
  assert.strictEqual(t.seats[0].win + t.seats[1].win, 4000 - 150);
});
test('игра heads-up идёт до конца без ошибок', () => {
  const { t } = makeTable([5000, 5000]);
  for (let i = 0; i < 20000 && t.handNo < 300; i++) t.step();
  assert.ok(t.handNo >= 300);
  const total = t.seats.reduce((a, s) => a + s.stack, 0) + t.pot;
  assert.ok(total >= 0);
});

console.log('Симуляция');
function conservation(sim) {
  let profit = 0, rake = 0;
  for (const b of sim.bots) profit += b.profit;
  for (const t of sim.tables) rake += t.rakeTotal;
  return { profit, rake };
}
test('фишки сохраняются: сумма прибылей = -рейк', () => {
  const sim = new Simulation({ bots: 40, tables: 3, seats: 6, seed: 11, debug: true, genHands: 400 });
  sim.runHands(1500);
  // доиграем текущие раздачи до конца, чтобы не было "висящих" ставок
  const { profit, rake } = conservation(sim);
  let inPlay = 0;
  for (const t of sim.tables) if (t.phase === 'betting' || t.phase === 'dealing' || t.phase === 'showdown') {
    for (const s of t.seats) if (s && s.inHand) inPlay += s.committed;
  }
  assert.ok(Math.abs(profit + rake + inPlay) < 1e-6, `profit=${profit} rake=${rake} inPlay=${inPlay}`);
  assert.ok(sim.totalHands >= 1500);
});
test('разные размеры столов: 2, 3, 9 игроков', () => {
  for (const seats of [2, 3, 9]) {
    const sim = new Simulation({ bots: 30, tables: 2, seats, seed: 3 + seats, debug: true });
    sim.runHands(300);
    assert.ok(sim.totalHands >= 300, 'seats=' + seats);
  }
});
test('детерминизм: один seed - один результат', () => {
  const run = () => {
    const sim = new Simulation({ bots: 30, tables: 2, seats: 6, seed: 99 });
    sim.runHands(400);
    return sim.bots.map((b) => b.profit).join(',');
  };
  assert.strictEqual(run(), run());
});
test('эволюция запускается и меняет гены слабых ботов', () => {
  const sim = new Simulation({ bots: 60, tables: 3, seats: 6, seed: 5, genHands: 500, minWindowHands: 30 });
  sim.runHands(3000);
  assert.ok(sim.generation >= 1, 'поколений: ' + sim.generation);
  assert.ok(sim.bots.some((b) => b.generation > 0));
});

console.log('Режим «Компания vs Игроки»');
test('составы, лимит ботов компании за столом, сохранение денег', () => {
  const sim = new Simulation({ mode: 'versus', bots: 40, players: 40, maxTeamPerTable: 2, tables: 3, seats: 6, seed: 21, debug: true, genHands: 600, minWindowHands: 30 });
  assert.strictEqual(sim.bots.filter((b) => b.team === 'company').length, 40);
  assert.strictEqual(sim.bots.filter((b) => b.team === 'player').length, 40);
  assert.ok(sim.bots.filter((b) => b.team === 'player').every((b) => b.fixed && b.seed > 0));
  assert.strictEqual(sim.cfg.rakePct, 0);
  let maxC = 0;
  for (let i = 0; i < 40000 && sim.totalHands < 2500; i++) {
    for (const t of sim.tables) {
      t.step();
      const c = t.seats.filter((s) => s && s.bot.team === 'company').length;
      if (c > maxC) maxC = c;
    }
  }
  assert.ok(sim.totalHands >= 2500);
  assert.ok(maxC <= 2, 'за столом было ботов компании: ' + maxC);
  const T = sim.teamTotals();
  let inPlay = 0;
  for (const t of sim.tables) if (t.phase === 'betting' || t.phase === 'dealing' || t.phase === 'showdown') for (const s of t.seats) if (s && s.inHand) inPlay += s.committed;
  // без рейка то, что выиграла компания, проиграли игроки (с точностью до фишек в играющихся раздачах)
  assert.ok(Math.abs(T.company.profit + T.player.profit) * 100 <= inPlay + 1, `c=${T.company.profit} p=${T.player.profit} inPlay=${inPlay}`);
  const h = sim.hold('turnover');
  assert.ok(Number.isFinite(h.value) && h.flow > 0);
  assert.ok(sim.generation >= 1 && sim.bots.filter((b) => b.team === 'player').every((b) => b.generation === 0), 'учатся только боты компании');
});
test('одни и те же seed игроков дают тот же состав', () => {
  const a = new Simulation({ mode: 'versus', bots: 10, players: 30, seed: 8 }), b = new Simulation({ mode: 'versus', bots: 10, players: 30, seed: 8 });
  assert.strictEqual(a.bots.map((x) => x.seed + x.archetype).join(), b.bots.map((x) => x.seed + x.archetype).join());
});

test('профили игроков: regs без рыб и маньяков, elite с сильными геномами', () => {
  const regs = new Simulation({ mode: 'versus', bots: 10, players: 60, playerProfile: 'regs', seed: 4 });
  const arch = new Set(regs.bots.filter((b) => b.team === 'player').map((b) => b.archetype));
  assert.ok(!arch.has('FISH') && !arch.has('MANIAC'), 'в regs есть слабые архетипы: ' + [...arch]);
  const elite = new Simulation({ mode: 'versus', bots: 10, players: 20, playerProfile: 'elite', seed: 4 });
  assert.ok(elite.bots.filter((b) => b.team === 'player').every((b) => b.archetype === 'ELITE'));
  elite.runHands(300);
  assert.ok(elite.totalHands >= 300);
});
test('улучшения логики включены только у компании', () => {
  const sim = new Simulation({ mode: 'versus', bots: 5, players: 5, seed: 2 });
  assert.ok(sim.bots.filter((b) => b.team === 'company').every((b) => b.tune.shortHanded && b.tune.exploit2));
  assert.ok(sim.bots.filter((b) => b.team === 'player').every((b) => !b.tune.shortHanded));
});

console.log(`\nПройдено тестов: ${passed}`);
