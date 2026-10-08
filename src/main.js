(function () {
  'use strict';
  const NS = window.PokerSim;
  const $ = (id) => document.getElementById(id);

  const SPEEDS = { turbo: Infinity };
  let sim = null, ui = null;
let importedSeeds = null;          // гены компании, загруженные из JSON
  let running = true, speed = 4, last = performance.now();
  let hpsMark = { t: performance.now(), h: 0 };

  const FIELD_DEFAULTS = {
    cfgMode: 'versus', cfgBots: 200, cfgPlayers: 200, cfgMaxTeam: 2, cfgTables: 3, cfgSeats: 6, cfgSb: 0.25, cfgBb: 0.5,
    cfgMinBuy: 20, cfgMaxBuy: 100, cfgRake: 0, cfgRakeCap: 3, cfgFixed: 25, cfgGen: 4000, cfgSeed: '',
  };

  function readConfig() {
    const n = (id, d) => { const v = Number($(id).value); return Number.isFinite(v) && $(id).value !== '' ? v : d; };
    const sb = Math.max(1, Math.round(n('cfgSb', 0.25) * 100));
    const bb = Math.max(2, Math.round(n('cfgBb', 0.5) * 100));
    const cfg = {
      mode: $('cfgMode').value,
      players: Math.max(2, Math.min(1000, Math.round(n('cfgPlayers', 200)))),
      maxTeamPerTable: Math.max(1, Math.min(10, Math.round(n('cfgMaxTeam', 2)))),
      bots: Math.max(2, Math.min(1000, Math.round(n('cfgBots', 200)))),
      tables: Math.max(1, Math.min(8, Math.round(n('cfgTables', 3)))),
      seats: Math.max(2, Math.min(10, Math.round(n('cfgSeats', 6)))),
      sb: Math.min(sb, bb), bb,
      minBuyBB: n('cfgMinBuy', 20), maxBuyBB: Math.max(n('cfgMaxBuy', 100), n('cfgMinBuy', 20)),
      rakePct: Math.max(0, n('cfgRake', 0)) / 100, rakeCapBB: Math.max(0, n('cfgRakeCap', 3)),
      fixedShare: Math.max(0, Math.min(0.9, n('cfgFixed', 25) / 100)),
      genHands: Math.max(500, n('cfgGen', 4000)),
      evolution: $('cfgEvo').checked,
    };
    if ($('cfgSeed').value !== '') cfg.seed = Number($('cfgSeed').value);
    if (importedSeeds) cfg.companySeeds = importedSeeds;
    return cfg;
  }

  function start(cfg) {
    sim = new NS.Simulation(cfg);
    ui.attach(sim);
    hpsMark = { t: performance.now(), h: 0 };
    try { const c = Object.assign({}, cfg); delete c.companySeeds; localStorage.setItem('pokerArenaCfg2', JSON.stringify(c)); } catch (e) { /* ignore */ }
  }

  function loadSaved() {
    try {
      const c = JSON.parse(localStorage.getItem('pokerArenaCfg2') || 'null');
      if (!c) return;
      if (c.mode) $('cfgMode').value = c.mode;
      if (c.players) $('cfgPlayers').value = c.players;
      if (c.maxTeamPerTable) $('cfgMaxTeam').value = c.maxTeamPerTable;
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
    const cfgOut = Object.assign({}, sim.cfg); delete cfgOut.companySeeds;
    const extra = sim.versus ? { teams: sim.teamStats(), holdTurnover: sim.hold('turnover'), holdDrop: sim.hold('drop') } : {};
    for (const k of ['holdTurnover', 'holdDrop']) if (extra[k]) delete extra[k].series;
    if (extra.teams) for (const k of ['company', 'player']) delete extra.teams[k].profitList;
    const blob = new Blob([JSON.stringify(Object.assign({ config: cfgOut, totalHands: sim.totalHands, generation: sim.generation }, extra, { bots: rows }), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `poker-arena-${sim.totalHands}-hands.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }


  // ------------------------------------------------------------ эксперименты
  let expRunner = null, expRows = [], expTimer = null, wasRunning = true;

  function expBase() {
    const c = readConfig();
    return { seats: c.seats, sb: c.sb, bb: c.bb, minBuyBB: c.minBuyBB, maxBuyBB: c.maxBuyBB, rakePct: c.rakePct, rakeCapBB: c.rakeCapBB,
      genHands: c.genHands, evolution: c.evolution, companySeeds: importedSeeds || undefined };
  }

  function renderExp() {
    const target = (Number($('inpTarget').value) || 3) / 100;
    const E = NS.Experiments;
    expRows = E.aggregate(expRunner ? expRunner.results : []);
    expRows.sort((a, b) => Math.abs(a.holdT - target) - Math.abs(b.holdT - target));
    const pc = (x, d) => (Number.isFinite(x) ? (x * 100).toFixed(d === undefined ? 2 : d) + '%' : '—');
    let h = `<thead><tr><th>Столы</th><th>Макс/стол</th><th>Компания</th><th>Игроки</th><th>Доля от оборота</th><th>95% ДИ / sd</th>
      <th>Доля от закупок</th><th>bb/100 компании</th><th>bb/100 игроков</th><th>Прибыль компании</th><th>Ботов в плюсе</th><th></th></tr></thead><tbody>`;
    expRows.forEach((r, i) => {
      const hit = r.n === 1 && Number.isFinite(r.loT) && target >= r.loT && target <= r.hiT;
      const spread = r.n > 1 ? `±${pc(r.holdTsd)} sd` : `${pc(r.loT, 1)} … ${pc(r.hiT, 1)}`;
      h += `<tr class="${hit ? 'hit' : ''} ${i === 0 ? 'best' : ''}"><td>${r.tables}</td><td>${r.maxTeam}</td><td>${r.company}</td><td>${r.players}</td>
        <td><b>${pc(r.holdT)}</b></td><td>${spread}</td><td>${pc(r.holdD, 1)}</td><td>${r.bbC.toFixed(1)}</td><td>${r.bbP.toFixed(1)}</td>
        <td>$${r.profitC.toFixed(0)}</td><td>${(r.winC * 100).toFixed(0)}%</td>
        <td><button class="btn watch" data-i="${i}" title="Запустить этот вариант вживую">▶ смотреть</button></td></tr>`;
    });
    $('expTable').innerHTML = h + '</tbody>';
    $('expCsv').disabled = !expRows.length;
  }

  function expTick() {
    if (!expRunner) return;
    const more = expRunner.step(40);
    $('expBar').style.width = (expRunner.progress * 100).toFixed(1) + '%';
    $('expInfo').textContent = `${expRunner.results.length}/${expRunner.sc.length} прогонов, ${(expRunner.progress * 100).toFixed(0)}%`;
    if (expRunner.results.length !== expRows.length || !more) renderExp();
    if (more) expTimer = setTimeout(expTick, 0);
    else { $('expRun').disabled = false; $('expStop').disabled = true; $('expInfo').textContent += ' — готово'; }
  }

  function expStart() {
    const E = NS.Experiments, cur = readConfig();
    const o = {
      companies: E.parseList($('expCompany').value, [200]), players: E.parseList($('expPlayers').value, [200]),
      maxTeams: E.parseList($('expMaxTeam').value, [2]), tables: E.parseList($('expTables').value, [cur.tables]),
      repeats: Math.max(1, Math.min(10, Number($('expRepeats').value) || 1)), seed: cur.seed === undefined ? 1 : cur.seed,
    };
    const sc = E.buildScenarios(o);
    if (sc.length > 80) { $('expInfo').textContent = `Слишком много сценариев (${sc.length}). Уменьшите списки (максимум 80).`; return; }
    const hands = Math.max(2000, Number($('expHands').value) || 30000);
    expRunner = new E.Runner(sc, hands, expBase());
    expRows = [];
    $('expRun').disabled = true; $('expStop').disabled = false;
    $('expTable').innerHTML = '';
    expTick();
  }

  function expStop() { clearTimeout(expTimer); $('expRun').disabled = false; $('expStop').disabled = true; $('expInfo').textContent += ' — остановлено'; if (expRunner) { expRunner.done = true; renderExp(); } }

  function initExperiments() {
    $('btnExp').addEventListener('click', () => {
      wasRunning = running; setRunning(false);
      if (!$('expTables').dataset.touched) $('expTables').value = String(readConfig().tables);
      $('dlgExp').showModal();
    });
    $('expTables').addEventListener('input', () => { $('expTables').dataset.touched = '1'; });
    $('dlgExp').addEventListener('close', () => { clearTimeout(expTimer); if (expRunner && !expRunner.done) expRunner.done = true; $('expRun').disabled = false; $('expStop').disabled = true; if (wasRunning) setRunning(true); });
    $('expRun').addEventListener('click', (e) => { e.preventDefault(); expStart(); });
    $('expStop').addEventListener('click', (e) => { e.preventDefault(); expStop(); });
    $('expCsv').addEventListener('click', (e) => {
      e.preventDefault();
      const blob = new Blob([NS.Experiments.toCsv(expRows)], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'company-vs-players-experiments.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('expTable').addEventListener('click', (e) => {
      const b = e.target.closest('button.watch');
      if (!b) return;
      e.preventDefault();
      const r = expRows[Number(b.dataset.i)];
      $('cfgMode').value = 'versus'; $('cfgBots').value = r.company; $('cfgPlayers').value = r.players;
      $('cfgMaxTeam').value = r.maxTeam; $('cfgTables').value = r.tables; $('cfgSeed').value = r.seed;
      wasRunning = true; $('dlgExp').close(); start(readConfig());
    });
  }

  function init() {
    ui = new NS.UI();
    loadSaved();
    initExperiments();
    $('btnPlay').addEventListener('click', () => setRunning(!running));
    $('selSpeed').addEventListener('change', (e) => { speed = e.target.value === 'turbo' ? Infinity : Number(e.target.value); });
    $('btnSettings').addEventListener('click', () => $('dlgSettings').showModal());
    $('btnExport').addEventListener('click', exportJson);
    $('cfgMode').addEventListener('change', (e) => { $('cfgRake').value = e.target.value === 'versus' ? 0 : 3; });
    $('cfgSeedFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          let genomes = [];
          if (Array.isArray(d.genomes)) genomes = d.genomes;                  // data/company-seed.json
          else if (Array.isArray(d.bots)) {                                   // результат «⭳ JSON»
            genomes = d.bots.filter((b) => !b.fixed && b.genome && b.hands >= 1000).sort((a, b) => b.bb100s - a.bb100s).slice(0, 60).map((b) => b.genome);
          }
          if (!genomes.length) throw new Error('в файле нет геномов');
          importedSeeds = genomes;
          $('seedInfo').textContent = `Загружено геномов: ${genomes.length}. Они станут стартовой популяцией компании при перезапуске.`;
        } catch (err) { $('seedInfo').textContent = 'Не удалось прочитать файл: ' + err.message; }
      };
      rd.readAsText(f);
    });
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
    for (const [k, id] of [['bots', 'cfgBots'], ['players', 'cfgPlayers'], ['maxteam', 'cfgMaxTeam'], ['mode', 'cfgMode'], ['rake', 'cfgRake'], ['tables', 'cfgTables'], ['seats', 'cfgSeats'], ['sb', 'cfgSb'], ['bb', 'cfgBb'], ['seed', 'cfgSeed']]) {
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
