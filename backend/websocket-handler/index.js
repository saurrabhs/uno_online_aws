'use strict';

const {
  putConnection,
  getConnection,
  deleteConnection,
  getGame,
  putGame,
  getConnectionsByGame,
  sendToConnection
} = require('./shared/dynamodb-client');
const { applyChallenge, applyUnoPenalty, buildPlayerView, getNextPlayerIndex } = require('./shared/game-validator');

exports.handler = async (event) => {
  const { routeKey, connectionId } = event.requestContext;
  try {
    switch (routeKey) {
      case '$connect':    return await handleConnect(event, connectionId);
      case '$disconnect': return await handleDisconnect(connectionId);
      default:            return await handleMessage(event, connectionId);
    }
  } catch (err) {
    console.error(`WS error [${routeKey}]:`, err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

// ── helpers ──────────────────────────────────────────────────────────────────
async function broadcastAll(gameId, game) {
  const connections = await getConnectionsByGame(gameId);
  await Promise.allSettled(connections.map(({ connectionId, playerId }) =>
    sendToConnection(connectionId, {
      type: 'gameState',
      gameState: buildPlayerView(game, playerId)
    })
  ));
}

// ── connect ───────────────────────────────────────────────────────────────────
async function handleConnect(event, connectionId) {
  const qs = event.queryStringParameters || {};
  const { gameId, playerId } = qs;
  if (!gameId || !playerId) return { statusCode: 400, body: 'gameId and playerId required' };

  const game = await getGame(gameId);
  if (!game) return { statusCode: 404, body: 'Game not found' };

  const player = game.players.find(p => p.id === playerId);
  if (!player) return { statusCode: 403, body: 'Player not in game' };

  await putConnection(connectionId, gameId, playerId);

  player.connected = true;
  game.updatedAt = Date.now();
  await putGame(game);

  // Send full state to this player
  await sendToConnection(connectionId, {
    type: 'connected',
    gameState: buildPlayerView(game, playerId)
  });

  // Notify others
  const others = await getConnectionsByGame(gameId);
  await Promise.allSettled(
    others
      .filter(c => c.connectionId !== connectionId)
      .map(({ connectionId: cid, playerId: pid }) =>
        sendToConnection(cid, {
          type: 'playerConnected',
          playerId,
          playerName: player.name,
          gameState: buildPlayerView(game, pid)
        })
      )
  );

  return { statusCode: 200, body: 'Connected' };
}

// ── disconnect ────────────────────────────────────────────────────────────────
async function handleDisconnect(connectionId) {
  const conn = await getConnection(connectionId);
  if (!conn) return { statusCode: 200, body: 'OK' };

  const { gameId, playerId } = conn;
  await deleteConnection(connectionId);

  const game = await getGame(gameId);
  if (!game) return { statusCode: 200, body: 'OK' };

  const player = game.players.find(p => p.id === playerId);
  if (!player) return { statusCode: 200, body: 'OK' };

  player.connected = false;
  game.updatedAt = Date.now();

  // If all players disconnected from a waiting room, mark it for cleanup
  if (game.status === 'waiting') {
    const anyConnected = game.players.some(p => p.connected !== false);
    if (!anyConnected) {
      // Mark as abandoned — TTL will clean it up, or we delete it now
      game.status = 'abandoned';
      game.updatedAt = Date.now();
      await putGame(game);
      return { statusCode: 200, body: 'OK' };
    }
  }

  // ── Handle mid-game disconnect ──────────────────────────────────────────
  if (game.status === 'playing') {
    const activePlayers = game.players.filter(p => p.connected !== false);

    if (activePlayers.length < 1) {
      // Everyone left — just save
      await putGame(game);
      return { statusCode: 200, body: 'OK' };
    }

    if (activePlayers.length === 1) {
      // Only one player left — they win by default
      game.status = 'finished';
      game.winnerId = activePlayers[0].id;
      game.scores = {};
      game.players.forEach(p => {
        game.scores[p.id] = (game.hands[p.id] || []).reduce((s, c) => {
          if (c.type === 'number') return s + c.value;
          if (['skip','reverse','drawTwo'].includes(c.type)) return s + 20;
          return s + 50;
        }, 0);
      });
      await putGame(game);
      await broadcastAll(gameId, game);
      return { statusCode: 200, body: 'OK' };
    }

    // 2+ players remain — if it was the disconnected player's turn, skip them
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer?.id === playerId) {
      // Find next connected player
      const playerCount = game.players.length;
      let nextIdx = game.currentPlayerIndex;
      for (let i = 0; i < playerCount; i++) {
        nextIdx = (nextIdx + game.direction + playerCount) % playerCount;
        if (game.players[nextIdx].connected !== false) break;
      }
      game.currentPlayerIndex = nextIdx;
      game.turnStartedAt = Date.now();
      game.drawnCardPending = null;
    }
  }

  await putGame(game);
  await broadcastAll(gameId, game);

  return { statusCode: 200, body: 'OK' };
}

// ── messages ──────────────────────────────────────────────────────────────────
async function handleMessage(event, connectionId) {
  const conn = await getConnection(connectionId);
  if (!conn) return { statusCode: 403, body: 'Not authenticated' };

  const { gameId, playerId } = conn;
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { action } = body;

  switch (action) {

    case 'ping':
      await sendToConnection(connectionId, { type: 'pong', timestamp: Date.now() });
      break;

    case 'chat': {
      const message = (body.message || '').trim().slice(0, 200);
      if (!message) break;
      const game = await getGame(gameId);
      const player = game?.players.find(p => p.id === playerId);
      const connections = await getConnectionsByGame(gameId);
      await Promise.allSettled(connections.map(({ connectionId: cid }) =>
        sendToConnection(cid, {
          type: 'chat',
          playerId,
          playerName: player?.name || 'Unknown',
          message,
          timestamp: Date.now()
        })
      ));
      break;
    }

    case 'callUno': {
      const game = await getGame(gameId);
      if (!game) break;
      const hand = game.hands[playerId] || [];
      if (hand.length === 1) {
        game.unoCallRequired = null;
        game.unoCalled = playerId;
        game.updatedAt = Date.now();
        await putGame(game);
        const connections = await getConnectionsByGame(gameId);
        await Promise.allSettled(connections.map(({ connectionId: cid }) =>
          sendToConnection(cid, {
            type: 'unoCall',
            playerId,
            playerName: game.players.find(p => p.id === playerId)?.name
          })
        ));
      }
      break;
    }

    case 'catchUno': {
      const { targetPlayerId } = body;
      const game = await getGame(gameId);
      if (!game) break;

      const targetHand = game.hands[targetPlayerId] || [];
      // Player can be caught if:
      // 1. They have exactly 1 card
      // 2. unoCallRequired is set for them (they haven't called UNO yet)
      // 3. The catch window hasn't expired (within 4 seconds of playing)
      const withinWindow = !game.unoCallDeadline || Date.now() < game.unoCallDeadline;
      const canBeCaught = targetHand.length === 1 &&
        game.unoCallRequired === targetPlayerId &&
        withinWindow;

      if (canBeCaught) {
        const result = applyUnoPenalty(game, targetPlayerId);
        if (result.success) {
          result.newState.updatedAt = Date.now();
          await putGame(result.newState);
          const connections = await getConnectionsByGame(gameId);
          // Notify everyone
          await Promise.allSettled(connections.map(({ connectionId: cid, playerId: pid }) =>
            sendToConnection(cid, {
              type: 'gameState',
              gameState: buildPlayerView(result.newState, pid),
              event: { type: 'unoPenalty', targetPlayerId, caughtBy: playerId }
            })
          ));
          // Also send a dedicated notification
          await Promise.allSettled(connections.map(({ connectionId: cid }) =>
            sendToConnection(cid, {
              type: 'unoPenalty',
              targetPlayerId,
              caughtBy: playerId,
              caughtByName: game.players.find(p => p.id === playerId)?.name,
              targetName: game.players.find(p => p.id === targetPlayerId)?.name
            })
          ));
        }
      } else {
        // Tell the catcher it was too late or invalid
        await sendToConnection(connectionId, {
          type: 'catchFailed',
          reason: !withinWindow ? 'Too late! The window has passed.' : 'Player already called UNO or has more than 1 card.'
        });
      }
      break;
    }

    case 'challengeDrawFour': {
      const game = await getGame(gameId);
      if (!game) break;
      const result = applyChallenge(game, playerId);
      if (result.success) {
        result.newState.updatedAt = Date.now();
        await putGame(result.newState);
        const connections = await getConnectionsByGame(gameId);
        await Promise.allSettled(connections.map(({ connectionId: cid, playerId: pid }) =>
          sendToConnection(cid, {
            type: 'gameState',
            gameState: buildPlayerView(result.newState, pid),
            event: { type: 'challengeResult', result: result.newState.challengeResult }
          })
        ));
      }
      break;
    }

    case 'requestRestart': {
      // Player signals they want to restart
      const game = await getGame(gameId);
      if (!game || game.status !== 'finished') break;

      if (!game.restartVotes) game.restartVotes = [];
      if (!game.restartVotes.includes(playerId)) {
        game.restartVotes.push(playerId);
      }
      game.updatedAt = Date.now();
      await putGame(game);

      const connections = await getConnectionsByGame(gameId);
      await Promise.allSettled(connections.map(({ connectionId: cid }) =>
        sendToConnection(cid, {
          type: 'restartVote',
          votes: game.restartVotes.length,
          needed: game.players.filter(p => p.connected !== false).length,
          votedBy: playerId,
          playerName: game.players.find(p => p.id === playerId)?.name
        })
      ));
      break;
    }

    default:
      await sendToConnection(connectionId, { type: 'error', message: `Unknown action: ${action}` });
  }

  return { statusCode: 200, body: 'OK' };
}
