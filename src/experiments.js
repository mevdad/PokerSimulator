(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  // Перебор сценариев «компания vs игроки»: сетка из числа ботов компании, игроков,
  // лимита компании за столом и числа столов. Каждый сценарий - отдельная симуляция.
  function parseList(str, fallback) {
    const out = String(str === undefined || str === null ? '' : str).split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
    return out.length ? Array.from(new Set(out)) : fallback;
  }

  function buildScenarios(o) {
    const out = [];
    const seed = o.seed === undefined ? 1 : o.seed;
    for (const tables of o.tables) for (const maxTeam of o.maxTeams) for (const company of o.companies) for (const players of o.players) {
      for (let r = 0; r < o.repeats; r++) out.push({ company, players, maxTeam, tables, repeat: r, seed: (seed + r * 7919) >>> 0 });
    }
    return out;
  }

  class Runner {
    constructor(scenarios, hands, base) {
      this.sc = scenarios; this.hands = hands; this.base = base || {};
      this.i = 0; this.sim = null; this.results = []; this.done = false;
    }
    get total() { return this.sc.length * this.hands; }
    get completed() { return this.results.length * this.hands + (this.sim ? Math.min(this.sim.totalHands, this.hands) : 0); }
    get progress() { return this.total ? this.completed / this.total : 1; }

    start(s) {
      const cfg = Object.assign({}, this.base, {
        mode: 'versus', bots: s.company, players: s.players, maxTeamPerTable: s.maxTeam, tables: s.tables, seed: s.seed,
      });
      this.cur = s;
      this.sim = new NS.Simulation(cfg);
    }

    finish() {
      const sim = this.sim, s = this.cur;
      const T = sim.teamStats(), hT = sim.hold('turnover'), hD = sim.hold('drop');
      this.results.push({
        company: s.company, players: s.players, maxTeam: s.maxTeam, tables: s.tables, repeat: s.repeat, seed: s.seed,
        hands: sim.totalHands,
        holdT: hT.value, loT: hT.lo, hiT: hT.hi, holdD: hD.value,
        bbC: T.company.bb100, bbP: T.player.bb100, profitC: T.company.profit, profitP: T.player.profit,
        flowT: T.player.turnover, flowD: T.player.drop, winC: T.company.winShare, winP: T.player.winShare,
        rakeC: T.company.rake, rakeP: T.player.rake,
      });
      this.sim = null; this.i++;
    }

    // Выполняет работу не дольше ms миллисекунд; возвращает true, пока есть что считать.
    step(ms) {
      const end = now() + ms;
      while (!this.done && now() < end) {
        if (!this.sim) {
          if (this.i >= this.sc.length) { this.done = true; break; }
          this.start(this.sc[this.i]);
        }
        this.sim.runFor(Math.max(1, Math.min(25, end - now())));
        if (this.sim.totalHands >= this.hands) this.finish();
      }
      return !this.done;
    }
  }

  // Усреднение повторов (разные seed) для одинаковой конфигурации.
  function aggregate(results) {
    const groups = new Map();
    for (const r of results) {
      const k = [r.tables, r.maxTeam, r.company, r.players].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
    const sd = (a, f) => {
      if (a.length < 2) return NaN;
      const m = mean(a, f);
      return Math.sqrt(a.reduce((s, x) => s + (f(x) - m) * (f(x) - m), 0) / (a.length - 1));
    };
    const rows = [];
    for (const a of groups.values()) {
      const f = a[0];
      rows.push({
        tables: f.tables, maxTeam: f.maxTeam, company: f.company, players: f.players, n: a.length,
        holdT: mean(a, (x) => x.holdT), holdTsd: sd(a, (x) => x.holdT),
        loT: mean(a, (x) => x.loT), hiT: mean(a, (x) => x.hiT),
        holdD: mean(a, (x) => x.holdD), bbC: mean(a, (x) => x.bbC), bbP: mean(a, (x) => x.bbP),
        profitC: mean(a, (x) => x.profitC), flowT: mean(a, (x) => x.flowT), winC: mean(a, (x) => x.winC),
        hands: f.hands, seed: f.seed,
      });
    }
    return rows;
  }

  function toCsv(rows) {
    const head = ['tables', 'max_company_per_table', 'company_bots', 'players', 'runs', 'hold_turnover_pct', 'hold_turnover_sd_pct',
      'ci_low_pct', 'ci_high_pct', 'hold_drop_pct', 'company_bb100', 'players_bb100', 'company_profit_usd', 'players_turnover_usd', 'company_winners_pct'];
    const p = (x) => (Number.isFinite(x) ? (x * 100).toFixed(3) : '');
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([r.tables, r.maxTeam, r.company, r.players, r.n, p(r.holdT), p(r.holdTsd), p(r.loT), p(r.hiT), p(r.holdD),
        r.bbC.toFixed(2), r.bbP.toFixed(2), r.profitC.toFixed(2), r.flowT.toFixed(2), (r.winC * 100).toFixed(1)].join(','));
    }
    return lines.join('\n');
  }

  NS.Experiments = { parseList, buildScenarios, Runner, aggregate, toCsv };
})(typeof globalThis !== 'undefined' ? globalThis : window);
