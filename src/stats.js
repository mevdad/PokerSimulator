(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // HUD-статистика игрока (как в Hand2Note / PokerTracker из статьи): то, что видно всем за столом.
  // Все показатели сглажены априорными значениями, чтобы не прыгать на малой выборке.
  const FIELDS = ['hands', 'vpip', 'pfr', 'threeBetOpp', 'threeBet', 'agg', 'calls', 'folds',
    'facedBet', 'foldedToBet', 'cbetOpp', 'cbet', 'sawFlop', 'showdowns', 'wonSd'];

  class Stats {
    constructor() { this.reset(); }
    reset() { for (const f of FIELDS) this[f] = 0; }
    decay(k) { for (const f of FIELDS) this[f] *= k; }
    get vpipPct() { return (this.vpip + 3) / (this.hands + 12); }
    get pfrPct() { return (this.pfr + 1.7) / (this.hands + 12); }
    get afq() { return (this.agg + 3.5) / (this.agg + this.calls + this.folds + 10); }
    get foldToBetPct() { return (this.foldedToBet + 3.6) / (this.facedBet + 8); }
    get cbetPct() { return (this.cbet + 3) / (this.cbetOpp + 5); }
    get threeBetPct() { return (this.threeBet + 0.4) / (this.threeBetOpp + 10); }
    get wtsdPct() { return (this.showdowns + 1.2) / (this.sawFlop + 5); }
    get wsdPct() { return (this.wonSd + 1.5) / (this.showdowns + 3); }
    hud() {
      return { hands: this.hands, vpip: this.vpipPct, pfr: this.pfrPct, afq: this.afq, foldToBet: this.foldToBetPct };
    }
  }

  // Динамическая метка стиля по статистике (как её видели бы оппоненты).
  function styleLabel(st) {
    if (st.hands < 40) return 'нет данных';
    const v = st.vpipPct, p = st.pfrPct, a = st.afq;
    if (v > 0.42 && p < 0.14) return 'Рыба (станция)';
    if (v > 0.38 && p > 0.24) return 'Маньяк';
    if (v < 0.15) return 'Нит';
    if (v < 0.30 && p / v > 0.62) return a > 0.42 ? 'TAG (агр.)' : 'TAG';
    if (v >= 0.30 && p > 0.2) return 'LAG';
    if (p / v < 0.4) return 'Пассив';
    return 'Регуляр';
  }

  NS.Stats = Stats;
  NS.styleLabel = styleLabel;
})(typeof globalThis !== 'undefined' ? globalThis : window);
