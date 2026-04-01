'use strict';

const { applyMove, applyDraw, buildPlayerView } = require('../../backend/shared/game-validator');
const { generateDeck, dealCards } = require('../../backend/shared/uno-deck');

function createTestGame(playerIds = ['p1', 'p2', 'p3', 'p4']) {
  const deck = generateDeck();
  const { hands, drawPile, discardPile } = dealCards(deck, playerIds, 7);
  const topCard = discardPile[discardPile.length - 1];

  return {
    gameId: 'TEST123',
    status: 'playing',
    players: playerIds.map((id, i) => ({ id, name: `Player${i+1}`, connected: true })),
    hands,
    drawPile,
    discardPile,
    currentPlayerIndex: 0,
    currentColor: topCard.color === 'wild' ? 'red' : topCard.color,
    direction: 1,
    turnStartedAt: Date.now(),
    lastPlayedCard: null,
    lastPlayerId: null,
    pendingDraw: null,
    pendingChallenge: null,
    unoCallRequired: null,
    winnerId: null,
    scores: null
  };
}

describe('applyMove', () => {
  test('rejects move when not player turn', () => {
    const game = createTestGame();
    const result = applyMove(game, 'p2', 'any-card', null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not your turn/i);
  });

  test('rejects move for non-existent card', () => {
    const game = createTestGame();
    const result = applyMove(game, 'p1', 'fake-card-id', null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in hand/i);
  });

  test('rejects wild card without color choice', () => {
    const game = createTestGame();
    // Force a wild card into p1's hand
    const wildCard = { id: 'wild-test', type: 'wild', color: 'wild', value: null };
    game.hands['p1'].push(wildCard);
    const result = applyMove(game, 'p1', 'wild-test', null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/choose a color/i);
  });

  test('rejects invalid color choice for wild', () => {
    const game = createTestGame();
    const wildCard = { id: 'wild-test', type: 'wild', color: 'wild', value: null };
    game.hands['p1'].push(wildCard);
    const result = applyMove(game, 'p1', 'wild-test', 'purple');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid color/i);
  });

  test('successfully plays a valid card', () => {
    const game = createTestGame();
    const topCard = game.discardPile[game.discardPile.length - 1];
    const currentColor = game.currentColor;

    // Find a playable card for p1
    const playable = game.hands['p1'].find(c =>
      c.color === currentColor ||
      (c.type === 'number' && topCard.type === 'number' && c.value === topCard.value) ||
      c.type === topCard.type ||
      c.type === 'wild' || c.type === 'wildDrawFour'
    );

    if (!playable) {
      // Force a matching card
      const matchCard = { id: 'match-test', type: topCard.type, color: currentColor, value: topCard.value };
      game.hands['p1'].push(matchCard);
      const result = applyMove(game, 'p1', 'match-test', null);
      expect(result.success).toBe(true);
    } else {
      const chosenColor = (playable.type === 'wild' || playable.type === 'wildDrawFour') ? 'red' : null;
      const result = applyMove(game, 'p1', playable.id, chosenColor);
      expect(result.success).toBe(true);
    }
  });

  test('advances turn after playing', () => {
    const game = createTestGame();
    const matchCard = { id: 'match-test', type: 'number', color: game.currentColor, value: 5 };
    game.hands['p1'].push(matchCard);

    const result = applyMove(game, 'p1', 'match-test', null);
    expect(result.success).toBe(true);
    expect(result.newState.currentPlayerIndex).toBe(1); // moved to p2
  });

  test('skip card skips next player', () => {
    const game = createTestGame();
    const skipCard = { id: 'skip-test', type: 'skip', color: game.currentColor, value: null };
    game.hands['p1'].push(skipCard);

    const result = applyMove(game, 'p1', 'skip-test', null);
    expect(result.success).toBe(true);
    expect(result.newState.currentPlayerIndex).toBe(2); // skipped p2, now p3
  });

  test('reverse card reverses direction', () => {
    const game = createTestGame();
    const reverseCard = { id: 'rev-test', type: 'reverse', color: game.currentColor, value: null };
    game.hands['p1'].push(reverseCard);

    const result = applyMove(game, 'p1', 'rev-test', null);
    expect(result.success).toBe(true);
    expect(result.newState.direction).toBe(-1);
  });

  test('drawTwo gives next player 2 cards', () => {
    const game = createTestGame();
    const p2HandBefore = game.hands['p2'].length;
    const drawTwoCard = { id: 'dt-test', type: 'drawTwo', color: game.currentColor, value: null };
    game.hands['p1'].push(drawTwoCard);

    const result = applyMove(game, 'p1', 'dt-test', null);
    expect(result.success).toBe(true);
    expect(result.newState.hands['p2'].length).toBe(p2HandBefore + 2);
    expect(result.newState.currentPlayerIndex).toBe(2); // p2 skipped
  });

  test('wild card sets chosen color', () => {
    const game = createTestGame();
    const wildCard = { id: 'wild-test', type: 'wild', color: 'wild', value: null };
    game.hands['p1'].push(wildCard);

    const result = applyMove(game, 'p1', 'wild-test', 'green');
    expect(result.success).toBe(true);
    expect(result.newState.currentColor).toBe('green');
  });

  test('detects win condition', () => {
    const game = createTestGame();
    // Give p1 only 1 card that matches
    const winCard = { id: 'win-test', type: 'number', color: game.currentColor, value: 1 };
    game.hands['p1'] = [winCard];

    const result = applyMove(game, 'p1', 'win-test', null);
    expect(result.success).toBe(true);
    expect(result.won).toBe(true);
    expect(result.newState.status).toBe('finished');
    expect(result.newState.winnerId).toBe('p1');
  });

  test('rejects move when game not playing', () => {
    const game = createTestGame();
    game.status = 'waiting';
    const result = applyMove(game, 'p1', 'any', null);
    expect(result.success).toBe(false);
  });
});

describe('applyDraw', () => {
  test('rejects draw when not player turn', () => {
    const game = createTestGame();
    const result = applyDraw(game, 'p2');
    expect(result.success).toBe(false);
  });

  test('adds card to player hand', () => {
    const game = createTestGame();
    const handBefore = game.hands['p1'].length;
    const result = applyDraw(game, 'p1');
    expect(result.success).toBe(true);
    expect(result.newState.hands['p1'].length).toBe(handBefore + 1);
  });

  test('returns drawn card', () => {
    const game = createTestGame();
    const result = applyDraw(game, 'p1');
    expect(result.drawnCard).toBeDefined();
    expect(result.drawnCard.id).toBeDefined();
  });
});

describe('buildPlayerView', () => {
  test('includes own hand', () => {
    const game = createTestGame();
    const view = buildPlayerView(game, 'p1');
    expect(view.myHand).toBeDefined();
    expect(view.myHand.length).toBe(7);
  });

  test('shows card counts for opponents', () => {
    const game = createTestGame();
    const view = buildPlayerView(game, 'p1');
    const p2 = view.players.find(p => p.id === 'p2');
    expect(p2.cardCount).toBe(7);
  });

  test('does not expose opponent hands', () => {
    const game = createTestGame();
    const view = buildPlayerView(game, 'p1');
    expect(view.hands).toBeUndefined();
  });

  test('includes top card', () => {
    const game = createTestGame();
    const view = buildPlayerView(game, 'p1');
    expect(view.topCard).toBeDefined();
  });

  test('marks current player', () => {
    const game = createTestGame();
    const view = buildPlayerView(game, 'p1');
    const currentPlayer = view.players.find(p => p.isCurrentTurn);
    expect(currentPlayer?.id).toBe('p1');
  });
});
