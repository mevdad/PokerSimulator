(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { evaluate, categoryOf } = NS.Evaluator;
  const { preflopPct } = NS.Preflop;

  // Оценка эквити методом Монте-Карло против диапазонов оппонентов.
  // opps[i] = { tight, level, bluff }
  //   tight - доля топ-рук префлопа, которыми оппонент мог дойти до этого места (0..1)
  //   level - агрессия оппонента на текущей улице: 0 пассив, 1 бет, 2 рейз
  //   bluff - какая часть "пустых" рук остаётся в его агрессивном диапазоне
  const scratchHero = new Int8Array(7);
  const scratchOpp = new Int8Array(7);
  const scratchBoard = new Int8Array(7);
  const deckBuf = new Int8Array(52);
  const oppHole = new Int8Array(24);
  const runout = new Int8Array(5);

  function acceptHand(c1, c2, opp, board, nb, boardCat, boardSuitCnt, rng) {
    if (opp.tight < 1) {
      if (preflopPct(c1, c2) > opp.tight && rng.next() > 0.06) return false;
    }
    if (nb >= 3 && opp.level > 0) {
      for (let i = 0; i < nb; i++) scratchBoard[i] = board[i];
      scratchBoard[nb] = c1; scratchBoard[nb + 1] = c2;
      const cat = categoryOf(evaluate(scratchBoard, nb + 2));
      if (opp.level >= 2) {
        if (cat >= 2 && cat > boardCat) return true;
        if (cat > boardCat) return rng.next() < 0.5;
        return rng.next() < opp.bluff * 0.5;
      }
      if (cat > boardCat) return true;
      // флеш-дро и подобные: для пассивных линий оставляем часть слабых рук
      if (nb < 5) {
        const s1 = c1 & 3, s2 = c2 & 3;
        const same = s1 === s2 ? 2 + boardSuitCnt[s1] : Math.max(1 + boardSuitCnt[s1], 1 + boardSuitCnt[s2]);
        if (same >= 4) return rng.next() < 0.85;
      }
      return rng.next() < opp.bluff;
    }
    return true;
  }

  function estimateEquity(hole, board, opps, samples, rng) {
    const nb = board.length;
    const need = 5 - nb;
    const nOpp = opps.length;
    if (nOpp === 0) return 1;

    let m = 0;
    const used = new Uint8Array(52);
    used[hole[0]] = 1; used[hole[1]] = 1;
    for (let i = 0; i < nb; i++) used[board[i]] = 1;
    for (let c = 0; c < 52; c++) if (!used[c]) deckBuf[m++] = c;

    const boardSuitCnt = [0, 0, 0, 0];
    for (let i = 0; i < nb; i++) boardSuitCnt[board[i] & 3]++;
    let boardCat = 0;
    if (nb >= 3) {
      for (let i = 0; i < nb; i++) scratchBoard[i] = board[i];
      boardCat = categoryOf(evaluate(scratchBoard, nb));
    }

    let total = 0;
    for (let s = 0; s < samples; s++) {
      let n = m;
      for (let i = 0; i < nOpp; i++) {
        let attempts = 0, c1, c2;
        for (;;) {
          let idx = (rng.next() * n) | 0;
          c1 = deckBuf[idx]; deckBuf[idx] = deckBuf[n - 1]; deckBuf[n - 1] = c1; n--;
          idx = (rng.next() * n) | 0;
          c2 = deckBuf[idx]; deckBuf[idx] = deckBuf[n - 1]; deckBuf[n - 1] = c2; n--;
          if (++attempts >= 6 || acceptHand(c1, c2, opps[i], board, nb, boardCat, boardSuitCnt, rng)) break;
          n += 2;
        }
        oppHole[i * 2] = c1; oppHole[i * 2 + 1] = c2;
      }
      for (let k = 0; k < need; k++) {
        const idx = (rng.next() * n) | 0;
        runout[k] = deckBuf[idx]; deckBuf[idx] = deckBuf[n - 1]; deckBuf[n - 1] = runout[k]; n--;
      }
      // рука героя
      scratchHero[0] = hole[0]; scratchHero[1] = hole[1];
      let len = 2;
      for (let i = 0; i < nb; i++) scratchHero[len++] = board[i];
      for (let k = 0; k < need; k++) scratchHero[len++] = runout[k];
      const heroScore = evaluate(scratchHero, 7);
      let lose = false, ties = 0;
      for (let i = 0; i < nOpp; i++) {
        scratchOpp[0] = oppHole[i * 2]; scratchOpp[1] = oppHole[i * 2 + 1];
        let l2 = 2;
        for (let j = 0; j < nb; j++) scratchOpp[l2++] = board[j];
        for (let k = 0; k < need; k++) scratchOpp[l2++] = runout[k];
        const sc = evaluate(scratchOpp, 7);
        if (sc > heroScore) { lose = true; break; }
        if (sc === heroScore) ties++;
      }
      if (!lose) total += 1 / (ties + 1);
    }
    return total / samples;
  }

  NS.Equity = { estimateEquity };
})(typeof globalThis !== 'undefined' ? globalThis : window);
