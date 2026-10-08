// Загрузчик для Node.js: подключает модули в нужном порядке и возвращает общее пространство имён.
'use strict';
const path = require('path');
const order = ['rng', 'cards', 'evaluator', 'preflop', 'equity', 'stats', 'names', 'genome', 'bot', 'table', 'simulation'];
for (const m of order) require(path.join(__dirname, m + '.js'));
module.exports = globalThis.PokerSim;
