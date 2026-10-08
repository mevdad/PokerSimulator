(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // Геном = набор параметров стратегии. Значения по умолчанию - ABC/TAG-покер из статьи:
  // тайт с ранних позиций, шире на баттоне, value-рейзы сильными руками, логичные блефы.
  // key, подпись, min, max, значение по умолчанию (TAG), группа
  const GENE_DEFS = [
    ['openBase', 'Открытие с UTG (доля рук)', 0.04, 0.45, 0.13, 'Префлоп'],
    ['posSlope', 'Расширение к баттону', 0.0, 0.45, 0.22, 'Префлоп'],
    ['openSize', 'Размер открытия (ББ)', 2.0, 4.5, 2.7, 'Префлоп'],
    ['limpFreq', 'Частота лимпа', 0.0, 0.8, 0.02, 'Префлоп'],
    ['threeBet', '3-бет на value (доля рук)', 0.01, 0.16, 0.045, 'Префлоп'],
    ['threeBetBluff', '3-бет блеф (частота)', 0.0, 0.5, 0.08, 'Префлоп'],
    ['callRaise', 'Колл рейза (доля рук)', 0.02, 0.45, 0.14, 'Префлоп'],
    ['callPosBonus', 'Бонус колла в позиции/BB', 0.0, 0.3, 0.08, 'Префлоп'],
    ['fourBet', '4-бет (доля рук)', 0.005, 0.07, 0.02, 'Префлоп'],
    ['shoveStack', 'Push/fold ниже (ББ)', 5, 25, 12, 'Префлоп'],

    ['cbet', 'C-bet на флопе', 0.1, 1.0, 0.6, 'Постфлоп'],
    ['valueBet', 'Порог эквити для value-бета', 0.5, 0.85, 0.64, 'Постфлоп'],
    ['raiseEq', 'Порог эквити для рейза', 0.65, 0.97, 0.82, 'Постфлоп'],
    ['betSize', 'Размер бета (доля банка)', 0.3, 1.2, 0.6, 'Постфлоп'],
    ['bigBetSize', 'Размер большого бета', 0.6, 2.0, 0.95, 'Постфлоп'],
    ['callMargin', 'Запас к пот-оддсам при колле', -0.08, 0.15, 0.02, 'Постфлоп'],
    ['bluff', 'Частота блефа', 0.0, 0.5, 0.12, 'Постфлоп'],
    ['semiBluff', 'Частота полу-блефа (дро)', 0.0, 0.9, 0.35, 'Постфлоп'],
    ['checkRaise', 'Чек-рейз / ловушка', 0.0, 0.5, 0.12, 'Постфлоп'],
    ['slowplay', 'Слоуплей в позиции', 0.0, 0.5, 0.1, 'Постфлоп'],
    ['multiwayCaution', 'Осторожность в мультипоте', 0.0, 0.15, 0.05, 'Постфлоп'],
    ['exploit', 'Использование HUD оппонентов', 0.0, 1.0, 0.6, 'Адаптация'],
    ['noise', 'Случайность решений', 0.0, 0.2, 0.03, 'Адаптация'],

    ['buyIn', 'Закупка (ББ)', 20, 200, 100, 'Банкролл'],
    ['sessionLen', 'Рук до перерыва', 50, 600, 250, 'Банкролл'],
    ['stopLoss', 'Стоп-лосс сессии (ББ)', 20, 150, 70, 'Банкролл'],
    ['stopWin', 'Стоп-вин сессии (ББ)', 30, 400, 200, 'Банкролл'],
    ['tableSel', 'Разборчивость в выборе стола', 0.0, 1.0, 0.5, 'Банкролл'],
  ];

  const GENES = {};
  const GENE_KEYS = [];
  for (const [key, label, min, max, def, group] of GENE_DEFS) {
    GENES[key] = { key, label, min, max, def, group };
    GENE_KEYS.push(key);
  }

  const clampGene = (k, v) => Math.min(GENES[k].max, Math.max(GENES[k].min, v));

  function defaultGenome() {
    const g = {};
    for (const k of GENE_KEYS) g[k] = GENES[k].def;
    return g;
  }

  // Архетипы. EVO - стартовая точка для эволюционирующих ботов (с большим разбросом вокруг TAG).
  const ARCHETYPES = {
    TAG: { label: 'TAG (ABC)', ov: {} },
    NIT: {
      label: 'Нит',
      ov: { openBase: 0.07, posSlope: 0.10, threeBet: 0.025, callRaise: 0.06, callPosBonus: 0.03, bluff: 0.02, semiBluff: 0.15, cbet: 0.6, valueBet: 0.7, buyIn: 100, limpFreq: 0 },
    },
    LAG: {
      label: 'LAG',
      ov: { openBase: 0.20, posSlope: 0.28, openSize: 3.0, threeBet: 0.08, threeBetBluff: 0.25, callRaise: 0.2, cbet: 0.75, bluff: 0.28, semiBluff: 0.65, betSize: 0.7, valueBet: 0.58, raiseEq: 0.78, callMargin: 0.0, buyIn: 100 },
    },
    FISH: {
      label: 'Рыба (станция)',
      ov: { openBase: 0.13, posSlope: 0.12, limpFreq: 0.6, openSize: 2.2, threeBet: 0.02, threeBetBluff: 0, callRaise: 0.38, callPosBonus: 0.12, fourBet: 0.012, cbet: 0.3, valueBet: 0.72, raiseEq: 0.93, betSize: 0.4, bluff: 0.02, semiBluff: 0.1, callMargin: -0.07, exploit: 0.0, multiwayCaution: 0.0, tableSel: 0.0, stopLoss: 150, sessionLen: 500 },
    },
    MANIAC: {
      label: 'Маньяк',
      ov: { openBase: 0.42, posSlope: 0.30, openSize: 3.5, threeBet: 0.13, threeBetBluff: 0.5, callRaise: 0.22, cbet: 0.95, bluff: 0.5, semiBluff: 0.9, betSize: 1.0, bigBetSize: 1.5, valueBet: 0.5, raiseEq: 0.7, callMargin: 0.03, exploit: 0.1, tableSel: 0.0, stopLoss: 150 },
    },
    ROCK: {
      label: 'Пассивный рок',
      ov: { openBase: 0.10, posSlope: 0.05, limpFreq: 0.35, openSize: 2.2, threeBet: 0.03, callRaise: 0.08, cbet: 0.35, valueBet: 0.78, raiseEq: 0.95, betSize: 0.35, bluff: 0, semiBluff: 0.05, callMargin: 0.06, checkRaise: 0.02, slowplay: 0.03 },
    },
    EVO: { label: 'Эволюционер', ov: {} },
    ELITE: { label: 'Сильный (эволюц.)', ov: {} },
  };

  function makeGenome(arch, rng, noise) {
    const g = defaultGenome();
    const ov = (ARCHETYPES[arch] || ARCHETYPES.TAG).ov;
    for (const k in ov) g[k] = ov[k];
    if (noise > 0) {
      for (const k of GENE_KEYS) {
        const d = GENES[k];
        g[k] = clampGene(k, g[k] + rng.gauss() * noise * (d.max - d.min));
      }
    }
    return g;
  }

  // Мутация: каждый ген с вероятностью `rate` сдвигается на гауссов шум (sigma - доля диапазона гена).
  function mutate(genome, rng, rate, sigma) {
    const g = Object.assign({}, genome);
    let changed = 0;
    for (const k of GENE_KEYS) {
      if (rng.next() < rate) {
        const d = GENES[k];
        g[k] = clampGene(k, g[k] + rng.gauss() * sigma * (d.max - d.min));
        changed++;
      }
    }
    if (!changed) { // хотя бы один ген должен измениться
      const k = rng.pick(GENE_KEYS), d = GENES[k];
      g[k] = clampGene(k, g[k] + rng.gauss() * sigma * (d.max - d.min));
    }
    return g;
  }

  function crossover(a, b, rng) {
    const g = {};
    for (const k of GENE_KEYS) g[k] = rng.next() < 0.5 ? a[k] : b[k];
    return g;
  }

  // Тип стратегии по размеру стека из статьи: SSS (20-40 ББ), MSS (~40-75), BSS (100+).
  function stackStrategy(genome) {
    const b = genome.buyIn;
    return b <= 40 ? 'SSS' : b < 80 ? 'MSS' : 'BSS';
  }

  NS.Genome = { GENES, GENE_KEYS, ARCHETYPES, defaultGenome, makeGenome, mutate, crossover, clampGene, stackStrategy };
})(typeof globalThis !== 'undefined' ? globalThis : window);
