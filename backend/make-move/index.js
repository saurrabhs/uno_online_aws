'use strict';

const { getGame, putGame, getConnectionsByGame, sendToConnection } = require('./shared/dynamodb-client');
const { applyMove, buildPlayerView } = require('./shared/game-validator');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  try {
    const gameId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');
    const { playerId, cardId, chosenColor } = body;

    if (!gameId || !playerId || !cardId) {
      return respond(400, { error: 'gameId, playerId, and cardId are required' });
    }

    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });

    const result = applyMove(game, playerId, cardId, chosenColor);
    if (!result.success) return respond(400, { error: result.error });

    const newState = result.newState;
    newState.updatedAt = Date.now();

    await putGame(newState);

    // Send each connected player their own personalised view
    await broadcastPersonalised(gameId, newState, {
      type: result.won ? 'gameOver' : 'cardPlayed',
      playerId,
      card: newState.lastPlayedCard,
      won: result.won
    });

    return respond(200, {
      success: true,
      gameState: buildPlayerView(newState, playerId),
      won: result.won
    });
  } catch (err) {
    console.error('make-move error:', err);
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
