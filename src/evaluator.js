(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // Оценка лучшей 5-карточной комбинации из 5..7 карт.
  // Результат - целое число: чем больше, тем сильнее рука. category = floor(score / B5).
  const B = 13, B5 = 371293;
  const CATEGORY_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш'];

  // STRAIGHT[mask] = старшая карта стрита в маске рангов (или -1). Колесо A-2-3-4-5 -> 3.
  const STRAIGHT = new Int8Array(8192).fill(-1);
  for (let m = 0; m < 8192; m++) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 31 << (hi - 4);
      if ((m & need) === need) { STRAIGHT[m] = hi; break; }
    }
    if (STRAIGHT[m] < 0 && (m & 0x100F) === 0x100F) STRAIGHT[m] = 3;
  }

  const rc = new Int8Array(13);
  const sc = new Int8Array(4);
  const sm = new Int32Array(4);

  function evaluate(cards, n) {
    rc.fill(0); sc.fill(0); sm.fill(0);
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) {
      // из 7 карт флеш несовместим с каре/фулл-хаусом, поэтому можно вернуть сразу
      const m = sm[fs];
      const sf = STRAIGHT[m];
      if (sf >= 0) return 8 * B5 + sf;
      let val = 0, cnt = 0;
      for (let r = 12; r >= 0 && cnt < 5; r--) if (m & (1 << r)) { val = val * B + r; cnt++; }
      return 5 * B5 + val;
    }
    let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const k = rc[r];
      if (k === 4) quad = r;
      else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (quad >= 0) {
      let kick = -1;
      for (let r = 12; r >= 0; r--) if (r !== quad && rc[r] > 0) { kick = r; break; }
      return 7 * B5 + quad * B + kick;
    }
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
      const p = t2 >= 0 ? (p1 > t2 ? p1 : t2) : p1;
      return 6 * B5 + t1 * B + p;
    }
    const st = STRAIGHT[mask];
    if (st >= 0) return 4 * B5 + st;
    if (t1 >= 0) {
      let val = t1, cnt = 0;
      for (let r = 12; r >= 0 && cnt < 2; r--) if (r !== t1 && rc[r] > 0) { val = val * B + r; cnt++; }
      return 3 * B5 + val;
    }
    if (p2 >= 0) {
      let kick = 0;
      for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r] > 0) { kick = r; break; }
      return 2 * B5 + (p1 * B + p2) * B + kick;
    }
    if (p1 >= 0) {
      let val = p1, cnt = 0;
      for (let r = 12; r >= 0 && cnt < 3; r--) if (r !== p1 && rc[r] > 0) { val = val * B + r; cnt++; }
      return 1 * B5 + val;
    }
    let val = 0, cnt = 0;
    for (let r = 12; r >= 0 && cnt < 5; r--) if (rc[r] > 0) { val = val * B + r; cnt++; }
    return val;
  }

  const categoryOf = (score) => (score / B5) | 0;
  const handName = (score) => {
    const cat = categoryOf(score);
    if (cat === 8 && score - 8 * B5 === 12) return 'Роял-флеш';
    return CATEGORY_NAMES[cat];
  };

  NS.Evaluator = { evaluate, categoryOf, handName, CATEGORY_NAMES, B5 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
