'use strict';

const { getGame, putGame, getConnectionsByGame, sendToConnection } = require('./shared/dynamodb-client');
const { applyDraw, applyPass, buildPlayerView } = require('./shared/game-validator');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  try {
    const gameId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');
    const { playerId, pass } = body;

    if (!gameId || !playerId) {
      return respond(400, { error: 'gameId and playerId are required' });
    }

    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });

    let result;

    if (pass) {
      // Player chose to keep drawn card and pass turn
      result = applyPass(game, playerId);
    } else {
      result = applyDraw(game, playerId);
    }

    if (!result.success) return respond(400, { error: result.error });

    const newState = result.newState;
    newState.updatedAt = Date.now();

    await putGame(newState);

    // Send each connected player their own personalised view
    await broadcastPersonalised(gameId, newState, {
      type: pass ? 'turnPassed' : 'cardDrawn',
      playerId,
      canPlay: result.canPlay
    });

    return respond(200, {
      success: true,
      drawnCard: result.drawnCard || null,
      canPlay: result.canPlay || false,
      gameState: buildPlayerView(newState, playerId)
    });
  } catch (err) {
    console.error('draw-card error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

async function broadcastPersonalised(gameId, newState, event) {
  const connections = await getConnectionsByGame(gameId);
  await Promise.allSettled(connections.map(({ connectionId, playerId: connPlayerId }) =>
    sendToConnection(connectionId, {
      type: 'gameState',
      gameState: buildPlayerView(newState, connPlayerId),
      event
    })
  ));
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}
