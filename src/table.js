(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { makeDeck } = NS.Cards;
  const { evaluate, handName } = NS.Evaluator;

  const MAX_RAISES = 6;   // максимум рейзов на улице
  const hole7 = new Int8Array(7);

  // Все деньги - в центах (целые числа), чтобы не накапливать ошибки округления.
  class Table {
    constructor(id, cfg, rng, hooks) {
      this.id = id;
      this.cfg = cfg;
      this.rng = rng;
      this.hooks = hooks || {};
      this.seats = new Array(cfg.seats).fill(null);
      this.button = -1;
      this.handNo = 0;
      this.phase = 'waiting';       // waiting | betting | dealing | showdown | ended
      this.street = 'preflop';
      this.board = [];
      this.pot = 0;                 // банк, собранный с прошлых улиц
      this.history = [];
      this.log = [];
      this.lastCost = 0.5;
      this.rakeTotal = 0;
      this.handsPlayed = 0;
      this.lastHand = null;
      this.toAct = -1;
      this.currentBet = 0;
      this.lastRaiseSize = cfg.bb;
      this.raiseCount = 0;
      this.pf = { raises: 0, limpers: 0, aggressorSeat: -1, lastRaiserSeat: -1, openerSeat: -1 };
      this.flopBetMade = false;
      this.flopSeen = false;
      this.postOrder = [];
    }

    // ---------------------------------------------------------- рассадка
    occupied() { let n = 0; for (const s of this.seats) if (s) n++; return n; }
    freeSeatIndexes() { const r = []; this.seats.forEach((s, i) => { if (!s) r.push(i); }); return r; }

    sit(bot, idx, amount) {
      const seat = {
        idx, bot, stack: amount, bet: 0, committed: 0, inHand: false, folded: true, allIn: false,
        hole: [], hasActed: false, raiseLocked: false, lastAction: '', role: '', position: '', posFactor: 0.5,
        vpipF: false, pfrF: false, pfAct: 'blind', pfRaises: 0, streetAgg: 0, prevAgg: 0,
        result: 0, win: 0, handText: '', show: false, sawFlop: false,
      };
      this.seats[idx] = seat;
      bot.bankIn += amount;
      bot.seatRef = seat;
      bot.tableId = this.id;
      return seat;
    }

    unsit(idx) {
      const seat = this.seats[idx];
      if (!seat) return;
      seat.bot.cashOut += seat.stack;
      seat.bot.seatRef = null;
      seat.bot.tableId = -1;
      this.seats[idx] = null;
    }

    addChips(seat, amount) { seat.stack += amount; seat.bot.bankIn += amount; seat.bot.rebuys++; }

    // ------------------------------------------------------------ шаги
    step() {
      switch (this.phase) {
        case 'waiting':
          if (this.tryStart()) { this.lastCost = 1.2; return true; }
          this.lastCost = 0.4;
          return false;
        case 'betting': this.playAction(); return true;
        case 'dealing': this.dealStreet(); return true;
        case 'showdown': this.showdown(); return true;
        case 'ended': this.phase = 'waiting'; this.lastCost = 0.5; return true;
        default: return false;
      }
    }

    nextInHand(from) {
      const n = this.seats.length;
      for (let k = 1; k <= n; k++) {
        const j = (from + k) % n, s = this.seats[j];
        if (s && s.inHand) return j;
      }
      return -1;
    }

    tryStart() {
      if (this.hooks.beforeHand) this.hooks.beforeHand(this);
      const ready = [];
      this.seats.forEach((s, i) => { if (s && s.stack > 0) ready.push(i); });
      if (ready.length < 2) return false;
      this.startHand();
      return true;
    }

    startHand() {
      const cfg = this.cfg, n = this.seats.length;
      this.handNo++;
      this.board = []; this.pot = 0; this.history = [];
      this.street = 'preflop'; this.flopBetMade = false; this.flopSeen = false;
      this.lastHand = null;
      for (const s of this.seats) {
        if (!s) continue;
        s.inHand = s.stack > 0; s.folded = !s.inHand; s.allIn = false;
        s.bet = 0; s.committed = 0; s.hole = []; s.hasActed = false; s.raiseLocked = false;
        s.lastAction = ''; s.vpipF = false; s.pfrF = false; s.pfAct = 'blind'; s.pfRaises = 0;
        s.streetAgg = 0; s.prevAgg = 0; s.result = 0; s.win = 0; s.handText = ''; s.show = false; s.sawFlop = false;
        s.role = ''; s.position = '';
      }
      // кнопка
      if (this.button < 0 || !this.seats[this.button]) this.button = this.button < 0 ? n - 1 : this.button;
      this.button = this.nextInHand(this.button);
      // порядок после кнопки: SB, BB, UTG ... BTN
      const order = [];
      for (let k = 1; k <= n; k++) {
        const j = (this.button + k) % n;
        if (this.seats[j] && this.seats[j].inHand) order.push(j);
      }
      const np = order.length;
      this.nDealt = np;
      this.postOrder = order.slice();
      let sb, bb;
      if (np === 2) { sb = this.button; bb = order.find((j) => j !== this.button); }
      else { sb = order[0]; bb = order[1]; }
      this.sbSeat = sb; this.bbSeat = bb;
      this.assignPositions(order, sb, bb);

      this.deck = this.rng.shuffle(makeDeck());
      for (const j of order) {
        const s = this.seats[j];
        s.hole = [this.deck.pop(), this.deck.pop()];
        s.bot.stats.hands++;
      }
      this.postBlind(sb, cfg.sb, 'SB');
      this.postBlind(bb, cfg.bb, 'BB');
      this.currentBet = Math.max(this.seats[sb].bet, this.seats[bb].bet);
      this.lastRaiseSize = cfg.bb;
      this.raiseCount = 0;
      this.pf = { raises: 0, limpers: 0, aggressorSeat: -1, lastRaiserSeat: -1, openerSeat: -1 };
      this.phase = 'betting';
      this.addLog(`Раздача #${this.handNo}`, 'hand');
      const first = np === 2 ? sb : order[2 % np];
      this.toAct = -1;
      const s0 = this.seats[first];
      if (s0 && !s0.folded && !s0.allIn) this.toAct = first;
      else this.toAct = this.nextActor(first);
      if (this.toAct < 0) this.endBettingRound();
    }

    assignPositions(order, sb, bb) {
      const np = order.length;
      const nonBlind = order.filter((j) => j !== sb && j !== bb);
      const nb = nonBlind.length;
      // нонБлайнд идут в порядке: UTG ... BTN
      nonBlind.forEach((j, i) => {
        const s = this.seats[j];
        const d = nb - 1 - i;   // расстояние от баттона назад: 0 = BTN
        s.position = d === 0 ? 'BTN' : d === 1 ? 'CO' : d === 2 ? 'HJ' : d === nb - 1 ? 'UTG' : d === nb - 2 ? 'UTG+1' : 'MP';
        s.posFactor = nb > 1 ? 1 - d / (nb - 1) : 1;   // BTN = 1, самая ранняя позиция = 0
        s.role = s.position;
      });
      const sbS = this.seats[sb], bbS = this.seats[bb];
      if (np === 2) {
        sbS.position = 'BTN/SB'; sbS.role = 'SB'; sbS.posFactor = 1;
      } else {
        sbS.position = 'SB'; sbS.role = 'SB'; sbS.posFactor = 0.75;
      }
      bbS.position = 'BB'; bbS.role = 'BB'; bbS.posFactor = 0.5;
    }

    postBlind(idx, amount, label) {
      const s = this.seats[idx];
      const a = Math.min(amount, s.stack);
      s.stack -= a; s.bet = a; s.committed = a;
      if (s.stack === 0) s.allIn = true;
      s.lastAction = label + ' ' + this.money(a);
      this.history.push({ street: 'preflop', seat: idx, id: s.bot.id, action: 'post', amount: a, to: a });
    }

    money(c) { return '$' + (c / 100).toFixed(2); }

    addLog(text, kind) {
      this.log.push({ text, kind: kind || 'act', hand: this.handNo });
      if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
    }

    // ----------------------------------------------------------- торги
    minRaiseTo() { return this.currentBet + this.lastRaiseSize; }

    canRaiseSeat(s) {
      if (s.raiseLocked || this.raiseCount >= MAX_RAISES) return false;
      if (s.stack <= this.currentBet - s.bet) return false;
      for (const o of this.seats) {
        if (o && o !== s && o.inHand && !o.folded && !o.allIn) return true;
      }
      return false;
    }

    nextActor(from) {
      const n = this.seats.length;
      let can = 0, only = null;
      for (const s of this.seats) {
        if (s && s.inHand && !s.folded && !s.allIn) { can++; only = s; }
      }
      if (can === 0) return -1;
      if (can === 1 && only.bet >= this.currentBet) return -1;
      for (let k = 1; k <= n; k++) {
        const j = (from + k) % n, s = this.seats[j];
        if (s && s.inHand && !s.folded && !s.allIn && (!s.hasActed || s.bet < this.currentBet)) return j;
      }
      return -1;
    }

    buildView(idx) {
      const s = this.seats[idx], cfg = this.cfg;
      const toCall = Math.min(this.currentBet - s.bet, s.stack);
      let pot = this.pot;
      const players = [], opponents = [];
      let activeCount = 0, maxOppTotal = 0, nDealt = 0, facingAllIn = false;
      for (let i = 0; i < this.seats.length; i++) {
        const p = this.seats[i];
        if (!p || !p.inHand) continue;
        nDealt++;
        pot += p.bet;
        const st = p.bot.stats;
        const info = {
          seat: i, id: p.bot.id, name: p.bot.name, stack: p.stack, bet: p.bet, committed: p.committed,
          folded: p.folded, allIn: p.allIn, position: p.position, posFactor: p.posFactor, role: p.role,
          hasActed: p.hasActed, pfAction: p.pfAct, pfRaises: p.pfRaises, streetAgg: p.streetAgg, prevAgg: p.prevAgg,
          hud: { hands: st.hands, vpip: st.vpipPct, pfr: st.pfrPct, afq: st.afq, foldToBet: st.foldToBetPct },
        };
        players.push(info);
        if (!p.folded) {
          activeCount++;
          if (i !== idx) {
            opponents.push(info);
            maxOppTotal = Math.max(maxOppTotal, p.stack + p.bet);
            if (p.allIn && p.bet >= this.currentBet) facingAllIn = true;
          }
        }
      }
      // позиция постфлоп: мы последние среди оставшихся?
      let inPosition = true;
      const myOrd = this.postOrder.indexOf(idx);
      for (const o of opponents) {
        if (this.postOrder.indexOf(o.seat) > myOrd) { inPosition = false; break; }
      }
      const lastRaiser = this.pf.lastRaiserSeat >= 0
        ? opponents.find((o) => o.seat === this.pf.lastRaiserSeat) || null : null;
      const agg = this.pf.aggressorSeat >= 0 ? this.seats[this.pf.aggressorSeat] : null;
      return {
        handNo: this.handNo, street: this.street, hole: s.hole.slice(), board: this.board.slice(),
        pot, bb: cfg.bb, sb: cfg.sb, toCall, currentBet: this.currentBet,
        minRaiseTo: Math.min(this.minRaiseTo(), s.bet + s.stack), maxRaiseTo: s.bet + s.stack,
        canRaise: this.canRaiseSeat(s),
        stack: s.stack, bet: s.bet, committed: s.committed,
        seat: idx, position: s.position, posFactor: s.posFactor, role: s.role,
        heads: nDealt === 2, nDealt, numActive: activeCount, inPosition,
        players, opponents, history: this.history, button: this.button,
        preflop: {
          raises: this.pf.raises, limpers: this.pf.limpers, myRaises: s.pfRaises,
          aggressorSeat: this.pf.aggressorSeat, aggressorId: agg ? agg.bot.id : -1,
        },
        lastRaiser,
        effStack: Math.min(s.stack + s.bet, maxOppTotal || s.stack + s.bet),
        facingAllIn,
      };
    }

    playAction() {
      const idx = this.toAct;
      const s = this.seats[idx];
      let dec;
      try { dec = s.bot.decide(this.buildView(idx)); } catch (e) { dec = { type: 'fold' }; if (this.cfg.debug) throw e; }
      this.applyAction(idx, dec || { type: 'fold' });
      this.lastCost = 1;
    }

    applyAction(idx, dec) {
      const s = this.seats[idx], st = s.bot.stats;
      const toCallRaw = this.currentBet - s.bet;
      const pre = this.street === 'preflop';
      let type = dec.type, to = dec.to;
      const maxTo = s.bet + s.stack;

      if (type === 'check' && toCallRaw > 0) type = 'fold';
      if (type === 'fold' && toCallRaw <= 0) type = 'check';
      if (type === 'raise') {
        if (!this.canRaiseSeat(s)) type = toCallRaw > 0 ? 'call' : 'check';
        else {
          if (to === undefined || Number.isNaN(to)) to = this.minRaiseTo();
          to = Math.round(to);
          const minTo = this.minRaiseTo();
          if (to >= maxTo) to = maxTo;
          else if (to < minTo) to = Math.min(minTo, maxTo);
          if (to <= this.currentBet) type = toCallRaw > 0 ? 'call' : 'check';
        }
      }

      // --- статистика (до применения)
      if (pre) {
        if (this.pf.raises === 1 && s.pfRaises === 0 && (type === 'call' || type === 'fold' || type === 'raise')) {
          st.threeBetOpp++; if (type === 'raise') st.threeBet++;
        }
      } else if (toCallRaw > 0) {
        st.facedBet++;
        if (type === 'fold') st.foldedToBet++;
      }
      if (!pre && this.street === 'flop' && !this.flopBetMade && toCallRaw === 0 &&
        this.pf.aggressorSeat === idx && (type === 'check' || type === 'raise')) {
        st.cbetOpp++; if (type === 'raise') st.cbet++;
      }

      let text = '', histAction = type, amountPut = 0;
      if (type === 'fold') {
        s.folded = true;
        text = 'Fold';
        if (!pre) st.folds++;
      } else if (type === 'check') {
        text = 'Check';
      } else if (type === 'call') {
        const a = Math.min(toCallRaw, s.stack);
        s.stack -= a; s.bet += a; s.committed += a; amountPut = a;
        if (s.stack === 0) s.allIn = true;
        text = (s.allIn ? 'All-in ' : 'Call ') + this.money(s.bet);
        if (pre) {
          s.vpipF = true;
          if (s.pfAct !== 'raise') s.pfAct = 'call';
          if (this.pf.raises === 0) this.pf.limpers++;
        } else st.calls++;
      } else { // raise / bet
        const wasBet = this.currentBet > 0;
        const a = to - s.bet;
        s.stack -= a; s.bet = to; s.committed += a; amountPut = a;
        if (s.stack === 0) s.allIn = true;
        const raiseSize = to - this.currentBet;
        const full = raiseSize >= this.lastRaiseSize;
        this.currentBet = to;
        if (full) {
          this.lastRaiseSize = raiseSize;
          for (const o of this.seats) { if (o && o !== s) { o.hasActed = false; o.raiseLocked = false; } }
        } else {
          for (const o of this.seats) { if (o && o !== s && o.hasActed) o.raiseLocked = true; }
        }
        this.raiseCount++;
        histAction = wasBet ? 'raise' : 'bet';
        text = (s.allIn ? 'All-in ' : (wasBet || pre ? 'Raise to ' : 'Bet ')) + this.money(to);
        if (pre) {
          this.pf.raises++;
          if (this.pf.openerSeat < 0) this.pf.openerSeat = idx;
          this.pf.lastRaiserSeat = idx; this.pf.aggressorSeat = idx;
          s.pfrF = true; s.vpipF = true; s.pfAct = 'raise'; s.pfRaises++;
        } else {
          st.agg++;
          s.streetAgg = Math.max(s.streetAgg, wasBet ? 2 : 1);
          if (this.street === 'flop') this.flopBetMade = true;
        }
      }
      s.hasActed = true;
      s.lastAction = text;
      this.history.push({ street: this.street, seat: idx, id: s.bot.id, action: histAction, amount: amountPut, to: s.bet });
      this.addLog(`${s.bot.name}: ${text}`, 'act');

      // --- что дальше
      const alive = [];
      for (const o of this.seats) if (o && o.inHand && !o.folded) alive.push(o);
      if (alive.length === 1) { this.finishUncontested(alive[0]); return; }
      const next = this.nextActor(idx);
      if (next >= 0) this.toAct = next;
      else this.endBettingRound();
    }

    endBettingRound() {
      for (const s of this.seats) {
        if (!s || !s.inHand) continue;
        this.pot += s.bet; s.bet = 0;
        s.hasActed = false; s.raiseLocked = false;
        s.prevAgg = Math.max(s.prevAgg, s.streetAgg); s.streetAgg = 0;
        if (!s.folded && !s.allIn) s.lastAction = s.lastAction.startsWith('Fold') ? s.lastAction : '';
      }
      this.currentBet = 0; this.lastRaiseSize = this.cfg.bb; this.raiseCount = 0;
      this.toAct = -1;
      this.phase = this.street === 'river' ? 'showdown' : 'dealing';
      this.lastCost = 0.8;
    }

    dealStreet() {
      this.deck.pop(); // burn
      if (this.street === 'preflop') {
        this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.street = 'flop'; this.flopSeen = true;
        for (const s of this.seats) if (s && s.inHand && !s.folded) { s.sawFlop = true; s.bot.stats.sawFlop++; }
      } else if (this.street === 'flop') { this.board.push(this.deck.pop()); this.street = 'turn'; }
      else if (this.street === 'turn') { this.board.push(this.deck.pop()); this.street = 'river'; }
      for (const s of this.seats) if (s && s.inHand && !s.folded && !s.allIn) s.lastAction = '';
      this.lastCost = 1.5;
      let can = 0, last = -1;
      this.seats.forEach((s, i) => { if (s && s.inHand && !s.folded && !s.allIn) { can++; last = i; } });
      if (can >= 2) {
        const first = this.nextActor(this.button);
        if (first >= 0) { this.toAct = first; this.phase = 'betting'; return; }
      }
      this.phase = this.street === 'river' ? 'showdown' : 'dealing';
    }

    // ------------------------------------------------------- расчёт банка
    rakeFor(contested) {
      if (!this.flopSeen || this.cfg.rakePct <= 0) return 0;
      return Math.min(Math.floor(contested * this.cfg.rakePct), this.cfg.rakeCap);
    }

    finishUncontested(winner) {
      for (const s of this.seats) if (s && s.inHand) { this.pot += s.bet; s.bet = 0; }
      let maxOther = 0;
      for (const s of this.seats) if (s && s.inHand && s !== winner) maxOther = Math.max(maxOther, s.committed);
      const uncalled = Math.max(0, winner.committed - maxOther);
      const contested = this.pot - uncalled;
      const rake = this.rakeFor(contested);
      const payouts = new Map();
      payouts.set(winner.idx, this.pot - rake);
      winner.handText = 'Все сбросили';
      this.settle(payouts, rake, false);
    }

    buildPots() {
      const contribs = [], live = [];
      for (const s of this.seats) {
        if (!s || !s.inHand || s.committed <= 0) continue;
        contribs.push(s);
        if (!s.folded) live.push(s);
      }
      const levels = [...new Set(live.map((s) => s.committed))].sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const L of levels) {
        let amount = 0;
        const owners = new Set();
        for (const s of contribs) {
          const part = Math.min(s.committed, L) - Math.min(s.committed, prev);
          if (part > 0) { amount += part; owners.add(s); }
        }
        const eligible = live.filter((s) => s.committed >= L);
        if (amount > 0) {
          const refund = eligible.length === 1 && owners.size === 1 && owners.has(eligible[0]);
          pots.push({ amount, eligible, refund });
        }
        prev = L;
      }
      const top = levels.length ? levels[levels.length - 1] : 0;
      let extra = 0;
      for (const s of contribs) if (s.folded && s.committed > top) extra += s.committed - top;
      if (extra && pots.length) pots[pots.length - 1].amount += extra;
      return pots;
    }

    showdown() {
      const live = this.seats.filter((s) => s && s.inHand && !s.folded);
      const scores = new Map();
      for (const s of live) {
        hole7[0] = s.hole[0]; hole7[1] = s.hole[1];
        for (let i = 0; i < 5; i++) hole7[2 + i] = this.board[i];
        const sc = evaluate(hole7, 7);
        scores.set(s, sc);
        s.show = true; s.handText = handName(sc);
        s.bot.stats.showdowns++;
      }
      const pots = this.buildPots();
      let contested = 0;
      for (const p of pots) if (!p.refund) contested += p.amount;
      const rake = this.rakeFor(contested);
      let rakeLeft = rake;
      const payouts = new Map();
      const add = (s, a) => payouts.set(s.idx, (payouts.get(s.idx) || 0) + a);
      // порядок "слева от баттона" для разбора нечётных центов
      const orderIdx = (s) => (this.postOrder.indexOf(s.idx));
      for (const p of pots) {
        if (p.refund) { add(p.eligible[0], p.amount); continue; }
        if (rakeLeft > 0) { const take = Math.min(rakeLeft, p.amount); p.amount -= take; rakeLeft -= take; }
        let best = -1, winners = [];
        for (const s of p.eligible) {
          const sc = scores.get(s);
          if (sc > best) { best = sc; winners = [s]; } else if (sc === best) winners.push(s);
        }
        winners.sort((a, b) => orderIdx(a) - orderIdx(b));
        const share = Math.floor(p.amount / winners.length);
        let rem = p.amount - share * winners.length;
        for (const w of winners) { add(w, share + (rem > 0 ? 1 : 0)); if (rem > 0) rem--; }
      }
      this.settle(payouts, rake, true);
    }

    settle(payouts, rake, showdown) {
      const bb = this.cfg.bb;
      const winners = [];
      let totalPot = 0;
      for (const s of this.seats) {
        if (!s || !s.inHand) continue;
        totalPot += s.committed;
        const win = payouts.get(s.idx) || 0;
        s.stack += win; s.win = win; s.result = win - s.committed;
        if (win > 0) {
          winners.push({ seat: s.idx, name: s.bot.name, amount: win, hand: s.handText });
          if (showdown) s.bot.stats.wonSd++;
        }
        const st = s.bot.stats;
        if (s.vpipF) st.vpip++;
        if (s.pfrF) st.pfr++;
        const b = s.bot;
        b.hands++; b.netBB += s.result / bb;
        b.window.hands++; b.window.netBB += s.result / bb;
        b.session.hands++;
        if (s.result > b.bigWin) b.bigWin = s.result;
      }
      // рейк относим к игрокам пропорционально вкладу в банк
      if (rake > 0 && totalPot > 0) {
        for (const s of this.seats) if (s && s.inHand) s.bot.rake += rake * (s.committed / totalPot);
      }
      this.rakeTotal += rake;
      this.handsPlayed++;
      this.lastHand = { no: this.handNo, board: this.board.slice(), winners, pot: totalPot, rake, showdown };
      if (winners.length) {
        const w = winners.map((x) => `${x.name} +${this.money(x.amount)}${x.hand ? ' (' + x.hand + ')' : ''}`).join(', ');
        this.addLog(w, 'win');
      }
      this.phase = 'ended';
      this.lastCost = showdown ? 2.5 : 1.8;
      if (this.hooks.afterHand) this.hooks.afterHand(this, this.lastHand);
    }
  }

  NS.Table = Table;
})(typeof globalThis !== 'undefined' ? globalThis : window);
