// Copy this file to api-config.js and fill in your values after deploying
// OR just run `bash scripts/deploy.sh` — it auto-generates api-config.js

const API_CONFIG = {
  REST_API_URL: 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod',
  WEBSOCKET_URL: 'wss://YOUR_WS_API_ID.execute-api.us-east-1.amazonaws.com/prod',
  FRONTEND_URL: 'https://YOUR_CLOUDFRONT_ID.cloudfront.net',
  REGION: 'us-east-1',
  ENV: 'prod'
};

if (typeof module !== 'undefined') module.exports = API_CONFIG;
