// Достаёт лучшие геномы эволюционеров из JSON, который скачан кнопкой "⭳ JSON", и сохраняет как
// стартовую популяцию команды компании: data/company-seed.json и data/company-seed.js (для браузера без сервера).
'use strict';
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
const top = Number(process.argv[3] || 60);
const minHands = Number(process.argv[4] || 800);     // минимум раздач у бота
const minBb100 = Number(process.argv[5] || 3);       // минимум bb/100 (со сжатием на малую выборку)
const teamOnly = process.argv[6] || '';              // 'company' - брать только ботов компании
if (!src) { console.error('Использование: node scripts/extract-seeds.js results.json [сколько] [мин.раздач] [мин.bb/100] [company]'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const pool = d.bots.filter((b) => !b.fixed && b.hands >= minHands && b.bb100s > minBb100 && b.genome && (!teamOnly || b.team === teamOnly)).sort((a, b) => b.bb100s - a.bb100s).slice(0, top);
const out = {
  source: { totalHands: d.totalHands, generation: d.generation, seed: d.config && d.config.seed },
  genomes: pool.map((b) => b.genome),
  info: pool.map((b) => ({ name: b.name, bb100: Math.round(b.bb100 * 10) / 10, hands: b.hands })),
};
const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'company-seed.json'), JSON.stringify(out));
fs.writeFileSync(path.join(dir, 'company-seed.js'), `// Автогенерация: scripts/extract-seeds.js\n(globalThis.PokerSim = globalThis.PokerSim || {}).COMPANY_SEEDS = ${JSON.stringify(out.genomes)};\n`);
console.log(`Сохранено ${pool.length} геномов (лучший bb/100 по выборке: ${out.info[0].bb100}, худший из отобранных: ${out.info[out.info.length - 1].bb100}) из прогона на ${d.totalHands} раздач.`);
