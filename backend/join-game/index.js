'use strict';

const { v4: uuidv4 } = require('uuid');
const { getGame, putGame, getConnectionsByGame, sendToConnection } = require('./shared/dynamodb-client');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '4');

exports.handler = async (event) => {
  try {
    const gameId    = event.pathParameters?.id;
    const body      = JSON.parse(event.body || '{}');
    const playerName = (body.playerName || 'Player').trim().slice(0, 20);
    const deviceId   = (body.deviceId || '').trim();

    if (!gameId)     return respond(400, { error: 'gameId is required' });
    if (!playerName) return respond(400, { error: 'playerName is required' });

    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });

    // ── Duplicate device check — always first ──────────────────────────────
    if (deviceId) {
      const existing = game.players.find(p => p.deviceId === deviceId);
      if (existing) {
        return respond(200, {
          playerId: existing.id,
          isHost: game.hostId === existing.id,
          rejoined: true,
          gameState: buildWaitingView(game, existing.id)
        });
      }
    }

    if (game.status !== 'waiting') return respond(409, { error: 'Game already started or finished' });
    if (game.players.length >= MAX_PLAYERS) return respond(409, { error: 'Game is full' });

    const playerId = uuidv4();

    game.players.push({
      id: playerId,
      name: playerName,
      deviceId: deviceId || null,
      connected: true,
      joinedAt: Date.now()
    });
    game.updatedAt = Date.now();

    await putGame(game);

    // Broadcast updated waiting state to all connected players
    const connections = await getConnectionsByGame(gameId);
    await Promise.allSettled(connections.map(({ connectionId, playerId: pid }) =>
      sendToConnection(connectionId, {
        type: 'playerJoined',
        playerName,
        playerId,
        playerCount: game.players.length,
        gameState: buildWaitingView(game, pid)
      })
    ));

    return respond(200, {
      playerId,
      isHost: false,
      gameState: buildWaitingView(game, playerId)
    });
  } catch (err) {
    console.error('join-game error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

// Waiting view — no cards, just player list
function buildWaitingView(game, viewingPlayerId) {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      cardCount: 0,
      isCurrentTurn: false,
      connected: p.connected !== false,
      cumulativeScore: (game.cumulativeScores || {})[p.id] || 0
    })),
    currentPlayerId: null,
    currentColor: null,
    direction: 1,
    topCard: null,
    drawPileCount: 0,
    myHand: [],
    turnStartedAt: null,
    cumulativeScores: game.cumulativeScores || {}
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
