'use strict';

const { v4: uuidv4 } = require('uuid');
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
    const gameId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');
    const { playerId } = body;

    if (!gameId || !playerId) return respond(400, { error: 'gameId and playerId required' });

    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });
    if (game.status !== 'finished') return respond(409, { error: 'Game not finished yet' });

    // Only host or any connected player can restart (host preferred)
    const isHost = game.hostId === playerId;
    const connectedPlayers = game.players.filter(p => p.connected !== false);
    const isConnected = connectedPlayers.some(p => p.id === playerId);
    if (!isHost && !isConnected) return respond(403, { error: 'Not authorized' });

    // Keep same players, re-deal fresh deck
    const playerIds = connectedPlayers.map(p => p.id);
    if (playerIds.length < 2) return respond(400, { error: 'Need at least 2 players to restart' });

    const deck = generateDeck();
    const { hands, drawPile, discardPile } = dealCards(deck, playerIds, INITIAL_CARDS);
    const topCard = discardPile[discardPile.length - 1];

    // Reset game state, keep same players, host, and cumulative scores
    const newGame = {
      ...game,
      status: 'playing',
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
      drawnCardPending: null,
      unoCallRequired: null,
      unoCallDeadline: null,
      winnerId: null,
      scores: null,
      skippedPlayerIndex: null,
      challengeResult: null,
      restartVotes: [],
      updatedAt: Date.now(),
      // cumulativeScores persists across rounds
      cumulativeScores: game.cumulativeScores || {},
      players: connectedPlayers.map(p => ({ ...p, connected: true }))
    };

    await putGame(newGame);

    // Broadcast personalised state to all
    const connections = await getConnectionsByGame(gameId);
    await Promise.allSettled(connections.map(({ connectionId, playerId: pid }) =>
      sendToConnection(connectionId, {
        type: 'gameRestarted',
        gameState: buildPlayerView(newGame, pid)
      })
    ));

    return respond(200, {
      success: true,
      gameState: buildPlayerView(newGame, playerId)
    });
  } catch (err) {
    console.error('restart-game error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}
