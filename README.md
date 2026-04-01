# 🃏 UNO Multiplayer - AWS Cloud Game

A complete 4-player real-time UNO card game built with vanilla JavaScript frontend and AWS serverless backend.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│  CloudFront CDN → S3 Static Hosting                         │
│  index.html (Lobby) + game.html (Game Board)                │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                    API GATEWAY                               │
│  REST API: /games  /games/{id}/join  /games/{id}/move       │
│  WebSocket: wss:// $connect $disconnect $default            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  LAMBDA FUNCTIONS                            │
│  create-game │ join-game │ make-move │ draw-card            │
│  get-game-state │ websocket-handler                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    DYNAMODB                                  │
│  Games Table (gameId PK) │ Connections Table (connId PK)    │
└─────────────────────────────────────────────────────────────┘
```

## Features

- Real-time 4-player multiplayer via WebSockets
- Complete Uno rules: Skip, Reverse, Draw Two, Wild, Wild Draw Four
- Wild Draw Four challenge mechanic
- UNO call button with penalty system
- 30-second turn timer
- In-game chat
- SVG card graphics (no external images)
- Dark-themed responsive UI
- Winner celebration animation

## Prerequisites

- Node.js 18+
- AWS CLI configured (`aws configure`)
- AWS SAM CLI (`brew install aws-sam-cli` or see [SAM docs](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))
- An AWS account

## Quick Deploy

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

This will:
1. Deploy the SAM stack (DynamoDB, Lambda, API Gateway)
2. Upload frontend to S3
3. Output the game URL

## Local Development

```bash
# Install backend dependencies
cd backend && npm install

# Run unit tests
cd tests && npm test

# Start SAM local API (requires Docker)
cd infrastructure && sam local start-api
```

## API Documentation

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /games | Create a new game |
| GET | /games/{id} | Get game state |
| POST | /games/{id}/join | Join a game |
| POST | /games/{id}/move | Play a card |
| POST | /games/{id}/draw | Draw a card |

### POST /games
```json
{ "playerName": "Alice" }
// Returns: { "gameId": "ABC123", "playerId": "uuid", "gameState": {...} }
```

### POST /games/{id}/join
```json
{ "playerName": "Bob" }
// Returns: { "playerId": "uuid", "gameState": {...} }
```

### POST /games/{id}/move
```json
{ "playerId": "uuid", "cardId": "red-7-0", "chosenColor": "blue" }
// Returns: { "success": true, "gameState": {...} }
```

### POST /games/{id}/draw
```json
{ "playerId": "uuid" }
// Returns: { "drawnCard": {...}, "gameState": {...} }
```

### WebSocket Protocol

Connect: `wss://{endpoint}?gameId=ABC123&playerId=uuid`

#### Client → Server Messages
```json
{ "action": "chat", "message": "Hello!" }
{ "action": "ping" }
{ "action": "callUno" }
{ "action": "challengeDrawFour", "targetPlayerId": "uuid" }
```

#### Server → Client Messages
```json
{ "type": "gameState", "state": {...} }
{ "type": "chat", "playerName": "Alice", "message": "Hello!" }
{ "type": "playerJoined", "playerName": "Bob" }
{ "type": "gameStarted" }
{ "type": "turnChanged", "currentPlayerId": "uuid" }
{ "type": "cardPlayed", "playerId": "uuid", "card": {...} }
{ "type": "unoCall", "playerId": "uuid" }
{ "type": "gameOver", "winnerId": "uuid", "scores": {...} }
{ "type": "error", "message": "Invalid move" }
```

## Card Point Values

| Card | Points |
|------|--------|
| Number cards (0-9) | Face value |
| Skip, Reverse, Draw Two | 20 points |
| Wild, Wild Draw Four | 50 points |

First player to 500 points across rounds wins.

## Troubleshooting

**Deploy fails with "S3 bucket already exists"**: Change `STACK_NAME` in deploy.sh

**WebSocket not connecting**: Check API Gateway WebSocket URL in config/api-config.js after deploy

**Lambda cold start slow**: Functions are pre-warmed; first call may take ~1s

**DynamoDB throttling**: Free tier allows 25 RCU/WCU; game uses minimal capacity

## Cost Estimate (AWS Free Tier)

| Service | Free Tier | Estimated Cost |
|---------|-----------|----------------|
| Lambda | 1M requests/month | $0 |
| DynamoDB | 25 RCU/WCU | $0 |
| API Gateway | 1M REST calls | $0 |
| S3 | 5GB storage | $0 |
| CloudFront | 1TB transfer | $0 |

**Total: ~$0/month for casual use**

## Destroy Resources

```bash
chmod +x scripts/destroy.sh
./scripts/destroy.sh
```
