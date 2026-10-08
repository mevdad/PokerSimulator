(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // Рейтинг 169 стартовых рук. Берём формулу Чена с поправкой на пары и строим
  // перцентиль: 0.0 = AA (самая сильная), 1.0 = самая слабая. Перцентиль считается по
  // количеству комбинаций, поэтому "топ 15% рук" действительно значит 15% из 1326 комбо.
  const PCT = new Float32Array(13 * 13 * 2);

  function chen(hi, lo, suited) {
    const val = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
    let s = val(hi);
    if (hi === lo) return Math.max(7, s * 2);
    if (suited) s += 2;
    const gap = hi - lo - 1;
    s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 10) s += 1;
    return Math.ceil(s);
  }

  (function build() {
    const classes = [];
    for (let hi = 0; hi < 13; hi++) {
      for (let lo = 0; lo <= hi; lo++) {
        if (hi === lo) {
          classes.push({ hi, lo, suited: 0, combos: 6, score: chen(hi, lo, 0) });
        } else {
          classes.push({ hi, lo, suited: 1, combos: 4, score: chen(hi, lo, 1) });
          classes.push({ hi, lo, suited: 0, combos: 12, score: chen(hi, lo, 0) });
        }
      }
    }
    classes.sort((a, b) =>
      b.score - a.score ||
      (b.hi === b.lo) - (a.hi === a.lo) ||
      b.suited - a.suited ||
      b.hi - a.hi || b.lo - a.lo);
    let acc = 0;
    for (const c of classes) {
      PCT[(c.hi * 13 + c.lo) * 2 + c.suited] = (acc + c.combos / 2) / 1326;
      acc += c.combos;
    }
  })();

  function preflopPct(c1, c2) {
    const r1 = c1 >> 2, r2 = c2 >> 2;
    const hi = r1 > r2 ? r1 : r2, lo = r1 > r2 ? r2 : r1;
    const suited = r1 !== r2 && (c1 & 3) === (c2 & 3) ? 1 : 0;
    return PCT[(hi * 13 + lo) * 2 + suited];
  }

  // Руки, которыми удобно блефовать 3-бетом: низкие suited-тузы (блокеры) и suited-коннекторы.
  function isBluff3betHand(c1, c2) {
    const r1 = c1 >> 2, r2 = c2 >> 2;
    if ((c1 & 3) !== (c2 & 3) || r1 === r2) return false;
    const hi = r1 > r2 ? r1 : r2, lo = r1 > r2 ? r2 : r1;
    if (hi === 12 && lo <= 3) return true;
    return hi - lo <= 2 && hi >= 4 && hi <= 10;
  }

  function handLabel(c1, c2) {
    const R = '23456789TJQKA';
    const r1 = c1 >> 2, r2 = c2 >> 2;
    const hi = r1 > r2 ? r1 : r2, lo = r1 > r2 ? r2 : r1;
    if (hi === lo) return R[hi] + R[lo];
    return R[hi] + R[lo] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
  }

  NS.Preflop = { preflopPct, isBluff3betHand, handLabel };
})(typeof globalThis !== 'undefined' ? globalThis : window);
