// Загрузчик для Node.js: подключает модули в нужном порядке и возвращает общее пространство имён.
'use strict';
const path = require('path');
const order = ['rng', 'cards', 'evaluator', 'preflop', 'equity', 'stats', 'names', 'genome', 'bot', 'table', 'simulation', 'experiments'];
for (const m of order) require(path.join(__dirname, m + '.js'));
// стартовые геномы компании (если файл есть)
try { require(path.join(__dirname, '..', 'data', 'company-seed.js')); } catch (e) { /* необязательно */ }
module.exports = globalThis.PokerSim;
