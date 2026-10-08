(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { RNG, Table, Bot, Genome, generateNames, styleLabel } = NS;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const DEFAULTS = {
    mode: 'solo',           // 'solo' - все боты вместе; 'versus' - команда компании против игроков
    bots: 200,              // solo: всего ботов; versus: ботов компании
    players: 200,           // versus: игроков с рандомными seed
    maxTeamPerTable: 2,     // versus: максимум ботов компании за одним столом
    companySeeds: null,     // versus: стартовые геномы компании (иначе NS.COMPANY_SEEDS)
    tables: 3,
    seats: 6,
    sb: 25,                 // центы: $0.25
    bb: 50,                 // центы: $0.50
    minBuyBB: 20,
    maxBuyBB: 100,
    rakePct: 0.03,
    rakeCapBB: 3,
    fixedShare: 0.25,       // solo: доля ботов с фиксированным архетипом (рыба, маньяк, нит ...)
    evolution: true,
    genHands: 4000,         // раз в сколько раздач (всего) происходит обучение
    learnShare: 0.15,       // какая доля худших ботов перенимает стиль лучших
    mutationRate: 0.35,
    mutationSigma: 0.08,
    minWindowHands: 250,
    snapshotEvery: 250,
    seed: undefined,
    debug: false,
  };

  // состав фиксированных ботов ("рыбы" и разные типы для эксплуатации)
  const FIXED_MIX = [['FISH', 0.32], ['NIT', 0.18], ['MANIAC', 0.12], ['ROCK', 0.14], ['LAG', 0.1], ['TAG', 0.14]];
  // состав «игроков» из потока: типичный микролимит (много любителей, немного регуляров)
  const PLAYER_MIX = [['FISH', 0.35], ['TAG', 0.2], ['ROCK', 0.12], ['NIT', 0.1], ['LAG', 0.12], ['MANIAC', 0.11]];

  function weightedPick(mix, rng) {
    let r = rng.next(), acc = 0;
    for (const [k, w] of mix) { acc += w; if (r < acc) return k; }
    return mix[mix.length - 1][0];
  }

  class Simulation {
    constructor(cfg) {
      const given = cfg || {};
      this.cfg = Object.assign({}, DEFAULTS, given);
      const c = this.cfg;
      // в режиме «компания vs игроки» рейк по умолчанию выключен: прибыль компании = деньги игроков
      if (c.mode === 'versus' && given.rakePct === undefined) c.rakePct = 0;
      c.rakeCap = Math.round(c.rakeCapBB * c.bb);
      this.versus = c.mode === 'versus';
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

    // ------------------------------------------------------------ боты
    createBots() {
      this.bots = [];
      if (this.versus) this.createVersus(); else this.createSolo();
    }

    makeBot(id, name, genome, arch, fixed, seed) {
      const c = this.cfg;
      genome.buyIn = clamp(genome.buyIn, c.minBuyBB, c.maxBuyBB);
      const bot = new Bot(id, name, genome, arch, fixed, new RNG(seed >>> 0));
      bot.seed = seed >>> 0;
      this.bots.push(bot);
      return bot;
    }

    createSolo() {
      const c = this.cfg, rng = this.rng;
      const names = generateNames(c.bots, rng);
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
        this.makeBot(i, names[i], genome, arch, fixed, (rng.seed ^ Math.imul(i + 1, 2654435761)) >>> 0);
      }
    }

    // Команда компании (учится) против игроков со случайными seed (не учатся, у каждого свой стиль).
    createVersus() {
      const c = this.cfg, rng = this.rng;
      const nC = c.bots, nP = c.players;
      const names = generateNames(nC + nP, rng);
      const seeds = (c.companySeeds && c.companySeeds.length ? c.companySeeds : NS.COMPANY_SEEDS) || [];
      for (let i = 0; i < nC; i++) {
        let genome;
        if (seeds.length) {
          // лучшие геномы из прошлых прогонов + их мутанты, чтобы популяция была разнообразной
          const base = Object.assign(Genome.defaultGenome(), seeds[i % seeds.length]);
          genome = i < seeds.length ? base : Genome.mutate(base, rng, 0.3, 0.05);
        } else {
          genome = Genome.makeGenome(rng.chance(0.55) ? 'TAG' : rng.pick(['NIT', 'LAG', 'ROCK']), rng, 0.14);
        }
        const bot = this.makeBot(i, names[i], genome, 'EVO', false, (rng.seed ^ Math.imul(i + 1, 2654435761)) >>> 0);
        bot.team = 'company';
      }
      for (let j = 0; j < nP; j++) {
        const id = nC + j;
        const seed = rng.int(4294967296);        // случайный seed игрока определяет весь его стиль
        const pr = new RNG(seed);
        const arch = weightedPick(PLAYER_MIX, pr);
        const genome = Genome.makeGenome(arch, pr, 0.03 + pr.next() * 0.17);
        genome.buyIn = pr.range(c.minBuyBB, c.maxBuyBB);
        const bot = this.makeBot(id, names[id], genome, arch, true, seed);
        bot.team = 'player';
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

    leave(table, seat) {
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
        if (leave) { this.leave(table, seat); continue; }
        const target = this.buyInCents(bot);
        const minBuy = Math.max(c.minBuyBB, 0.3 * g.buyIn) * c.bb;
        if (seat.stack < minBuy) table.addChips(seat, target - seat.stack);
      }
      this.fillSeats(table);
    }

    fillSeats(table) {
      const free = table.freeSeatIndexes();
      if (!free.length || !this.waiting.length) return;
      const c = this.cfg;
      const score = this.tableScore(table);
      let teamCount = 0;
      if (this.versus) for (const s of table.seats) if (s && s.bot.team === 'company') teamCount++;
      for (const idx of free) {
        if (!this.waiting.length) break;
        const needPlayers = table.occupied() < 2;
        let pick = -1;
        const limit = Math.min(this.waiting.length, this.versus ? 400 : 80);
        for (let i = 0; i < limit; i++) {
          const b = this.waiting[i];
          if (b.cooldown > this.totalHands) continue;
          if (this.versus && b.team === 'company' && teamCount >= c.maxTeamPerTable) continue;
          if (needPlayers) { pick = i; break; }
          const waited = this.totalHands - b.waitSince;
          const thr = (b.genome.tableSel - 0.5) * 0.6 - waited / 400;
          if (score >= thr) { pick = i; break; }
        }
        if (pick < 0) break;
        const bot = this.waiting.splice(pick, 1)[0];
        if (bot.team === 'company') teamCount++;
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
      const entry = { h: this.totalHands, p: Float32Array.from(this.bots, (b) => b.profit / 100) };
      if (this.versus) {
        const T = this.teamTotals();
        entry.t = {
          cp: T.company.profit, pp: T.player.profit, pd: T.player.drop, pt: T.player.turnover,
          cd: T.company.drop, ct: T.company.turnover, cr: T.company.rake, pr: T.player.rake,
          ch: T.company.hands, ph: T.player.hands,
        };
      }
      this.history.push(entry);
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
      const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
      const end = now() + ms;
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
        id: b.id, name: b.name, arch: b.archetype, fixed: b.fixed, team: b.team, seed: b.seed,
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
        buyIn: b.genome.buyIn, drop: b.bankIn / 100, turnover: b.turnover / 100,
      };
    }

    ranking() { return this.bots.map((b) => this.row(b)); }

    totals() {
      let rake = 0;
      for (const t of this.tables) rake += t.rakeTotal;
      return { hands: this.totalHands, rake: rake / 100, generation: this.generation };
    }

    // ------------------------------------------- команда vs игроки (в $)
    teamTotals() {
      const mk = () => ({ n: 0, profit: 0, drop: 0, turnover: 0, hands: 0, rake: 0, netBB: 0 });
      const T = { company: mk(), player: mk() };
      for (const b of this.bots) {
        const t = T[b.team];
        if (!t) continue;
        t.n++; t.profit += b.profit / 100; t.drop += b.bankIn / 100; t.turnover += b.turnover / 100;
        t.hands += b.hands; t.rake += b.rake / 100; t.netBB += b.netBB;
      }
      return T;
    }

    teamStats() {
      const T = this.teamTotals();
      const extra = { company: { vpip: 0, pfr: 0, afq: 0, win: 0, list: [] }, player: { vpip: 0, pfr: 0, afq: 0, win: 0, list: [] } };
      for (const b of this.bots) {
        const e = extra[b.team];
        if (!e) continue;
        e.vpip += b.stats.vpipPct; e.pfr += b.stats.pfrPct; e.afq += b.stats.afq;
        if (b.profit > 0) e.win++;
        e.list.push(b.profit / 100);
      }
      for (const k of ['company', 'player']) {
        const t = T[k], e = extra[k];
        const n = Math.max(1, t.n);
        e.list.sort((a, b) => a - b);
        t.bb100 = t.hands ? (t.netBB / t.hands) * 100 : 0;
        t.vpip = e.vpip / n; t.pfr = e.pfr / n; t.afq = e.afq / n;
        t.winners = e.win; t.winShare = e.win / n;
        t.median = e.list.length ? e.list[Math.floor(e.list.length / 2)] : 0;
        t.best = e.list.length ? e.list[e.list.length - 1] : 0;
        t.worst = e.list.length ? e.list[0] : 0;
        t.profitList = e.list;
        t.avgDrop = t.drop / n;
      }
      return T;
    }

    // Доля компании от потока денег игроков. def: 'turnover' (оборот: все ставки игроков) | 'drop' (закупки игроков).
    // Доверительный интервал считается по независимым отрезкам истории (batch means).
    hold(def) {
      const T = this.teamTotals();
      const flow = def === 'drop' ? T.player.drop : T.player.turnover;
      const value = flow > 0 ? T.company.profit / flow : NaN;
      const key = def === 'drop' ? 'pd' : 'pt';
      const hs = this.history.filter((e) => e.t);
      const res = { value, flow, profit: T.company.profit, lo: NaN, hi: NaN, batches: 0, series: [] };
      if (hs.length < 2) return res;
      for (const e of hs) res.series.push({ h: e.h, v: e.t[key] > 0 ? e.t.cp / e.t[key] : NaN });
      // отрезки: пропускаем первые 10% (прогрев), делим на ~12 равных блоков
      const start = Math.floor(hs.length * 0.1);
      const seg = hs.slice(start);
      const nb = Math.min(12, Math.floor(seg.length / 3));
      if (nb >= 4) {
        const per = Math.floor((seg.length - 1) / nb);
        const ratios = [];
        for (let i = 0; i < nb; i++) {
          const a = seg[i * per], b = seg[(i + 1) * per];
          const dflow = b.t[key] - a.t[key];
          if (dflow > 0) ratios.push((b.t.cp - a.t.cp) / dflow);
        }
        if (ratios.length >= 4) {
          const m = ratios.reduce((s, x) => s + x, 0) / ratios.length;
          const sd = Math.sqrt(ratios.reduce((s, x) => s + (x - m) * (x - m), 0) / (ratios.length - 1));
          const se = sd / Math.sqrt(ratios.length);
          const tcrit = ratios.length >= 12 ? 2.2 : 2.6;
          res.mean = m; res.lo = m - tcrit * se; res.hi = m + tcrit * se; res.batches = ratios.length;
        }
      }
      return res;
    }
  }

  NS.Simulation = Simulation;
  NS.DEFAULTS = DEFAULTS;
  NS.PLAYER_MIX = PLAYER_MIX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
