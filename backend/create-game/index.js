'use strict';

const { v4: uuidv4 } = require('uuid');
const { putGame } = require('./shared/dynamodb-client');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const playerName = (body.playerName || 'Player 1').trim().slice(0, 20);
    const deviceId   = (body.deviceId || '').trim();

    if (!playerName) return respond(400, { error: 'playerName is required' });

    const gameId  = generateGameCode();
    const playerId = uuidv4();

    // Don't deal cards yet — deal happens when host starts the game
    const game = {
      gameId,
      status: 'waiting',
      hostId: playerId,
      players: [{
        id: playerId,
        name: playerName,
        deviceId: deviceId || null,
        connected: true,
        joinedAt: Date.now()
      }],
      hands: {},
      drawPile: [],
      discardPile: [],
      currentPlayerIndex: 0,
      currentColor: null,
      direction: 1,
      turnStartedAt: null,
      lastPlayedCard: null,
      lastPlayerId: null,
      pendingDraw: null,
      pendingChallenge: null,
      unoCallRequired: null,
      winnerId: null,
      scores: null,
      cumulativeScores: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await putGame(game);

    return respond(201, {
      gameId,
      playerId,
      isHost: true,
      gameState: buildWaitingView(game, playerId)
    });
  } catch (err) {
    console.error('create-game error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

// Minimal view for waiting state (no cards yet)
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
      cumulativeScore: 0
    })),
    currentPlayerId: null,
    currentColor: null,
    direction: 1,
    topCard: null,
    drawPileCount: 0,
    myHand: [],
    turnStartedAt: null,
    cumulativeScores: {}
  };
}

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
