(function (root) {
  'use strict';
  const NS = root.PokerSim || (root.PokerSim = {});

  const FIRST = ['Viktor', 'Olena', 'Dmytro', 'Ivan', 'Anna', 'Maksym', 'Sasha', 'Kolya', 'Vlad', 'Taras', 'Oleg', 'Katya',
    'Andriy', 'Bohdan', 'Yulia', 'Roman', 'Denys', 'Misha', 'Nastya', 'Pavlo', 'Igor', 'Artem', 'Sergiy', 'Marta', 'Lesya',
    'Alex', 'John', 'Mike', 'Emma', 'Lucas', 'Sofia', 'Noah', 'Liam', 'Mia', 'Jack', 'Oscar', 'Hugo', 'Elena', 'Marco',
    'Pierre', 'Hans', 'Jan', 'Piotr', 'Tomas', 'Nikita', 'Egor', 'Daria', 'Polina', 'Stas', 'Zhenya', 'Lena', 'Vadim',
    'Grisha', 'Fedir', 'Yarik', 'Danylo', 'Ostap', 'Lev', 'Rafael', 'Diego', 'Carlos', 'Yuki', 'Kenji', 'Ivo', 'Milan'];
  const ADJ = ['Lucky', 'Sneaky', 'Silent', 'Crazy', 'Cold', 'Hot', 'Mad', 'Wild', 'Fast', 'Slow', 'Brave', 'Sly', 'Blind',
    'Royal', 'Iron', 'Golden', 'Dark', 'Neon', 'Turbo', 'Mega', 'Tilted', 'Chill', 'Happy', 'Angry', 'Shy', 'Big', 'Tiny',
    'Evil', 'Nitro', 'Cosmic', 'Frozen', 'Rusty', 'Lazy', 'Smooth', 'Sharp', 'Steel', 'Shadow', 'Ghost', 'River', 'Flop'];
  const ANIMAL = ['Fox', 'Wolf', 'Bear', 'Shark', 'Tiger', 'Cobra', 'Falcon', 'Raven', 'Panda', 'Lynx', 'Otter', 'Viper',
    'Eagle', 'Hawk', 'Moose', 'Badger', 'Gorilla', 'Dragon', 'Phoenix', 'Mantis', 'Rhino', 'Bison', 'Crow', 'Pike', 'Orca',
    'Jackal', 'Hyena', 'Cat', 'Hamster', 'Whale', 'Fish', 'Donkey', 'Bull', 'Owl', 'Koala'];
  const SUFFIX = ['AA', 'KK', 'Ace', 'Bluff', 'Nuts', 'AllIn', 'Pro', 'Boss', 'King', 'Queen', 'Joker', 'Dealer', 'Grinder'];

  function generateNames(count, rng) {
    const used = new Set();
    const out = [];
    let guard = 0;
    while (out.length < count) {
      let name;
      switch (rng.int(6)) {
        case 0: name = rng.pick(FIRST) + '_' + (60 + rng.int(40)); break;
        case 1: name = rng.pick(ADJ) + rng.pick(FIRST); break;
        case 2: name = rng.pick(FIRST) + '_' + String.fromCharCode(65 + rng.int(26)); break;
        case 3: name = rng.pick(ADJ) + '_' + rng.pick(ANIMAL); break;
        case 4: name = rng.pick(ANIMAL) + rng.int(100); break;
        default: name = rng.pick(FIRST) + rng.pick(SUFFIX); break;
      }
      if (used.has(name)) {
        if (++guard > 40) { name = name + rng.int(1000); guard = 0; } else continue;
        if (used.has(name)) continue;
      }
      used.add(name);
      out.push(name);
    }
    return out;
  }

  NS.generateNames = generateNames;
})(typeof globalThis !== 'undefined' ? globalThis : window);
