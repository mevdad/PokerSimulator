(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // Карта = число 0..51. rank = c >> 2 (0 = двойка ... 12 = туз), suit = c & 3.
  const RANKS = '23456789TJQKA';
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };

  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const cardStr = (c) => RANKS[c >> 2] + SUITS[c & 3];
  const cardPretty = (c) => ({
    rank: RANKS[c >> 2] === 'T' ? '10' : RANKS[c >> 2],
    sym: SUIT_SYMBOL[SUITS[c & 3]],
    red: (c & 3) === 1 || (c & 3) === 2,
  });
  const makeDeck = () => { const d = []; for (let i = 0; i < 52; i++) d.push(i); return d; };

  NS.Cards = { RANKS, SUITS, rankOf, suitOf, cardStr, cardPretty, makeDeck };
})(typeof globalThis !== 'undefined' ? globalThis : window);
