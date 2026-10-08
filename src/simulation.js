(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { RNG, Table, Bot, Genome, generateNames, styleLabel } = NS;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const DEFAULTS = {
    bots: 200,
    tables: 3,
    seats: 6,
    sb: 25,                 // центы: $0.25
    bb: 50,                 // центы: $0.50
    minBuyBB: 20,
    maxBuyBB: 100,
    rakePct: 0.03,
    rakeCapBB: 3,
    fixedShare: 0.25,       // доля ботов с фиксированным архетипом (рыба, маньяк, нит ...)
    evolution: true,
    genHands: 4000,         // раз в сколько раздач (всего) происходит обучение
    learnShare: 0.15,        // какая доля худших ботов перенимает стиль лучших
    mutationRate: 0.35,
    mutationSigma: 0.08,
    minWindowHands: 250,
    snapshotEvery: 250,
    seed: undefined,
    debug: false,
  };

  // состав фиксированных ботов ("рыбы" и разные типы для эксплуатации)
  const FIXED_MIX = [['FISH', 0.32], ['NIT', 0.18], ['MANIAC', 0.12], ['ROCK', 0.14], ['LAG', 0.1], ['TAG', 0.14]];

  class Simulation {
    constructor(cfg) {
      this.cfg = Object.assign({}, DEFAULTS, cfg || {});
      const c = this.cfg;
      c.rakeCap = Math.round(c.rakeCapBB * c.bb);
      this.rng = new RNG(c.seed);
      this.cfg.seed = this.rng.seed;
      this.totalHands = 0;
      this.generation = 0;
      this.events = [];
      this.history = [];            // снимки прибыли всех ботов
      this.evoLog = [];             // снимки средних показателей популяции
      this.createBots();
      this.waiting = this.bots.slice();
      this.rng.shuffle(this.waiting);
      this.waiting.forEach((b) => { b.waitSince = 0; });
      this.tables = [];
      for (let i = 0; i < c.tables; i++) {
        this.tables.push(new Table(i, c, new RNG((this.rng.seed + 1013 * (i + 1)) >>> 0), {
          beforeHand: (t) => this.beforeHand(t),
          afterHand: (t, info) => this.afterHand(t, info),
        }));
      }
      this.snapshot();
    }

    createBots() {
      const c = this.cfg, rng = this.rng;
      const names = generateNames(c.bots, rng);
      this.bots = [];
      const nFixed = Math.round(c.bots * c.fixedShare);
      const ids = this.rng.shuffle(Array.from({ length: c.bots }, (_, i) => i));
      const fixedSet = new Set(ids.slice(0, nFixed));
      const fixedArch = [];
      for (const [a, share] of FIXED_MIX) {
        const k = Math.round(nFixed * share);
        for (let i = 0; i < k; i++) fixedArch.push(a);
      }
      while (fixedArch.length < nFixed) fixedArch.push('FISH');
      rng.shuffle(fixedArch);
      let fi = 0;
      for (let i = 0; i < c.bots; i++) {
        let arch, genome, fixed = false;
        if (fixedSet.has(i)) {
          arch = fixedArch[fi++]; fixed = true;
          genome = Genome.makeGenome(arch, rng, 0.05);
        } else {
          // эволюционеры стартуют из разных точек: чаще вокруг TAG, иногда вокруг других стилей
          const base = rng.chance(0.55) ? 'TAG' : rng.pick(['NIT', 'LAG', 'FISH', 'ROCK', 'MANIAC']);
          arch = 'EVO';
          genome = Genome.makeGenome(base, rng, 0.14);
        }
        genome.buyIn = clamp(genome.buyIn, c.minBuyBB, c.maxBuyBB);
        const bot = new Bot(i, names[i], genome, arch, fixed, new RNG((rng.seed ^ Math.imul(i + 1, 2654435761)) >>> 0));
        this.bots.push(bot);
      }
    }

    // -------------------------------------------------------- события
    addEvent(text, type, tableId) {
      this.events.push({ hand: this.totalHands, text, type: type || 'info', table: tableId });
      if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    }

    // ------------------------------------------- рассадка и выбор стола
    // "слабость" игрока в глазах остальных: широкий VPIP и убыточность = рыба
    weakness(bot) {
      const s = bot.stats;
      return clamp((s.vpipPct - 0.27) / 0.25, -1, 1) * 0.5 + clamp(-bot.bb100 / 50, -1, 1) * 0.5;
    }

    tableScore(table) {
      let sum = 0, n = 0;
      for (const s of table.seats) if (s) { sum += this.weakness(s.bot); n++; }
      return n ? sum / n : 0.1;
    }

    buyInCents(bot) {
      const c = this.cfg;
      return Math.round(clamp(bot.genome.buyIn, c.minBuyBB, c.maxBuyBB) * c.bb);
    }

    leave(table, seat, reason) {
      const bot = seat.bot;
      table.unsit(seat.idx);
      bot.waitSince = this.totalHands;
      bot.cooldown = this.totalHands + (this.waiting.length > 8 ? 0 : 10 + this.rng.int(40));
      this.waiting.push(bot);
    }

    beforeHand(table) {
      const c = this.cfg;
      for (const seat of table.seats) {
        if (!seat) continue;
        const bot = seat.bot, g = bot.genome;
        const sessBB = (bot.profit - bot.session.startProfit) / c.bb;
        let leave = null;
        if (bot.session.hands >= g.sessionLen) leave = 'time';
        else if (sessBB <= -g.stopLoss) leave = 'stoploss';
        else if (sessBB >= g.stopWin) leave = 'stopwin';
        else if (bot.session.hands > 40 && this.rng.chance(0.004) && this.tableScore(table) < (g.tableSel - 0.5) * 0.6 - 0.15) leave = 'table';
        if (leave) { this.leave(table, seat, leave); continue; }
        const target = this.buyInCents(bot);
        const minBuy = Math.max(c.minBuyBB, 0.3 * g.buyIn) * c.bb;
        if (seat.stack < minBuy) table.addChips(seat, target - seat.stack);
      }
      this.fillSeats(table);
    }

    fillSeats(table) {
      const free = table.freeSeatIndexes();
      if (!free.length || !this.waiting.length) return;
      const score = this.tableScore(table);
      for (const idx of free) {
        if (!this.waiting.length) break;
        const needPlayers = table.occupied() < 2;
        let pick = -1;
        const limit = Math.min(this.waiting.length, 80);
        for (let i = 0; i < limit; i++) {
          const b = this.waiting[i];
          if (b.cooldown > this.totalHands) continue;
          if (needPlayers) { pick = i; break; }
          const waited = this.totalHands - b.waitSince;
          const thr = (b.genome.tableSel - 0.5) * 0.6 - waited / 400;
          if (score >= thr) { pick = i; break; }
        }
        if (pick < 0) break;
        const bot = this.waiting.splice(pick, 1)[0];
        table.sit(bot, idx, this.buyInCents(bot));
        bot.session = { hands: 0, startProfit: bot.profit };
      }
    }

    // ----------------------------------------------- после каждой раздачи
    afterHand(table, info) {
      this.totalHands++;
      const bb = this.cfg.bb;
      if (info.pot >= 60 * bb) {
        const w = info.winners[0];
        if (w) this.addEvent(`Стол ${table.id + 1}: ${w.name} забирает банк ${table.money(info.pot)}${w.hand ? ' (' + w.hand + ')' : ''}`, 'bigpot', table.id);
      }
      if (this.totalHands % this.cfg.snapshotEvery === 0) this.snapshot();
      if (this.cfg.evolution && this.totalHands % this.cfg.genHands === 0) this.evolve();
    }

    snapshot() {
      this.history.push({ h: this.totalHands, p: Float32Array.from(this.bots, (b) => b.profit / 100) });
      if (this.history.length > 400) this.history = this.history.filter((_, i) => i % 2 === 0 || i === this.history.length - 1);
    }

    // --------------------------------------------------------- эволюция
    // Окно оценки: bb/100 со сжатием к нулю. Худшие боты переписывают гены, смешивая двух лучших + мутация.
    evolve() {
      const c = this.cfg, rng = this.rng;
      const evo = this.bots.filter((b) => !b.fixed && b.window.hands >= c.minWindowHands);
      const score = (b) => (100 * b.window.netBB) / (b.window.hands + 300);
      if (evo.length < 8) return;
      evo.sort((a, b) => score(b) - score(a));
      const nTop = Math.max(2, Math.round(evo.length * 0.2));
      const nLearn = Math.max(1, Math.round(evo.length * c.learnShare));
      const top = evo.slice(0, nTop);
      const learners = evo.slice(evo.length - nLearn);
      this.generation++;
      const pickTop = () => {
        // турнирный отбор из лучших
        const a = top[rng.int(top.length)], b = top[rng.int(top.length)];
        return score(a) >= score(b) ? a : b;
      };
      for (const b of learners) {
        const p1 = pickTop(); let p2 = pickTop();
        if (p2 === p1 && top.length > 1) p2 = top[(top.indexOf(p1) + 1) % top.length];
        const child = Genome.mutate(Genome.crossover(p1.genome, p2.genome, rng), rng, c.mutationRate, c.mutationSigma);
        child.buyIn = clamp(child.buyIn, c.minBuyBB, c.maxBuyBB);
        b.genome = child;
        b.generation++;
        b.learnedFrom = p1.name;
        b.stats.reset();           // стиль изменился - оппоненты "забывают" старую статистику
        b.window = { hands: 0, netBB: 0 };
      }
      // остальные: память окна затухает, чтобы оценка отражала свежие результаты
      for (const b of this.bots) {
        if (!learners.includes(b)) { b.window.hands *= 0.88; b.window.netBB *= 0.88; }
        b.stats.decay(0.92);
      }
      this.recordEvo(top[0], score(top[0]));
      const best = top[0];
      this.addEvent(`Поколение ${this.generation}: ${learners.length} ботов переняли стиль лидеров (лучший — ${best.name}, ${score(best).toFixed(1)} bb/100)`, 'evolve');
    }

    recordEvo(best, bestScore) {
      let v = 0, p = 0, a = 0, n = 0, bluff = 0, loose = 0;
      for (const b of this.bots) {
        if (b.fixed || b.stats.hands < 30) continue;
        v += b.stats.vpipPct; p += b.stats.pfrPct; a += b.stats.afq; n++;
        bluff += b.genome.bluff; loose += b.genome.openBase + b.genome.posSlope * 0.5;
      }
      this.evoLog.push({
        gen: this.generation, hands: this.totalHands, vpip: n ? v / n : 0, pfr: n ? p / n : 0, afq: n ? a / n : 0,
        bluff: n ? bluff / n : 0, loose: n ? loose / n : 0, best: best ? best.name : '', bestScore,
      });
    }

    // ------------------------------------------------------------ запуск
    // Обычный режим: speed = шагов (действий) в секунду на стол, dt в мс.
    tick(dtMs, speed) {
      for (const t of this.tables) {
        t.credit = (t.credit || 0) + (dtMs / 1000) * speed;
        let guard = 0;
        while (t.credit >= 0 && guard++ < 50) {
          const cost = t.lastCost;
          t.step();
          t.credit -= t.lastCost > 0 ? t.lastCost : cost;
        }
      }
    }

    // Турбо: максимум шагов за заданное время.
    runFor(ms) {
      const end = (typeof performance !== 'undefined' ? performance : Date).now() + ms;
      const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
      let n = 0;
      do {
        for (const t of this.tables) { t.step(); n++; }
      } while (now() < end);
      return n;
    }

    runHands(targetHands) {
      let guard = 0;
      while (this.totalHands < targetHands && guard++ < targetHands * 400) {
        for (const t of this.tables) t.step();
      }
    }

    // ---------------------------------------------------------- рейтинг
    row(b) {
      const bb = this.cfg.bb;
      const s = b.stats;
      return {
        id: b.id, name: b.name, arch: b.archetype, fixed: b.fixed,
        archLabel: Genome.ARCHETYPES[b.archetype].label,
        style: styleLabel(s),
        strategy: Genome.stackStrategy(b.genome),
        profit: b.profit / 100,
        bb100: b.bb100Raw,
        bb100s: b.bb100,
        hands: b.hands,
        vpip: s.vpipPct, pfr: s.pfrPct, afq: s.afq,
        table: b.tableId, stack: b.stack / 100, stackBB: b.stack / bb,
        gen: b.generation, rebuys: b.rebuys, rake: b.rake / 100, bigWin: b.bigWin / 100,
        buyIn: b.genome.buyIn,
      };
    }

    ranking() { return this.bots.map((b) => this.row(b)); }

    totals() {
      let rake = 0;
      for (const t of this.tables) rake += t.rakeTotal;
      return { hands: this.totalHands, rake: rake / 100, generation: this.generation };
    }
  }

  NS.Simulation = Simulation;
  NS.DEFAULTS = DEFAULTS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
