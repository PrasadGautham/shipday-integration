const http = require('node:http');
const { getConfig } = require('./config');
const { EventTracker } = require('./eventTracker');

const config = getConfig();
const tracker = new EventTracker({
  storePath: config.eventStoreFile,
  recentLimit: config.recentLimit,
  orderEventsDir: config.orderEventsDir
});

const knownShipdayStatuses = [
  'STARTED',
  'PICKED_UP',
  'READY_TO_DELIVER',
  'DELIVERED',
  'FAILED_DELIVERY',
  'INCOMPLETE',
  'ALREADY_DELIVERED'
];

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function isTokenValid(reqUrl, reqHeaders) {
  const tokenFromHeader =
    reqHeaders.token ||
    reqHeaders['x-webhook-token'] ||
    reqHeaders.authorization?.replace(/^Bearer\s+/i, '');
  const tokenFromQuery = reqUrl.searchParams.get('token');
  const token = tokenFromHeader || tokenFromQuery;

  return token === config.webhookToken;
}

async function handleRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (reqUrl.pathname === '/webhooks/shipday/order-status-update' && req.method === 'POST') {
    if (!isTokenValid(reqUrl, req.headers)) {
      sendJson(res, 401, { error: 'Unauthorized webhook token' });
      return;
    }

    const payload = await parseJsonBody(req);
    const event = tracker.add(payload);

    sendJson(res, 200, {
      accepted: true,
      trackedStatus: event.status,
      isKnownShipdayStatus: knownShipdayStatuses.includes(event.status),
      orderId: event.orderId,
      receivedAt: event.receivedAt
    });
    return;
  }

  if (reqUrl.pathname === '/webhooks/shipday/events' && req.method === 'GET') {
    if (!isTokenValid(reqUrl, req.headers)) {
      sendJson(res, 401, { error: 'Unauthorized webhook token' });
      return;
    }

    sendJson(res, 200, {
      knownShipdayStatuses,
      tracker: tracker.getSummary()
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const statusCode = err.message === 'Payload too large' ? 413 : 400;
    sendJson(res, statusCode, { error: err.message });
  });
});

server.listen(config.port, () => {
  console.log(`Shipday webhook server listening on port ${config.port}`);
});
