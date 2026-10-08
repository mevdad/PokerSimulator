(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { preflopPct, isBluff3betHand } = NS.Preflop;
  const { estimateEquity } = NS.Equity;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const FOLD = { type: 'fold' }, CHECK = { type: 'check' }, CALL = { type: 'call' };

  // Доля рук, которыми разумно шовить при стеке s ББ (приближение к равновесию Нэша для пуш/фолд).
  const pushPct = (s) => Math.min(1, 1.45 * Math.exp(-0.095 * s));

  class Bot {
    constructor(id, name, genome, archetype, fixed, rng) {
      this.id = id;
      this.name = name;
      this.genome = genome;
      this.archetype = archetype;
      this.fixed = fixed;           // фиксированный архетип не обучается (это "рыба" для эксплуатации)
      this.rng = rng;
      this.stats = new NS.Stats();

      // деньги (в центах)
      this.bankIn = 0;
      this.cashOut = 0;
      this.seatRef = null;
      this.rebuys = 0;
      this.rake = 0;                // сколько рейка заплатил бот

      // результаты
      this.hands = 0;
      this.netBB = 0;               // за всё время, в ББ
      this.window = { hands: 0, netBB: 0 };   // окно оценки для эволюции
      this.bigWin = 0;
      this.generation = 0;
      this.learnedFrom = null;
      this.session = { hands: 0, startProfit: 0 };
      this.waitSince = 0;
      this.cooldown = 0;
      this.tableId = -1;
      this.team = 'solo';           // 'company' | 'player' в режиме «Компания vs Игроки»
      this.tune = {};               // улучшения логики (только у ботов компании): shortHanded, exploit2, samples
      this.turnover = 0;            // сумма всех ставок бота (центы)
      this.seed = 0;                // персональный seed (у игроков — случайный)
    }

    get stack() { return this.seatRef ? this.seatRef.stack : 0; }
    get profit() { return this.cashOut + this.stack - this.bankIn; }
    // выигрыш в bb/100 с поправкой на малую выборку
    get bb100() { return (100 * this.netBB) / (this.hands + 200); }
    get bb100Raw() { return this.hands ? (100 * this.netBB) / this.hands : 0; }

    // ---------------------------------------------------------------- решение
    decide(v) {
      const act = v.street === 'preflop' ? this.preflop(v) : this.postflop(v);
      return act;
    }

    raiseAction(v, to) {
      if (!v.canRaise) return v.toCall > 0 ? CALL : CHECK;
      to = Math.round(to / 5) * 5;
      if (to < v.minRaiseTo) to = v.minRaiseTo;
      if (to >= v.maxRaiseTo * 0.78 || v.maxRaiseTo - to < v.bb * 1.2) to = v.maxRaiseTo;
      return { type: 'raise', to };
    }

    // ------------------------------------------------------------- ПРЕФЛОП
    preflop(v) {
      const g = this.genome, rng = this.rng, bb = v.bb;
      const hp = clamp(preflopPct(v.hole[0], v.hole[1]) + rng.gauss() * g.noise, 0, 1);
      const effBB = v.effStack / bb;
      const pf = v.posFactor;
      const nR = v.preflop.raises, nL = v.preflop.limpers;
      const mk = (to) => this.raiseAction(v, to);
      const tn = this.tune;
      // за короткими столами (3-5 игроков) диапазоны шире, чем за 6-max; за 9-max уже
      const sh = tn.shortHanded ? clamp(1 + 0.12 * (6 - v.nDealt), 0.8, 1.6) : 1;
      const shp = Math.pow(sh, 0.7);

      if (nR === 0) {
        // --- рейза ещё не было
        if (effBB <= g.shoveStack) {
          // короткий стек (SSS): пуш/фолд по математике
          if (v.role === 'BB') return CHECK;
          const pct = Math.min(1, pushPct(effBB) * (0.45 + 0.55 * pf) * (nL > 0 ? 0.8 : 1));
          return hp <= pct ? mk(v.maxRaiseTo) : (v.toCall === 0 ? CHECK : FOLD);
        }
        // эксплуатация: против тайтовых игроков за нами (блайнды и т.д.) воруем блайнды шире
        let steal = 1;
        if (tn.exploit2) {
          let sv = 0, c = 0;
          for (const o of v.opponents) if (!o.hasActed) { sv += o.hud.vpip; c++; }
          if (c) steal = lerp(1, clamp(1 + (0.27 - sv / c) * 1.6, 0.85, 1.35), g.exploit);
        }
        const openThr = clamp((g.openBase + g.posSlope * pf) * sh * steal, 0.03, 0.9);
        if (v.role === 'BB') {
          if (nL > 0 && hp <= openThr * 0.5) return mk((g.openSize + nL) * bb);
          return CHECK;
        }
        if (nL === 0) {
          if (v.role === 'SB') {
            const thr = v.heads ? openThr : openThr * 0.9;
            if (hp <= thr) return mk(g.openSize * bb * (v.heads ? 1 : 1.2));
            if (!v.heads && hp <= thr + 0.2) return CALL;   // доплатить малый блайнд
            return FOLD;
          }
          if (hp <= openThr) return mk(g.openSize * bb);
          if (hp <= openThr * (1.35 + 2 * g.limpFreq) && rng.chance(g.limpFreq * 1.25)) return CALL;
          return FOLD;
        }
        // были лимперы: изолируем сильными руками
        if (hp <= openThr * 0.85) return mk((g.openSize + nL) * bb);
        if (hp <= openThr * 1.3 && rng.chance(0.3 + g.limpFreq)) return CALL;
        if (v.role === 'SB' && hp <= openThr * 1.6) return CALL;
        return FOLD;
      }

      // --- кто-то уже рейзил
      const r = v.lastRaiser;
      const defPfr = 0.10 + 0.20 * (r ? r.posFactor : 0.5);
      const hudPfr = r && r.hud ? r.hud.pfr : defPfr;
      const w = lerp(defPfr, hudPfr, g.exploit);
      const scale = clamp(w / 0.2, 0.45, 2.2);          // насколько широк диапазон рейзера
      const priceFrac = v.toCall / (v.pot + v.toCall);
      const ip = pf >= 0.66 && v.role !== 'SB' && v.role !== 'BB';
      const deep = effBB >= 28;

      // решение "на все деньги": считаем эквити против диапазона рейзера
      if (v.toCall >= 0.4 * v.stack || effBB <= Math.max(g.shoveStack, 18)) {
        return this.preflopCommit(v, hp, scale, mk);
      }

      if (nR === 1) {
        const tb = g.threeBet * Math.pow(scale, 0.8) * shp;
        let call = (g.callRaise + (ip ? g.callPosBonus : 0) + (v.role === 'BB' ? g.callPosBonus * 1.2 : 0)) * Math.pow(scale, 0.9) * shp;
        call *= clamp(1.35 - priceFrac * 1.6, 0.55, 1.5);
        const size = v.currentBet * (ip ? 3 : 3.8) + nL * bb;
        if (hp <= tb) return mk(size);
        if (deep && hp <= 0.5 && isBluff3betHand(v.hole[0], v.hole[1]) &&
          rng.chance(g.threeBetBluff * (ip ? 1 : 0.7) * (scale >= 0.9 ? 1 : 0.6))) return mk(size);
        if (hp <= call) return CALL;
        return FOLD;
      }

      // 3-бет и выше
      const iRaised = v.preflop.myRaises > 0;
      const t4 = g.fourBet * Math.pow(scale, 0.6) * (nR >= 3 ? 0.5 : 1);
      const callT = (iRaised ? (g.callRaise * 0.4 + g.fourBet * 1.4) * (ip ? 1.3 : 1) : g.fourBet * 1.1) *
        Math.pow(scale, 0.7) * (nR >= 3 ? 0.55 : 1);
      if (hp <= t4) return mk(v.currentBet * 2.3);
      if (hp <= callT) return CALL;
      if (deep && nR === 2 && hp <= 0.3 && isBluff3betHand(v.hole[0], v.hole[1]) &&
        rng.chance(g.threeBetBluff * 0.3)) return mk(v.currentBet * 2.3);
      return FOLD;
    }

    preflopCommit(v, hp, scale, mk) {
      const g = this.genome, rng = this.rng;
      const profs = [];
      const r = v.lastRaiser;
      for (const o of v.opponents) {
        let tight;
        if (r && o.seat === r.seat) {
          const base = 0.12 + 0.2 * o.posFactor;
          tight = lerp(base, o.hud.pfr, g.exploit);
          if (v.preflop.raises >= 2) tight *= 0.55;
          const effBB = v.effStack / v.bb;
          if (o.allIn && effBB <= 15) tight = Math.max(tight, pushPct(effBB) * 0.8);
        } else tight = 0.3;
        profs.push({ tight: clamp(tight, 0.04, 1), level: 0, bluff: 0.3 });
      }
      const eq = estimateEquity(v.hole, [], profs, 330, rng);
      const odds = v.toCall / (v.pot + v.toCall);
      const need = odds + 0.015 + g.callMargin * 0.5 + 0.01 * (profs.length - 1);
      if (v.canRaise && hp <= Math.min(g.threeBet * 1.3, 0.09) && eq > 0.55) return mk(v.maxRaiseTo);
      if (eq >= need) return CALL;
      return FOLD;
    }

    // ------------------------------------------------------------- ПОСТФЛОП
    oppProfile(o, v) {
      const g = this.genome, h = o.hud, ex = g.exploit;
      let tight;
      if (o.pfAction === 'raise') {
        tight = lerp(0.12 + 0.2 * o.posFactor, h.pfr, ex);
        if (o.pfRaises >= 2) tight *= 0.5;
      } else if (o.pfAction === 'call') {
        tight = lerp(0.26, clamp(h.vpip - 0.4 * h.pfr, 0.1, 0.65), ex);
      } else {
        tight = lerp(0.6, clamp(h.vpip + 0.25, 0.3, 1), ex);
      }
      const bluff = clamp(0.2 + (h.afq - 0.35) * 0.9, 0.1, 0.55) * ex + 0.3 * (1 - ex);
      return { tight: clamp(tight, 0.04, 1), level: o.streetAgg, bluff };
    }

    foldProb(o) {
      const f = lerp(0.45, o.hud.foldToBet, this.genome.exploit);
      return clamp(f * (o.streetAgg ? 0.6 : 1), 0.05, 0.9);
    }

    betPot(v, frac) {
      let amt = v.pot * frac * (0.9 + this.rng.next() * 0.2);
      if (amt < v.bb) amt = v.bb;
      return this.raiseAction(v, v.bet + amt);
    }

    raiseVsBet(v, rf) {
      const inc = Math.max(v.minRaiseTo - v.currentBet, (v.pot + v.toCall) * rf);
      return this.raiseAction(v, v.currentBet + inc);
    }

    postflop(v) {
      const g = this.genome, rng = this.rng;
      const opps = v.opponents, nOpp = opps.length;
      const profs = new Array(nOpp);
      for (let i = 0; i < nOpp; i++) profs[i] = this.oppProfile(opps[i], v);

      const base = v.street === 'flop' ? 150 : v.street === 'turn' ? 190 : 230;
      const sm = this.tune.samples || 1;
      let eq = estimateEquity(v.hole, v.board, profs, Math.round((nOpp > 2 ? base * 0.8 : base) * sm), rng);
      eq += (v.inPosition ? 0.012 : -0.025) + rng.gauss() * g.noise * 0.5;

      const pot = v.pot, toCall = v.toCall;
      const mw = Math.max(0, nOpp - 1);
      let vb = g.valueBet + g.multiwayCaution * mw;
      const rEq = g.raiseEq + g.multiwayCaution * mw * 1.2;
      let allFold = 1;
      for (let i = 0; i < nOpp; i++) allFold *= this.foldProb(opps[i]);
      let sizeAdj = 1;
      if (this.tune.exploit2) {
        // против тех, кто редко фолдит ("станции"), ставим тоньше по эквити и крупнее; против фолдящих - меньше
        vb -= 0.10 * (1 - allFold) * g.exploit * (nOpp === 1 ? 1 : 0.5);
        sizeAdj = clamp(1 + (0.45 - allFold) * 0.5, 0.85, 1.2);
      }
      const spr = v.stack / Math.max(pot, 1);

      if (toCall === 0) {
        if (!v.canRaise) return CHECK;
        if (eq >= vb) {
          if (eq >= 0.9 && v.street === 'flop' && nOpp <= 2 && rng.chance(v.inPosition ? g.slowplay : g.checkRaise)) return CHECK;
          if (!v.inPosition && eq < 0.85 && rng.chance(g.checkRaise * 0.4)) return CHECK;
          return this.betPot(v, (eq > 0.85 ? g.bigBetSize : g.betSize) * sizeAdj);
        }
        // c-bet: мы были агрессором на префлопе
        if (v.street === 'flop' && v.preflop.aggressorId === this.id && nOpp <= 2) {
          const p = g.cbet * (nOpp === 1 ? 1 : 0.55) * (0.55 + 0.9 * allFold);
          if (rng.chance(clamp(p, 0, 1))) return this.betPot(v, g.betSize * 0.8);
        }
        // полу-блеф с дро
        if (v.street !== 'river' && eq >= 0.27 && nOpp <= 2 &&
          rng.chance(g.semiBluff * (v.inPosition ? 1 : 0.65))) return this.betPot(v, g.betSize);
        // чистый блеф: только если вероятность общего фолда оправдывает ставку
        const breakeven = g.betSize / (1 + g.betSize);
        if (nOpp <= 2 && eq < 0.3 && allFold >= breakeven - 0.05 - 0.1 * (1 - g.exploit) &&
          rng.chance(g.bluff * (v.inPosition ? 1 : 0.6) * (v.street === 'river' ? 1.3 : 0.8))) return this.betPot(v, g.betSize);
        return CHECK;
      }

      // --- нам сделали ставку
      const odds = toCall / (pot + toCall);
      const need = odds + g.callMargin + (v.street === 'river' ? 0.01 : 0) + 0.01 * mw;
      if (v.canRaise) {
        if (eq >= rEq && !(v.street === 'flop' && rng.chance(g.slowplay * 0.5))) return this.raiseVsBet(v, g.betSize + 0.2);
        if (!v.inPosition && eq >= rEq - 0.1 && rng.chance(g.checkRaise)) return this.raiseVsBet(v, g.betSize + 0.2);
        if (v.street !== 'river' && nOpp === 1 && eq >= 0.3 && eq < need + 0.05 &&
          rng.chance(g.semiBluff * 0.25 * clamp(spr / 2, 0.3, 1.2))) return this.raiseVsBet(v, g.betSize + 0.2);
        if (nOpp === 1 && eq < 0.25 && allFold > 0.55 && rng.chance(g.bluff * 0.22)) return this.raiseVsBet(v, g.betSize + 0.2);
      }
      if (eq >= need) return CALL;
      return FOLD;
    }
  }

  NS.Bot = Bot;
  NS.pushPct = pushPct;
})(typeof globalThis !== 'undefined' ? globalThis : window);
