'use strict';

const {
  isValidPlay,
  getNextPlayerIndex,
  reshuffleDiscard,
  calculateHandScore
} = require('./uno-deck');

// ─── applyMove ────────────────────────────────────────────────────────────────
function applyMove(game, playerId, cardId, chosenColor = null) {
  const playerIndex = game.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return { success: false, error: 'Player not in game' };
  if (game.currentPlayerIndex !== playerIndex) return { success: false, error: 'Not your turn' };
  if (game.status !== 'playing') return { success: false, error: 'Game not in progress' };

  const hand = game.hands[playerId];
  if (!hand) return { success: false, error: 'No hand found' };
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return { success: false, error: 'Card not in hand' };

  const card = hand[cardIndex];
  const topCard = game.discardPile[game.discardPile.length - 1];
  const currentColor = game.currentColor;

  if (!isValidPlay(card, topCard, currentColor)) {
    return { success: false, error: 'Invalid move: card does not match color or type' };
  }

  if ((card.type === 'wild' || card.type === 'wildDrawFour') && !chosenColor) {
    return { success: false, error: 'Must choose a color for wild card' };
  }
  if (chosenColor && !['red', 'blue', 'green', 'yellow'].includes(chosenColor)) {
    return { success: false, error: 'Invalid color choice' };
  }

  // WDF4 legality: player must not hold a card matching current color
  let wdf4PlayedLegally = true;
  if (card.type === 'wildDrawFour') {
    wdf4PlayedLegally = !hand.some(c => c.color === currentColor && c.id !== cardId);
  }

  const newState = deepCloneGame(game);
  newState.hands[playerId] = newState.hands[playerId].filter(c => c.id !== cardId);

  const playedCard = { ...card };
  if (card.type === 'wild' || card.type === 'wildDrawFour') {
    playedCard.displayColor = chosenColor;
    newState.currentColor = chosenColor;
  } else {
    newState.currentColor = card.color;
  }

  newState.discardPile.push(playedCard);
  newState.lastPlayedCard = playedCard;
  newState.lastPlayerId = playerId;
  newState.drawnCardPending = null;
  newState.pendingDraw = null;
  newState.skippedPlayerIndex = null;
  newState._wdf4PlayedLegally = wdf4PlayedLegally;

  const newHand = newState.hands[playerId];

  // Win condition
  if (newHand.length === 0) {
    newState.status = 'finished';
    newState.winnerId = playerId;
    // Round score = sum of all opponents' remaining cards
    const roundScore = calculateRoundScore(newState, playerId);
    newState.scores = calculateScores(newState);
    // Accumulate into cumulativeScores
    if (!newState.cumulativeScores) newState.cumulativeScores = {};
    newState.cumulativeScores[playerId] = (newState.cumulativeScores[playerId] || 0) + roundScore;
    return { success: true, newState, won: true };
  }

  // UNO flag
  if (newHand.length === 1) {
    newState.unoCallRequired = playerId;
    newState.unoCallDeadline = Date.now() + 4000; // 4s window
  } else {
    newState.unoCallRequired = null;
    newState.unoCallDeadline = null;
  }

  applyCardEffect(newState, card, playerIndex);

  return { success: true, newState, won: false };
}

// ─── applyCardEffect ──────────────────────────────────────────────────────────
function applyCardEffect(state, card, playedByIndex) {
  const playerCount = state.players.length;

  // Helper: next connected player index
  function nextConnected(fromIdx, dir) {
    let idx = fromIdx;
    for (let i = 0; i < playerCount; i++) {
      idx = (idx + dir + playerCount) % playerCount;
      if (state.players[idx].connected !== false) return idx;
    }
    return (fromIdx + dir + playerCount) % playerCount; // fallback
  }

  switch (card.type) {
    case 'skip': {
      const skipped = nextConnected(playedByIndex, state.direction);
      state.skippedPlayerIndex = skipped;
      state.currentPlayerIndex = nextConnected(skipped, state.direction);
      break;
    }
    case 'reverse': {
      state.direction *= -1;
      if (playerCount === 2) {
        // In 2-player, reverse = skip (same player goes again)
        state.currentPlayerIndex = playedByIndex;
      } else {
        state.currentPlayerIndex = nextConnected(playedByIndex, state.direction);
      }
      break;
    }
    case 'drawTwo': {
      const nextIdx = nextConnected(playedByIndex, state.direction);
      const nextPlayer = state.players[nextIdx];
      const drawn = drawCards(state, 2);
      state.hands[nextPlayer.id].push(...drawn);
      state.pendingDraw = { playerId: nextPlayer.id, count: 2 };
      state.skippedPlayerIndex = nextIdx;
      state.currentPlayerIndex = nextConnected(nextIdx, state.direction);
      break;
    }
    case 'wildDrawFour': {
      const nextIdx = nextConnected(playedByIndex, state.direction);
      const nextPlayer = state.players[nextIdx];
      const drawn = drawCards(state, 4);
      state.hands[nextPlayer.id].push(...drawn);
      state.pendingDraw = { playerId: nextPlayer.id, count: 4 };
      state.pendingChallenge = {
        challengerId: nextPlayer.id,
        challengedId: state.players[playedByIndex].id,
        playedLegally: state._wdf4PlayedLegally
      };
      state.skippedPlayerIndex = nextIdx;
      state.currentPlayerIndex = nextConnected(nextIdx, state.direction);
      break;
    }
    default: {
      // number or wild — just advance
      state.currentPlayerIndex = nextConnected(playedByIndex, state.direction);
      break;
    }
  }

  state.turnStartedAt = Date.now();
}

// ─── drawCards ────────────────────────────────────────────────────────────────
function drawCards(state, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      const reshuffled = reshuffleDiscard(state.discardPile);
      state.drawPile = reshuffled.drawPile;
      state.discardPile = reshuffled.discardPile;
    }
    if (state.drawPile.length > 0) drawn.push(state.drawPile.pop());
  }
  return drawn;
}

// ─── applyDraw ────────────────────────────────────────────────────────────────
function applyDraw(game, playerId) {
  const playerIndex = game.players.findIndex(p => p.id === playerId);
  if (game.currentPlayerIndex !== playerIndex) return { success: false, error: 'Not your turn' };
  if (game.status !== 'playing') return { success: false, error: 'Game not in progress' };
  if (game.drawnCardPending?.playerId === playerId) {
    return { success: false, error: 'You already drew a card - play it or pass' };
  }

  const newState = deepCloneGame(game);
  const [drawnCard] = drawCards(newState, 1);
  if (!drawnCard) return { success: false, error: 'No cards available' };

  newState.hands[playerId].push(drawnCard);
  newState.lastDrawnCard = drawnCard;
  newState.lastDrawnBy = playerId;

  const topCard = newState.discardPile[newState.discardPile.length - 1];
  const canPlay = isValidPlay(drawnCard, topCard, newState.currentColor);

  if (!canPlay) {
    // Auto-pass
    newState.currentPlayerIndex = getNextConnectedIndex(newState, playerIndex, newState.direction);
    newState.turnStartedAt = Date.now();
    newState.drawnCardPending = null;
  } else {
    newState.drawnCardPending = { playerId, cardId: drawnCard.id };
  }

  return { success: true, newState, drawnCard, canPlay };
}

// ─── applyPass ────────────────────────────────────────────────────────────────
function applyPass(game, playerId) {
  const playerIndex = game.players.findIndex(p => p.id === playerId);
  if (game.currentPlayerIndex !== playerIndex) return { success: false, error: 'Not your turn' };
  if (!game.drawnCardPending || game.drawnCardPending.playerId !== playerId) {
    return { success: false, error: 'You must draw a card before passing' };
  }
  const newState = deepCloneGame(game);
  newState.currentPlayerIndex = getNextConnectedIndex(newState, playerIndex, newState.direction);
  newState.turnStartedAt = Date.now();
  newState.drawnCardPending = null;
  return { success: true, newState };
}

// ─── applyChallenge ───────────────────────────────────────────────────────────
function applyChallenge(game, challengerId) {
  if (!game.pendingChallenge) return { success: false, error: 'No challenge pending' };
  if (game.pendingChallenge.challengerId !== challengerId) return { success: false, error: 'Not your challenge' };

  const newState = deepCloneGame(game);
  const { challengedId, playedLegally } = newState.pendingChallenge;
  newState.pendingChallenge = null;

  if (!playedLegally) {
    // Challenger wins: challenged draws 4, challenger keeps their cards
    const drawn = drawCards(newState, 4);
    newState.hands[challengedId].push(...drawn);
    // Give back the 4 cards that were forced on challenger
    const hand = newState.hands[challengerId];
    newState.hands[challengerId] = hand.slice(0, Math.max(0, hand.length - 4));
    newState.challengeResult = { success: true, challengerId, challengedId };
  } else {
    // Challenge fails: challenger draws 2 extra
    const drawn = drawCards(newState, 2);
    newState.hands[challengerId].push(...drawn);
    newState.challengeResult = { success: false, challengerId, challengedId };
  }

  return { success: true, newState };
}

// ─── applyUnoPenalty ─────────────────────────────────────────────────────────
function applyUnoPenalty(game, targetPlayerId) {
  const newState = deepCloneGame(game);
  const drawn = drawCards(newState, 2);
  newState.hands[targetPlayerId].push(...drawn);
  newState.unoCallRequired = null;
  newState.unoCallDeadline = null;
  return { success: true, newState };
}

// ─── Scores ───────────────────────────────────────────────────────────────────
function calculateRoundScore(state, winnerId) {
  // Winner earns points equal to sum of all other players' remaining cards
  return state.players
    .filter(p => p.id !== winnerId)
    .reduce((sum, p) => sum + calculateHandScore(state.hands[p.id] || []), 0);
}

function calculateScores(state) {
  const scores = {};
  for (const player of state.players) {
    scores[player.id] = calculateHandScore(state.hands[player.id] || []);
  }
  return scores;
}

// ─── buildPlayerView ─────────────────────────────────────────────────────────
function buildPlayerView(game, viewingPlayerId) {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      cardCount: (game.hands[p.id] || []).length,
      isCurrentTurn: game.players[game.currentPlayerIndex]?.id === p.id,
      connected: p.connected !== false,
      cumulativeScore: (game.cumulativeScores || {})[p.id] || 0
    })),
    currentPlayerId: game.players[game.currentPlayerIndex]?.id,
    currentColor: game.currentColor,
    direction: game.direction,
    topCard: game.discardPile[game.discardPile.length - 1],
    drawPileCount: game.drawPile.length,
    myHand: game.hands[viewingPlayerId] || [],
    turnStartedAt: game.turnStartedAt,
    lastPlayedCard: game.lastPlayedCard,
    lastPlayerId: game.lastPlayerId,
    pendingDraw: game.pendingDraw,
    pendingChallenge: game.pendingChallenge
      ? { challengerId: game.pendingChallenge.challengerId, challengedId: game.pendingChallenge.challengedId }
      : null,
    unoCallRequired: game.unoCallRequired,
    unoCallDeadline: game.unoCallDeadline,
    winnerId: game.winnerId,
    scores: game.scores,
    cumulativeScores: game.cumulativeScores || {},
    skippedPlayerIndex: game.skippedPlayerIndex,
    challengeResult: game.challengeResult,
    drawnCardPending: game.drawnCardPending?.playerId === viewingPlayerId
      ? game.drawnCardPending
      : (game.drawnCardPending ? { playerId: game.drawnCardPending.playerId } : null)
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNextConnectedIndex(state, fromIdx, direction) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = ((fromIdx + direction * i) % n + n) % n;
    if (state.players[idx].connected !== false) return idx;
  }
  return (fromIdx + direction + n) % n;
}

function deepCloneGame(game) {
  return JSON.parse(JSON.stringify(game));
}

module.exports = {
  applyMove, applyDraw, applyPass, applyChallenge, applyUnoPenalty,
  buildPlayerView, calculateScores, calculateRoundScore,
  drawCards, deepCloneGame, getNextPlayerIndex
};
