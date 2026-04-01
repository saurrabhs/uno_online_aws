'use strict';

const {
  generateDeck,
  shuffleDeck,
  dealCards,
  isValidPlay,
  hasValidPlay,
  calculateHandScore,
  reshuffleDiscard,
  getNextPlayerIndex
} = require('../../backend/shared/uno-deck');

describe('generateDeck', () => {
  let deck;
  beforeAll(() => { deck = generateDeck(); });

  test('generates exactly 108 cards', () => {
    expect(deck).toHaveLength(108);
  });

  test('has 76 number cards (4 colors × (1 zero + 2×nine))', () => {
    const numbers = deck.filter(c => c.type === 'number');
    expect(numbers).toHaveLength(76);
  });

  test('has 24 action cards (4 colors × 2 × 3 types)', () => {
    const actions = deck.filter(c => ['skip','reverse','drawTwo'].includes(c.type));
    expect(actions).toHaveLength(24);
  });

  test('has 8 wild cards (4 wild + 4 wildDrawFour)', () => {
    const wilds = deck.filter(c => ['wild','wildDrawFour'].includes(c.type));
    expect(wilds).toHaveLength(8);
  });

  test('each color has 1 zero card', () => {
    for (const color of ['red','blue','green','yellow']) {
      const zeros = deck.filter(c => c.color === color && c.type === 'number' && c.value === 0);
      expect(zeros).toHaveLength(1);
    }
  });

  test('each color has 2 of each number 1-9', () => {
    for (const color of ['red','blue','green','yellow']) {
      for (let n = 1; n <= 9; n++) {
        const cards = deck.filter(c => c.color === color && c.type === 'number' && c.value === n);
        expect(cards).toHaveLength(2);
      }
    }
  });

  test('all card IDs are unique', () => {
    const ids = deck.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(108);
  });
});

describe('shuffleDeck', () => {
  test('returns same number of cards', () => {
    const deck = generateDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(deck.length);
  });

  test('does not mutate original deck', () => {
    const deck = generateDeck();
    const original = [...deck];
    shuffleDeck(deck);
    expect(deck).toEqual(original);
  });

  test('produces different order (statistically)', () => {
    const deck = generateDeck();
    const shuffled = shuffleDeck(deck);
    const sameOrder = deck.every((c, i) => c.id === shuffled[i].id);
    expect(sameOrder).toBe(false);
  });
});

describe('dealCards', () => {
  test('deals 7 cards to each player', () => {
    const deck = generateDeck();
    const players = ['p1', 'p2', 'p3', 'p4'];
    const { hands } = dealCards(deck, players, 7);
    for (const pid of players) {
      expect(hands[pid]).toHaveLength(7);
    }
  });

  test('first discard card is not wildDrawFour', () => {
    for (let i = 0; i < 20; i++) {
      const deck = generateDeck();
      const { discardPile } = dealCards(deck, ['p1'], 7);
      expect(discardPile[0].type).not.toBe('wildDrawFour');
    }
  });

  test('remaining draw pile has correct count', () => {
    const deck = generateDeck();
    const players = ['p1', 'p2'];
    const { drawPile } = dealCards(deck, players, 7);
    // 108 - (2×7) - 1 discard = 93
    expect(drawPile).toHaveLength(93);
  });
});

describe('isValidPlay', () => {
  const redSeven = { type: 'number', color: 'red', value: 7 };
  const blueSeven = { type: 'number', color: 'blue', value: 7 };
  const redSkip = { type: 'skip', color: 'red', value: null };
  const blueSkip = { type: 'skip', color: 'blue', value: null };
  const wild = { type: 'wild', color: 'wild', value: null };
  const wdf = { type: 'wildDrawFour', color: 'wild', value: null };

  test('same color match', () => {
    expect(isValidPlay(redSeven, { type: 'number', color: 'red', value: 3 }, 'red')).toBe(true);
  });

  test('same number match', () => {
    expect(isValidPlay(blueSeven, redSeven, 'red')).toBe(true);
  });

  test('same action type match', () => {
    expect(isValidPlay(blueSkip, redSkip, 'red')).toBe(true);
  });

  test('wild always valid', () => {
    expect(isValidPlay(wild, redSeven, 'red')).toBe(true);
    expect(isValidPlay(wdf, blueSeven, 'blue')).toBe(true);
  });

  test('invalid play - different color and type', () => {
    expect(isValidPlay(blueSeven, { type: 'number', color: 'red', value: 3 }, 'red')).toBe(false);
  });

  test('color match overrides number mismatch', () => {
    const redThree = { type: 'number', color: 'red', value: 3 };
    expect(isValidPlay(redThree, redSeven, 'red')).toBe(true);
  });
});

describe('calculateHandScore', () => {
  test('number cards score face value', () => {
    const hand = [
      { type: 'number', value: 5 },
      { type: 'number', value: 9 }
    ];
    expect(calculateHandScore(hand)).toBe(14);
  });

  test('action cards score 20', () => {
    const hand = [
      { type: 'skip' },
      { type: 'reverse' },
      { type: 'drawTwo' }
    ];
    expect(calculateHandScore(hand)).toBe(60);
  });

  test('wild cards score 50', () => {
    const hand = [
      { type: 'wild' },
      { type: 'wildDrawFour' }
    ];
    expect(calculateHandScore(hand)).toBe(100);
  });

  test('empty hand scores 0', () => {
    expect(calculateHandScore([])).toBe(0);
  });
});

describe('getNextPlayerIndex', () => {
  test('clockwise direction', () => {
    expect(getNextPlayerIndex(0, 4, 1)).toBe(1);
    expect(getNextPlayerIndex(3, 4, 1)).toBe(0); // wraps
  });

  test('counter-clockwise direction', () => {
    expect(getNextPlayerIndex(0, 4, -1)).toBe(3); // wraps
    expect(getNextPlayerIndex(2, 4, -1)).toBe(1);
  });

  test('skip one player', () => {
    expect(getNextPlayerIndex(0, 4, 1, 1)).toBe(2);
  });
});

describe('reshuffleDiscard', () => {
  test('keeps top card in discard', () => {
    const discard = [
      { id: 'a', type: 'number', color: 'red', value: 1 },
      { id: 'b', type: 'number', color: 'blue', value: 2 }
    ];
    const { discardPile } = reshuffleDiscard(discard);
    expect(discardPile).toHaveLength(1);
    expect(discardPile[0].id).toBe('b');
  });

  test('moves other cards to draw pile', () => {
    const discard = Array.from({ length: 10 }, (_, i) => ({
      id: `card-${i}`, type: 'number', color: 'red', value: i
    }));
    const { drawPile } = reshuffleDiscard(discard);
    expect(drawPile).toHaveLength(9);
  });
});
