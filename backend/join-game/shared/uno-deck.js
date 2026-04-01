'use strict';

const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTION_TYPES = ['skip', 'reverse', 'drawTwo'];
const WILD_TYPES = ['wild', 'wildDrawFour'];

/**
 * Generate a standard 108-card Uno deck
 * Composition:
 *   - 4 colors × (1×zero + 2×one-nine) = 76 number cards
 *   - 4 colors × 2×(skip + reverse + drawTwo) = 24 action cards
 *   - 4×wild + 4×wildDrawFour = 8 wild cards
 *   Total = 108
 */
function generateDeck() {
  const cards = [];
  let id = 0;

  for (const color of COLORS) {
    // Zero card (1 per color)
    cards.push(createCard(id++, 'number', color, 0));

    // Number cards 1-9 (2 per color)
    for (let n = 1; n <= 9; n++) {
      cards.push(createCard(id++, 'number', color, n));
      cards.push(createCard(id++, 'number', color, n));
    }

    // Action cards (2 per color)
    for (const action of ACTION_TYPES) {
      cards.push(createCard(id++, action, color, null));
      cards.push(createCard(id++, action, color, null));
    }
  }

  // Wild cards (4 each)
  for (let i = 0; i < 4; i++) {
    cards.push(createCard(id++, 'wild', 'wild', null));
    cards.push(createCard(id++, 'wildDrawFour', 'wild', null));
  }

  return cards;
}

function createCard(id, type, color, value) {
  return {
    id: `${color}-${type}-${id}`,
    type,       // 'number' | 'skip' | 'reverse' | 'drawTwo' | 'wild' | 'wildDrawFour'
    color,      // 'red' | 'blue' | 'green' | 'yellow' | 'wild'
    value,      // 0-9 for number cards, null for others
    displayColor: color // can be overridden for wild cards after play
  };
}

/**
 * Fisher-Yates shuffle
 */
function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deal initialCards to each player, return { hands, remainingDeck }
 * Ensures first discard card is not a Wild Draw Four
 */
function dealCards(deck, playerIds, initialCards = 7) {
  const shuffled = shuffleDeck(deck);
  const hands = {};

  for (const playerId of playerIds) {
    hands[playerId] = shuffled.splice(0, initialCards);
  }

  // Find valid first discard (not wildDrawFour)
  let discardIndex = 0;
  while (discardIndex < shuffled.length && shuffled[discardIndex].type === 'wildDrawFour') {
    discardIndex++;
  }

  // If all remaining are wildDrawFour (extremely unlikely), just use first
  if (discardIndex >= shuffled.length) discardIndex = 0;

  const firstDiscard = shuffled.splice(discardIndex, 1)[0];

  return {
    hands,
    drawPile: shuffled,
    discardPile: [firstDiscard]
  };
}

/**
 * Validate if a card can be played on the current discard pile top
 * @param {Object} card - card to play
 * @param {Object} topCard - current top of discard pile
 * @param {string} currentColor - active color (may differ from topCard.color for wilds)
 */
function isValidPlay(card, topCard, currentColor) {
  if (!card || !topCard) return false;

  // Wild cards can always be played
  if (card.type === 'wild' || card.type === 'wildDrawFour') return true;

  // Match by color
  if (card.color === currentColor) return true;

  // Match by type/value
  if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
  if (card.type !== 'number' && card.type === topCard.type) return true;

  return false;
}

/**
 * Check if a player has any valid card to play
 */
function hasValidPlay(hand, topCard, currentColor) {
  return hand.some(card => isValidPlay(card, topCard, currentColor));
}

/**
 * Calculate score from remaining cards in a hand
 */
function calculateHandScore(hand) {
  return hand.reduce((total, card) => {
    if (card.type === 'number') return total + card.value;
    if (['skip', 'reverse', 'drawTwo'].includes(card.type)) return total + 20;
    if (['wild', 'wildDrawFour'].includes(card.type)) return total + 50;
    return total;
  }, 0);
}

/**
 * Reshuffle discard pile into draw pile (keep top card)
 */
function reshuffleDiscard(discardPile) {
  if (discardPile.length <= 1) return { drawPile: [], discardPile };

  const topCard = discardPile[discardPile.length - 1];
  const toShuffle = discardPile.slice(0, discardPile.length - 1).map(card => ({
    ...card,
    displayColor: card.color // reset wild card colors
  }));

  return {
    drawPile: shuffleDeck(toShuffle),
    discardPile: [topCard]
  };
}

/**
 * Get next player index considering direction and skips
 */
function getNextPlayerIndex(currentIndex, playerCount, direction, skipCount = 0) {
  const steps = 1 + skipCount;
  if (direction === 1) {
    return (currentIndex + steps) % playerCount;
  } else {
    return ((currentIndex - steps) % playerCount + playerCount) % playerCount;
  }
}

module.exports = {
  generateDeck,
  shuffleDeck,
  dealCards,
  isValidPlay,
  hasValidPlay,
  calculateHandScore,
  reshuffleDiscard,
  getNextPlayerIndex,
  COLORS,
  NUMBERS,
  ACTION_TYPES,
  WILD_TYPES
};
