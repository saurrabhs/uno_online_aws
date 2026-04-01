'use strict';

const { getGame, listOpenGames } = require('./shared/dynamodb-client');
const { buildPlayerView } = require('./shared/game-validator');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  try {
    const gameId = event.pathParameters?.id;

    // List open games
    if (!gameId) {
      const games = await listOpenGames();
      return respond(200, {
        games: games.map(g => ({
          gameId: g.gameId,
          playerCount: g.players.length,
          maxPlayers: 4,
          players: g.players.map(p => p.name),
          createdAt: g.createdAt
        }))
      });
    }

    const playerId = event.queryStringParameters?.playerId;
    const game = await getGame(gameId);
    if (!game) return respond(404, { error: 'Game not found' });

    let view;
    if (game.status === 'waiting') {
      // Return waiting view — no cards dealt yet
      view = {
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
    } else {
      view = playerId
        ? buildPlayerView(game, playerId)
        : { gameId: game.gameId, status: game.status, players: game.players.map(p => ({ id: p.id, name: p.name })) };
    }

    return respond(200, { gameState: view });
  } catch (err) {
    console.error('get-game-state error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
