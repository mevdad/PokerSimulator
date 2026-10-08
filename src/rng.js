(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  // Детерминированный ГСЧ (mulberry32): один и тот же seed -> одна и та же симуляция.
  class RNG {
    constructor(seed) {
      this.seed = (seed === undefined || seed === null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
      this.s = this.seed;
    }
    next() {
      let t = (this.s = (this.s + 0x6D2B79F5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(n) { return Math.floor(this.next() * n); }
    range(a, b) { return a + (b - a) * this.next(); }
    chance(p) { return this.next() < p; }
    pick(arr) { return arr[this.int(arr.length)]; }
    gauss() {
      let u = 0;
      while (u === 0) u = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
    }
    shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  }

  NS.RNG = RNG;
})(typeof globalThis !== 'undefined' ? globalThis : window);
