(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});
  const { cardPretty } = NS.Cards;
  const { Genome, styleLabel } = NS;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (c) => '$' + (c / 100).toFixed(2);
  const fmt = (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d === undefined ? 2 : d);
  const COLORS = ['#f5b942', '#4cc3ff', '#2fbf71', '#c77dff', '#ff7a7a', '#ffffff'];

  function cardHtml(c, small) {
    if (c === null || c === undefined) return `<span class="card ${small ? 'sm' : ''} empty"></span>`;
    const p = cardPretty(c);
    return `<span class="card ${small ? 'sm' : ''} ${p.red ? 'red' : ''}">${p.rank}<span class="s">${p.sym}</span></span>`;
  }
  const backHtml = (small) => `<span class="card ${small ? 'sm' : ''} back"></span>`;

  // кэшируем значения, чтобы не трогать DOM без необходимости
  function setText(el, v) { if (el._t !== v) { el._t = v; el.textContent = v; } }
  function setHtml(el, v) { if (el._h !== v) { el._h = v; el.innerHTML = v; } }
  function setCls(el, v) { if (el._c !== v) { el._c = v; el.className = v; } }
  function setDisp(el, v) { if (el._d !== v) { el._d = v; el.style.display = v; } }

  // ================================================================ СТОЛ
  class TableView {
    constructor(table, ui) {
      this.table = table; this.ui = ui;
      const n = table.seats.length;
      const card = document.createElement('div');
      card.className = 'table-card' + (n >= 8 ? ' dense' : '');
      card.innerHTML = `
        <div class="table-head"><span class="t-title"></span><small class="t-meta"></small></div>
        <div class="felt-wrap"><div class="felt"><div class="felt-inner">
          <div class="center-info"><div class="pot"></div><div class="board-cards"></div><div class="street-name"></div></div>
        </div></div></div>
        <div class="table-log"></div>`;
      this.el = card;
      this.inner = card.querySelector('.felt-inner');
      this.refs = {
        title: card.querySelector('.t-title'), meta: card.querySelector('.t-meta'),
        pot: card.querySelector('.pot'), board: card.querySelector('.board-cards'),
        street: card.querySelector('.street-name'), log: card.querySelector('.table-log'),
      };
      this.seatEls = [];
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x = 50 + 41 * Math.cos(ang), y = 50 + 39 * Math.sin(ang);
        const seat = document.createElement('div');
        seat.className = 'seat empty';
        seat.style.left = x + '%'; seat.style.top = y + '%';
        seat.innerHTML = `<div class="plate"><span class="pos"></span><span class="dealer">D</span>
          <div class="cards"></div><div class="name"></div><div class="stack"></div><div class="tag"></div>
          <div class="action"></div></div>`;
        this.inner.appendChild(seat);
        const chip = document.createElement('div');
        chip.className = 'betchip';
        chip.style.left = (50 + 19 * Math.cos(ang)) + '%'; chip.style.top = (50 + 16 * Math.sin(ang)) + '%';
        this.inner.appendChild(chip);
        const r = {
          root: seat, pos: seat.querySelector('.pos'), cards: seat.querySelector('.cards'),
          name: seat.querySelector('.name'), stack: seat.querySelector('.stack'), tag: seat.querySelector('.tag'),
          action: seat.querySelector('.action'), chip, botId: -1,
        };
        r.name.addEventListener('click', () => { if (r.botId >= 0) ui.openBot(r.botId); });
        this.seatEls.push(r);
      }
      const cfg = table.cfg;
      setText(this.refs.title, `Стол ${table.id + 1}`);
      setText(this.refs.meta, `NL${Math.round(cfg.bb)} · ${money(cfg.sb)}/${money(cfg.bb)} · ${cfg.seats}-max`);
    }

    update(showCards) {
      const t = this.table, R = this.refs;
      let potTotal = t.pot;
      for (const s of t.seats) if (s) potTotal += s.bet;
      if (t.phase === 'ended' && t.lastHand) potTotal = t.lastHand.pot;
      setText(R.pot, potTotal > 0 ? 'Банк ' + money(potTotal) : '');
      let bhtml = '';
      for (let i = 0; i < 5; i++) bhtml += cardHtml(t.board[i] === undefined ? null : t.board[i]);
      setHtml(R.board, bhtml);
      const streetRu = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
      setText(R.street, t.phase === 'waiting' ? 'ожидание игроков' : t.phase === 'ended' ? (t.lastHand && t.lastHand.showdown ? 'вскрытие' : 'раздача окончена') : streetRu[t.street]);
      setText(R.meta, `NL${Math.round(t.cfg.bb)} · ${money(t.cfg.sb)}/${money(t.cfg.bb)} · рука #${t.handNo} · рейк ${money(t.rakeTotal)}`);

      for (let i = 0; i < t.seats.length; i++) {
        const s = t.seats[i], r = this.seatEls[i];
        if (!s) {
          setCls(r.root, 'seat empty');
          setText(r.name, 'свободно'); setText(r.stack, ''); setText(r.tag, '');
          setHtml(r.cards, ''); setText(r.action, ''); setDisp(r.action, 'none'); setDisp(r.chip, 'none'); setText(r.pos, '');
          r.botId = -1;
          continue;
        }
        const bot = s.bot;
        r.botId = bot.id;
        const acting = t.phase === 'betting' && t.toAct === i;
        const winner = t.phase === 'ended' && s.win > 0;
        const cls = ['seat'];
        if (s.inHand && s.folded) cls.push('folded');
        if (acting) cls.push('acting');
        if (winner) cls.push('winner');
        if (t.button === i && s.inHand) cls.push('btn');
        if (bot.team === 'company') cls.push('tc'); else if (bot.team === 'player') cls.push('tp');
        setCls(r.root, cls.join(' '));
        setText(r.name, bot.name);
        setText(r.stack, money(s.stack));
        if (r._tagHand !== t.handNo || r._tagBot !== bot.id) {
          r._tagHand = t.handNo; r._tagBot = bot.id;
          setText(r.tag, `${styleLabel(bot.stats)} · ${Genome.stackStrategy(bot.genome)}`);
        }
        setText(r.pos, s.inHand ? s.position : '');
        // карты
        let ch = '';
        if (s.inHand && s.hole.length === 2) {
          const face = showCards || s.show;
          ch = face ? cardHtml(s.hole[0], true) + cardHtml(s.hole[1], true) : backHtml(true) + backHtml(true);
        }
        setHtml(r.cards, ch);
        // действие
        let at = s.lastAction, ac = '';
        if (t.phase === 'ended' && s.inHand) {
          if (s.win > 0) { at = `+${money(s.win)}${s.handText ? ' · ' + s.handText : ''}`; ac = 'a-win'; }
          else if (!s.folded && s.show && s.handText) at = s.handText;
        }
        if (!ac && at) ac = at.startsWith('Fold') ? 'a-fold' : at.startsWith('Call') || at.startsWith('Check') ? 'a-call' : 'a-raise';
        setText(r.action, at);
        setCls(r.action, 'action ' + ac);
        setDisp(r.action, at ? 'block' : 'none');
        // фишки ставки
        if (s.bet > 0) { setText(r.chip, money(s.bet)); setDisp(r.chip, 'block'); } else setDisp(r.chip, 'none');
      }
      // лог
      const lines = t.log.slice(-3);
      setHtml(R.log, lines.map((l) => `<div class="${l.kind}">${esc(l.text)}</div>`).join(''));
    }
  }

  // ================================================================ ГРАФИКИ
  function drawLines(canvas, series, opt) {
    const dpr = window.devicePixelRatio || 1;
    const H = opt.height || 170;
    const W = canvas.clientWidth || 400;
    canvas.style.height = H + 'px';
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 44, padR = 8, padT = 8, padB = 18;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of series) for (let i = 0; i < s.x.length; i++) {
      xmin = Math.min(xmin, s.x[i]); xmax = Math.max(xmax, s.x[i]);
      ymin = Math.min(ymin, s.y[i]); ymax = Math.max(ymax, s.y[i]);
    }
    if (!isFinite(xmin) || xmax === xmin) {
      ctx.fillStyle = '#6b7788'; ctx.font = '12px system-ui'; ctx.fillText('Собираем данные…', 12, H / 2);
      return;
    }
    if (opt.zero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
    if (ymax === ymin) { ymax += 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
    const X = (v) => padL + ((v - xmin) / (xmax - xmin)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - ymin) / (ymax - ymin)) * (H - padT - padB);
    ctx.strokeStyle = '#26303f'; ctx.fillStyle = '#7d8999'; ctx.font = '10.5px system-ui'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = ymin + ((ymax - ymin) * i) / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(opt.yfmt ? opt.yfmt(v) : v.toFixed(0), 4, y + 3);
    }
    if (opt.zero) {
      ctx.strokeStyle = '#4a586b'; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();
    }
    ctx.fillText(opt.xfmt ? opt.xfmt(xmin) : xmin.toFixed(0), padL, H - 4);
    const xe = opt.xfmt ? opt.xfmt(xmax) : xmax.toFixed(0);
    ctx.fillText(xe, W - padR - ctx.measureText(xe).width, H - 4);
    series.forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      for (let i = 0; i < s.x.length; i++) {
        const px = X(s.x[i]), py = Y(s.y[i]);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // легенда
    if (opt.legend) {
      ctx.font = '10.5px system-ui';
      let lx = padL + 4, ly = padT + 10;
      series.forEach((s) => {
        const w = ctx.measureText(s.name).width + 18;
        if (lx + w > W - padR) { lx = padL + 4; ly += 13; }
        ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 7, 9, 3);
        ctx.fillStyle = '#c2ccda'; ctx.fillText(s.name, lx + 13, ly - 3);
        lx += w + 4;
      });
    }
  }

  // ================================================================ UI
  class UI {
    constructor() {
      this.sim = null;
      this.views = [];
      this.sortKey = 'profit'; this.sortDir = -1;
      this.selected = -1;
      this.showCards = true;
      this.lastBoard = 0; this.lastCharts = 0; this.lastEvents = -1;
      this.bindStatic();
    }

    bindStatic() {
      $('chkCards').addEventListener('change', (e) => { this.showCards = e.target.checked; });
      $('selFilter').addEventListener('change', () => this.renderBoard(true));
      $('selFlow').addEventListener('change', () => { this.renderTeam(); this.renderCharts(); });
      $('inpTarget').addEventListener('input', () => { this.renderTeam(); this.renderCharts(); });
      $('inpSearch').addEventListener('input', () => this.renderBoard(true));
      document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (k === 'rank') { this.sortKey = 'profit'; this.sortDir = -1; }
        else if (this.sortKey === k) this.sortDir *= -1;
        else { this.sortKey = k; this.sortDir = (k === 'name' || k === 'style' || k === 'strategy' || k === 'table') ? 1 : -1; }
        this.renderBoard(true);
      }));
      $('boardBody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (tr && tr.dataset.id !== undefined) this.openBot(Number(tr.dataset.id));
      });
      $('dlgBot').addEventListener('close', () => { this.botOpen = false; });
    }

    attach(sim) {
      this.sim = sim;
      this.selected = -1;
      const host = $('tables');
      host.innerHTML = '';
      this.views = sim.tables.map((t) => { const v = new TableView(t, this); host.appendChild(v.el); return v; });
      const c = sim.cfg;
      $('subtitle').textContent = `NL${c.bb} · $${(c.sb / 100).toFixed(2)}/$${(c.bb / 100).toFixed(2)} · ` + (sim.versus ? `${c.bots} ботов компании vs ${c.players} игроков` : `${c.bots} ботов`) + ` · ${c.tables} стол(а) × ${c.seats} мест · рейк ${(c.rakePct * 100).toFixed(1)}%`;
      this.lastEvents = -1;
      $('teamPanel').style.display = sim.versus ? '' : 'none';
      this.renderBoard(true); this.renderCharts(); this.renderEvents(true); this.renderTeam();
    }

    frame(now) {
      for (const v of this.views) v.update(this.showCards);
      const sim = this.sim;
      setText($('kHands'), sim.totalHands.toLocaleString('ru-RU'));
      setText($('kGen'), String(sim.generation));
      setText($('kRake'), '$' + sim.totals().rake.toFixed(0));
      if (now - this.lastBoard > 900) { this.lastBoard = now; this.renderBoard(false); this.renderEvents(false); this.renderTeam(); if (this.botOpen) this.renderBot(); }
      if (now - this.lastCharts > 2000) { this.lastCharts = now; this.renderCharts(); }
    }

    // ------------------------------------------------------------ рейтинг
    renderBoard(force) {
      const sim = this.sim;
      let rows = sim.ranking();
      // общий рейтинг по прибыли (для номера места)
      const byProfit = rows.slice().sort((a, b) => b.profit - a.profit);
      const rankOf = new Map(); byProfit.forEach((r, i) => rankOf.set(r.id, i + 1));
      const f = $('selFilter').value, q = $('inpSearch').value.trim().toLowerCase();
      if (f === 'evo') rows = rows.filter((r) => !r.fixed);
      else if (f === 'fixed') rows = rows.filter((r) => r.fixed);
      else if (f === 'playing') rows = rows.filter((r) => r.table >= 0);
      else if (f === 'company') rows = rows.filter((r) => r.team === 'company');
      else if (f === 'player') rows = rows.filter((r) => r.team === 'player');
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.style.toLowerCase().includes(q) || r.archLabel.toLowerCase().includes(q));
      const k = this.sortKey, d = this.sortDir;
      rows.sort((a, b) => {
        const x = a[k], y = b[k];
        if (typeof x === 'string') return d * x.localeCompare(y);
        return d * (x - y) || b.profit - a.profit;
      });
      document.querySelectorAll('#board th').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === k));
      const max = 400;
      let html = '';
      for (let i = 0; i < rows.length && i < max; i++) {
        const r = rows[i], rk = rankOf.get(r.id);
        const cls = (rk <= 3 ? 'r' + rk : '') + (r.id === this.selected ? ' sel' : '');
        const tdot = r.table >= 0 ? `<span class="tdot" style="background:${COLORS[r.table % COLORS.length]}"></span>${r.table + 1}` : '<span class="muted">—</span>';
        html += `<tr class="${cls}" data-id="${r.id}">
          <td>${rk}</td>
          <td>${r.team === 'company' ? '<span class="tm c" title="Команда компании"></span>' : r.team === 'player' ? '<span class="tm p" title="Игрок"></span>' : ''}${esc(r.name)} ${r.fixed && r.team !== 'player' ? '<span class="pill fixed" title="Фиксированный стиль, не обучается">' + esc(r.archLabel) + '</span>' : r.gen ? '<span class="pill" title="Сколько раз перенимал стиль лидеров">g' + r.gen + '</span>' : ''}</td>
          <td>${esc(r.style)}</td>
          <td><span class="pill ${r.strategy.toLowerCase()}">${r.strategy}</span></td>
          <td class="num ${r.profit >= 0 ? 'pos-n' : 'neg-n'}">${fmt(r.profit)}</td>
          <td class="num ${r.bb100 >= 0 ? 'pos-n' : 'neg-n'}">${fmt(r.bb100, 1)}</td>
          <td class="num">${r.hands}</td>
          <td class="num">${(r.vpip * 100).toFixed(0)}/${(r.pfr * 100).toFixed(0)}</td>
          <td class="num">${tdot}</td></tr>`;
      }
      setHtml($('boardBody'), html);
    }

    renderEvents(force) {
      const ev = this.sim.events;
      if (!force && ev.length === this.lastEvents) return;
      this.lastEvents = ev.length;
      const html = ev.slice(-40).reverse().map((e) => `<div class="${e.type}"><small>#${e.hand}</small>${esc(e.text)}</div>`).join('');
      setHtml($('events'), html || '<div class="muted">Событий пока нет — крупные банки и обучение ботов появятся здесь.</div>');
    }

    // ------------------------------------------------------------ графики
    renderCharts() {
      const sim = this.sim, hist = sim.history;
      this.renderTeamCharts();
      if (hist.length > 1) {
        const last = hist[hist.length - 1].p;
        const idx = Array.from(last.keys()).sort((a, b) => last[b] - last[a]).slice(0, 5);
        const series = idx.map((id, i) => ({
          name: sim.bots[id].name, color: COLORS[i], x: hist.map((h) => h.h), y: hist.map((h) => h.p[id]), width: 1.7,
        }));
        if (this.selected >= 0 && !idx.includes(this.selected)) {
          series.push({ name: sim.bots[this.selected].name + ' (выбран)', color: COLORS[5], dash: [4, 3], width: 1.6, x: hist.map((h) => h.h), y: hist.map((h) => h.p[this.selected]) });
        }
        drawLines($('chartProfit'), series, { height: 170, zero: true, legend: true, yfmt: (v) => '$' + v.toFixed(0), xfmt: (v) => Math.round(v / 1000) + 'k рук' });
      } else drawLines($('chartProfit'), [], { height: 170 });
      const evo = sim.evoLog;
      if (evo.length > 1) {
        const x = evo.map((e) => e.gen);
        drawLines($('chartEvo'), [
          { name: 'VPIP', color: '#4cc3ff', x, y: evo.map((e) => e.vpip * 100) },
          { name: 'PFR', color: '#f5b942', x, y: evo.map((e) => e.pfr * 100) },
          { name: 'агрессия', color: '#c77dff', x, y: evo.map((e) => e.afq * 100) },
        ], { height: 150, legend: true, yfmt: (v) => v.toFixed(0) + '%', xfmt: (v) => 'пок. ' + v });
      } else drawLines($('chartEvo'), [], { height: 150 });
    }

    // ------------------------------------------------------ компания vs игроки
    renderTeam() {
      const sim = this.sim;
      if (!sim || !sim.versus) return;
      const def = $('selFlow').value;
      const target = (Number($('inpTarget').value) || 3) / 100;
      const T = sim.teamStats(), H = sim.hold(def);
      const pct = (x, d) => (Number.isFinite(x) ? (x * 100).toFixed(d === undefined ? 2 : d) + '%' : '—');
      setText($('holdValue'), pct(H.value));
      setText($('holdLabel'), def === 'drop' ? 'прибыль компании / закупки игроков' : 'прибыль компании / оборот игроков');
      let st = 'мало данных', cls = 'status';
      if (Number.isFinite(H.lo)) {
        if (target >= H.lo && target <= H.hi) { st = 'цель в пределах ДИ'; cls = 'status ok'; }
        else if (H.mean > target) { st = 'выше цели'; cls = 'status hi'; }
        else { st = 'ниже цели'; cls = 'status lo'; }
      }
      setText($('holdStatus'), st); setCls($('holdStatus'), cls);
      setText($('holdCI'), Number.isFinite(H.lo) ? `95% ДИ: ${pct(H.lo)} … ${pct(H.hi)} (по ${H.batches} отрезкам)` : 'доверительный интервал появится после ~6 000 раздач');
      const g = Number.isFinite(H.value) ? Math.max(0, Math.min(100, (H.value / (2 * target)) * 100)) : 0;
      $('gaugeBar').style.width = g + '%';
      setText($('gaugeTarget'), 'цель ' + (target * 100).toFixed(1) + '%');
      const C = T.company, P = T.player, m = (x) => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
      const row = (label, a, b) => `<tr><td>${label}</td><td class="c-col">${a}</td><td>${b}</td></tr>`;
      setHtml($('teamTable'), `<table><thead><tr><th></th><th>Компания</th><th>Игроки</th></tr></thead><tbody>
        ${row('Ботов', C.n, P.n)}
        ${row('Прибыль', m(C.profit), m(P.profit))}
        ${row('bb/100', fmt(C.bb100, 1), fmt(P.bb100, 1))}
        ${row('Игрок-рук', C.hands.toLocaleString('ru-RU'), P.hands.toLocaleString('ru-RU'))}
        ${row('Оборот (все ставки)', m(C.turnover), m(P.turnover))}
        ${row('Закупки (drop)', m(C.drop), m(P.drop))}
        ${row('Рейк заплачен', m(C.rake), m(P.rake))}
        ${row('VPIP / PFR', (C.vpip * 100).toFixed(0) + ' / ' + (C.pfr * 100).toFixed(0), (P.vpip * 100).toFixed(0) + ' / ' + (P.pfr * 100).toFixed(0))}
        ${row('Ботов в плюсе', (C.winShare * 100).toFixed(0) + '%', (P.winShare * 100).toFixed(0) + '%')}
        ${row('Медиана / лучший / худший', m(C.median) + ' / ' + m(C.best) + ' / ' + m(C.worst), m(P.median) + ' / ' + m(P.best) + ' / ' + m(P.worst))}
      </tbody></table>`);
    }

    renderTeamCharts() {
      const sim = this.sim;
      if (!sim.versus) return;
      const def = $('selFlow').value;
      const target = (Number($('inpTarget').value) || 3);
      const H = sim.hold(def);
      const ser = H.series.filter((p) => Number.isFinite(p.v) && p.h >= sim.cfg.snapshotEvery * 4);
      if (ser.length > 1) {
        const x = ser.map((p) => p.h);
        drawLines($('chartHold'), [
          { name: 'доля компании, %', color: '#f5b942', x, y: ser.map((p) => p.v * 100), width: 2 },
          { name: 'цель', color: '#ffffff', dash: [5, 4], width: 1.2, x: [x[0], x[x.length - 1]], y: [target, target] },
        ], { height: 150, legend: true, yfmt: (v) => v.toFixed(1) + '%', xfmt: (v) => Math.round(v / 1000) + 'k рук' });
      } else drawLines($('chartHold'), [], { height: 150 });
      const hs = sim.history.filter((e) => e.t);
      if (hs.length > 1) {
        const x = hs.map((e) => e.h);
        drawLines($('chartTeams'), [
          { name: 'прибыль компании', color: '#3b82f6', x, y: hs.map((e) => e.t.cp), width: 2 },
          { name: 'прибыль игроков', color: '#9ca3af', x, y: hs.map((e) => e.t.pp), width: 2 },
        ], { height: 150, zero: true, legend: true, yfmt: (v) => '$' + Math.round(v).toLocaleString('ru-RU'), xfmt: (v) => Math.round(v / 1000) + 'k рук' });
      } else drawLines($('chartTeams'), [], { height: 150 });
    }

    // ------------------------------------------------------------ карточка бота
    openBot(id) {
      this.selected = id;
      this.botId = id;
      this.botOpen = true;
      this.renderBot();
      const dlg = $('dlgBot');
      if (!dlg.open) dlg.showModal();
      this.renderBoard(true);
    }

    renderBot() {
      const sim = this.sim, bot = sim.bots[this.botId];
      if (!bot) return;
      const r = sim.row(bot), s = bot.stats, g = bot.genome;
      let genes = '', group = '';
      for (const k of Genome.GENE_KEYS) {
        const d = Genome.GENES[k];
        if (d.group !== group) { group = d.group; genes += `<div class="group-title">${group}</div>`; }
        const pct = ((g[k] - d.min) / (d.max - d.min)) * 100;
        const v = d.max <= 1.5 && d.min >= -0.1 ? g[k].toFixed(2) : g[k].toFixed(1);
        genes += `<div class="gene"><div>${d.label}<div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></div><div class="val">${v}</div></div>`;
      }
      const where = r.table >= 0 ? `за столом ${r.table + 1}, стек ${money(bot.stack)} (${r.stackBB.toFixed(0)} ББ)` : 'ожидает свободное место';
      const html = `
        <div class="bot-head"><h2>${esc(bot.name)}</h2>
          ${bot.team === 'company' ? '<span class="pill sss">Команда компании</span>' : bot.team === 'player' ? '<span class="pill">Игрок · seed ' + bot.seed + '</span>' : ''}<span class="pill ${bot.fixed ? 'fixed' : ''}">${esc(r.archLabel)}</span>
          <span class="pill ${r.strategy.toLowerCase()}">${r.strategy} · закупка ${g.buyIn.toFixed(0)} ББ</span>
          <span class="muted">${where}</span></div>
        <div class="muted">Стиль по статистике: <b>${esc(r.style)}</b>${bot.learnedFrom ? ` · последнее обучение у <b>${esc(bot.learnedFrom)}</b> (поколение ${bot.generation})` : ''}</div>
        <div class="bot-grid">
          <div class="bot-stat"><small>Прибыль</small><b class="${r.profit >= 0 ? 'pos-n' : 'neg-n'}">${fmt(r.profit)} $</b></div>
          <div class="bot-stat"><small>bb/100</small><b class="${r.bb100 >= 0 ? 'pos-n' : 'neg-n'}">${fmt(r.bb100, 1)}</b></div>
          <div class="bot-stat"><small>Раздач</small><b>${r.hands}</b></div>
          <div class="bot-stat"><small>Оборот / закупки</small><b>$${r.turnover.toFixed(0)} / $${r.drop.toFixed(0)}</b></div>
          <div class="bot-stat"><small>VPIP / PFR</small><b>${(s.vpipPct * 100).toFixed(0)} / ${(s.pfrPct * 100).toFixed(0)}</b></div>
          <div class="bot-stat"><small>3-bet / агрессия</small><b>${(s.threeBetPct * 100).toFixed(0)}% / ${(s.afq * 100).toFixed(0)}%</b></div>
          <div class="bot-stat"><small>C-bet / фолд на бет</small><b>${(s.cbetPct * 100).toFixed(0)}% / ${(s.foldToBetPct * 100).toFixed(0)}%</b></div>
          <div class="bot-stat"><small>WTSD / W$SD</small><b>${(s.wtsdPct * 100).toFixed(0)}% / ${(s.wsdPct * 100).toFixed(0)}%</b></div>
        </div>
        <canvas id="chartBot" height="140"></canvas>
        <div class="panel-title" style="margin-top:12px">Гены стратегии <small>(то, что бот подбирает сам)</small></div>
        <div class="genes">${genes}</div>`;
      const body = $('botBody');
      body.innerHTML = html;
      const hist = sim.history;
      if (hist.length > 1) {
        drawLines($('chartBot'), [{ name: bot.name, color: '#4cc3ff', x: hist.map((h) => h.h), y: hist.map((h) => h.p[bot.id]) }],
          { height: 140, zero: true, yfmt: (v) => '$' + v.toFixed(0), xfmt: (v) => Math.round(v / 1000) + 'k рук' });
      }
    }
  }

  NS.UI = UI;
})(window);
