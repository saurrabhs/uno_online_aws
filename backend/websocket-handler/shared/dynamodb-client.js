'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const GAMES_TABLE = process.env.GAMES_TABLE || 'uno-games';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'uno-connections';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

// ─── Games ────────────────────────────────────────────────────────────────────

async function getGame(gameId) {
  const result = await docClient.send(new GetCommand({
    TableName: GAMES_TABLE,
    Key: { gameId }
  }));
  return result.Item || null;
}

async function putGame(game) {
  await docClient.send(new PutCommand({
    TableName: GAMES_TABLE,
    Item: {
      ...game,
      ttl: Math.floor(Date.now() / 1000) + 86400 * 2 // 2 day TTL
    }
  }));
}

async function updateGame(gameId, updateExpression, expressionValues, expressionNames = {}) {
  const params = {
    TableName: GAMES_TABLE,
    Key: { gameId },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: 'ALL_NEW'
  };
  if (Object.keys(expressionNames).length > 0) {
    params.ExpressionAttributeNames = expressionNames;
  }
  const result = await docClient.send(new UpdateCommand(params));
  return result.Attributes;
}

async function listOpenGames() {
  const result = await docClient.send(new ScanCommand({
    TableName: GAMES_TABLE,
    FilterExpression: '#status = :waiting',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':waiting': 'waiting' },
    Limit: 20
  }));
  // Only return rooms that have at least one connected player
  const items = (result.Items || []).filter(g =>
    g.players && g.players.some(p => p.connected !== false)
  );
  return items;
}

// ─── Connections ──────────────────────────────────────────────────────────────

async function putConnection(connectionId, gameId, playerId) {
  await docClient.send(new PutCommand({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connectionId,
      gameId,
      playerId,
      connectedAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + 86400
    }
  }));
}

async function getConnection(connectionId) {
  const result = await docClient.send(new GetCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId }
  }));
  return result.Item || null;
}

async function deleteConnection(connectionId) {
  await docClient.send(new DeleteCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId }
  }));
}

async function getConnectionsByGame(gameId) {
  const result = await docClient.send(new QueryCommand({
    TableName: CONNECTIONS_TABLE,
    IndexName: 'gameId-index',
    KeyConditionExpression: 'gameId = :gameId',
    ExpressionAttributeValues: { ':gameId': gameId }
  }));
  return result.Items || [];
}

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

async function broadcastToGame(gameId, message) {
  const connections = await getConnectionsByGame(gameId);
  if (!connections.length) return;

  const wsEndpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!wsEndpoint) {
    console.warn('WEBSOCKET_ENDPOINT not set, skipping broadcast');
    return;
  }

  const wsClient = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  const payload = JSON.stringify(message);

  const sends = connections.map(async ({ connectionId }) => {
    try {
      await wsClient.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: payload
      }));
    } catch (err) {
      if (err.statusCode === 410) {
        // Stale connection - clean up
        await deleteConnection(connectionId).catch(() => {});
      } else {
        console.error(`Failed to send to ${connectionId}:`, err.message);
      }
    }
  });

  await Promise.allSettled(sends);
}

async function sendToConnection(connectionId, message) {
  const wsEndpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!wsEndpoint) return;

  const wsClient = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  try {
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
  } catch (err) {
    if (err.statusCode === 410) {
      await deleteConnection(connectionId).catch(() => {});
    }
  }
}

module.exports = {
  getGame,
  putGame,
  updateGame,
  listOpenGames,
  putConnection,
  getConnection,
  deleteConnection,
  getConnectionsByGame,
  broadcastToGame,
  sendToConnection,
  GAMES_TABLE,
  CONNECTIONS_TABLE
};
