'use strict';

const { generateDeck, dealCards } = require('./shared/uno-deck');
const { getGame, putGame, getConnectionsByGame, sendToConnection } = require('./shared/dynamodb-client');
const { buildPlayerView } = require('./shared/game-validator');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const INITIAL_CARDS = parseInt(process.env.INITIAL_CARDS || '7');

exports.handler = async (event) => {
  try {
    const gameId  = event.pathParameters?.id;
    const body    = JSON.parse(event.body || '{}');
    const { playerId } = body;

    if (!gameId || !playerId) return respond(400, { error: 'gameId and playerId are required' });

    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });
    if (game.status !== 'waiting') return respond(409, { error: 'Game already started or finished' });
    if (game.hostId !== playerId) return respond(403, { error: 'Only the host can start the game' });
    if (game.players.length < 2) return respond(400, { error: 'Need at least 2 players to start' });

    // Deal cards now that we know who's playing
    const playerIds = game.players.map(p => p.id);
    const deck = generateDeck();
    const { hands, drawPile, discardPile } = dealCards(deck, playerIds, INITIAL_CARDS);
    const topCard = discardPile[discardPile.length - 1];

    game.status         = 'playing';
    game.hands          = hands;
    game.drawPile       = drawPile;
    game.discardPile    = discardPile;
    game.currentColor   = topCard.color === 'wild' ? 'red' : topCard.color;
    game.turnStartedAt  = Date.now();
    game.updatedAt      = Date.now();

    await putGame(game);

    // Send each player their personalised view
    const connections = await getConnectionsByGame(gameId);
    await Promise.allSettled(connections.map(({ connectionId, playerId: pid }) =>
      sendToConnection(connectionId, {
        type: 'gameStarted',
        gameState: buildPlayerView(game, pid)
      })
    ));

    return respond(200, {
      success: true,
      gameState: buildPlayerView(game, playerId)
    });
  } catch (err) {
    console.error('start-game error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
