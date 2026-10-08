(function () {
  'use strict';
  const NS = window.PokerSim;
  const $ = (id) => document.getElementById(id);

  const SPEEDS = { turbo: Infinity };
  let sim = null, ui = null;
  let running = true, speed = 4, last = performance.now();
  let hpsMark = { t: performance.now(), h: 0 };

  const FIELD_DEFAULTS = {
    cfgBots: 200, cfgTables: 3, cfgSeats: 6, cfgSb: 0.25, cfgBb: 0.5, cfgMinBuy: 20, cfgMaxBuy: 100,
    cfgRake: 3, cfgRakeCap: 3, cfgFixed: 25, cfgGen: 4000, cfgSeed: '',
  };

  function readConfig() {
    const n = (id, d) => { const v = Number($(id).value); return Number.isFinite(v) && $(id).value !== '' ? v : d; };
    const sb = Math.max(1, Math.round(n('cfgSb', 0.25) * 100));
    const bb = Math.max(2, Math.round(n('cfgBb', 0.5) * 100));
    const cfg = {
      bots: Math.max(2, Math.min(1000, Math.round(n('cfgBots', 200)))),
      tables: Math.max(1, Math.min(8, Math.round(n('cfgTables', 3)))),
      seats: Math.max(2, Math.min(10, Math.round(n('cfgSeats', 6)))),
      sb: Math.min(sb, bb), bb,
      minBuyBB: n('cfgMinBuy', 20), maxBuyBB: Math.max(n('cfgMaxBuy', 100), n('cfgMinBuy', 20)),
      rakePct: Math.max(0, n('cfgRake', 3)) / 100, rakeCapBB: Math.max(0, n('cfgRakeCap', 3)),
      fixedShare: Math.max(0, Math.min(0.9, n('cfgFixed', 25) / 100)),
      genHands: Math.max(500, n('cfgGen', 4000)),
      evolution: $('cfgEvo').checked,
    };
    if ($('cfgSeed').value !== '') cfg.seed = Number($('cfgSeed').value);
    return cfg;
  }

  function start(cfg) {
    sim = new NS.Simulation(cfg);
    ui.attach(sim);
    hpsMark = { t: performance.now(), h: 0 };
    try { localStorage.setItem('pokerArenaCfg', JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  function loadSaved() {
    try {
      const c = JSON.parse(localStorage.getItem('pokerArenaCfg') || 'null');
      if (!c) return;
      $('cfgBots').value = c.bots; $('cfgTables').value = c.tables; $('cfgSeats').value = c.seats;
      $('cfgSb').value = (c.sb / 100); $('cfgBb').value = (c.bb / 100);
      $('cfgMinBuy').value = c.minBuyBB; $('cfgMaxBuy').value = c.maxBuyBB;
      $('cfgRake').value = c.rakePct * 100; $('cfgRakeCap').value = c.rakeCapBB;
      $('cfgFixed').value = Math.round(c.fixedShare * 100); $('cfgGen').value = c.genHands;
      $('cfgEvo').checked = c.evolution !== false;
    } catch (e) { /* ignore */ }
  }

  function setRunning(v) {
    running = v;
    $('btnPlay').textContent = running ? '⏸ Пауза' : '▶ Продолжить';
    last = performance.now();
  }

  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (running && sim) {
      if (speed === Infinity) sim.runFor(14);
      else sim.tick(dt, speed);
    }
    if (sim) {
      ui.frame(now);
      if (now - hpsMark.t > 1000) {
        const hps = ((sim.totalHands - hpsMark.h) * 1000) / (now - hpsMark.t);
        $('kHps').textContent = hps >= 10 ? Math.round(hps) : hps.toFixed(1);
        hpsMark = { t: now, h: sim.totalHands };
      }
    }
    requestAnimationFrame(loop);
  }

  function exportJson() {
    const rows = sim.bots.map((b) => Object.assign(sim.row(b), { genome: b.genome }));
    rows.sort((a, b) => b.profit - a.profit);
    const blob = new Blob([JSON.stringify({ config: sim.cfg, totalHands: sim.totalHands, generation: sim.generation, bots: rows }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `poker-arena-${sim.totalHands}-hands.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function init() {
    ui = new NS.UI();
    loadSaved();
    $('btnPlay').addEventListener('click', () => setRunning(!running));
    $('selSpeed').addEventListener('change', (e) => { speed = e.target.value === 'turbo' ? Infinity : Number(e.target.value); });
    $('btnSettings').addEventListener('click', () => $('dlgSettings').showModal());
    $('btnExport').addEventListener('click', exportJson);
    $('btnApply').addEventListener('click', (e) => { e.preventDefault(); $('dlgSettings').close(); start(readConfig()); setRunning(true); });
    $('btnDefaults').addEventListener('click', (e) => {
      e.preventDefault();
      for (const [id, v] of Object.entries(FIELD_DEFAULTS)) $(id).value = v;
      $('cfgEvo').checked = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); setRunning(!running); }
    });
    // параметры из адресной строки: ?bots=50&tables=2&seats=9&speed=turbo&seed=1
    const q = new URLSearchParams(location.search);
    for (const [k, id] of [['bots', 'cfgBots'], ['tables', 'cfgTables'], ['seats', 'cfgSeats'], ['sb', 'cfgSb'], ['bb', 'cfgBb'], ['seed', 'cfgSeed']]) {
      if (q.has(k)) $(id).value = q.get(k);
    }
    if (q.get('speed')) { $('selSpeed').value = q.get('speed'); speed = q.get('speed') === 'turbo' ? Infinity : Number(q.get('speed')); }
    start(readConfig());
    requestAnimationFrame(loop);
    window.__arena = { get sim() { return sim; }, ui };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
