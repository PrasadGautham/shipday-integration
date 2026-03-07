const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');
const { EventTracker } = require('./eventTracker');
const { buildDashboardData, withDateRange, buildTrendSeries, buildStoreDetails } = require('./dashboardData');

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

function sendFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function normalizeRangeParam(rawValue, edge) {
  if (!rawValue) {
    return null;
  }

  const value = String(rawValue).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return edge === 'end' ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  }
  return value;
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
  const dashboardDir = path.join(__dirname, '..', 'public');

  if (reqUrl.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (reqUrl.pathname === '/dashboard' && req.method === 'GET') {
    sendFile(res, path.join(dashboardDir, 'dashboard.html'), 'text/html; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/dashboard/store' && req.method === 'GET') {
    sendFile(res, path.join(dashboardDir, 'store.html'), 'text/html; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/dashboard.css' && req.method === 'GET') {
    sendFile(res, path.join(dashboardDir, 'dashboard.css'), 'text/css; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/dashboard.js' && req.method === 'GET') {
    sendFile(res, path.join(dashboardDir, 'dashboard.js'), 'application/javascript; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/store.js' && req.method === 'GET') {
    sendFile(res, path.join(dashboardDir, 'store.js'), 'application/javascript; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/summary' && req.method === 'GET') {
    const base = buildDashboardData(config.orderEventsDir);
    const from = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
    const to = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');
    const data = withDateRange(base, { from, to });
    sendJson(res, 200, data);
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/stores' && req.method === 'GET') {
    const base = buildDashboardData(config.orderEventsDir);
    const from = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
    const to = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');
    const data = withDateRange(base, { from, to });
    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      count: data.stores.length,
      stores: data.stores
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/orders' && req.method === 'GET') {
    const base = buildDashboardData(config.orderEventsDir);
    const from = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
    const to = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');
    const data = withDateRange(base, { from, to });
    const storeId = reqUrl.searchParams.get('storeId');
    const status = reqUrl.searchParams.get('status');
    const search = reqUrl.searchParams.get('search');

    let filtered = data.orders;
    if (storeId) {
      filtered = filtered.filter((order) => order.store.id === storeId);
    }
    if (status) {
      filtered = filtered.filter((order) => order.currentStatus === status.toUpperCase());
    }
    if (search) {
      const needle = search.toLowerCase();
      filtered = filtered.filter(
        (order) =>
          order.orderNumber.toLowerCase().includes(needle) ||
          order.orderId.toLowerCase().includes(needle) ||
          order.customer.name.toLowerCase().includes(needle) ||
          order.store.name.toLowerCase().includes(needle) ||
          (order.store.address || '').toLowerCase().includes(needle)
      );
    }

    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      count: filtered.length,
      orders: filtered
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/trends' && req.method === 'GET') {
    const base = buildDashboardData(config.orderEventsDir);
    const from = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
    const to = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');
    const data = withDateRange(base, { from, to });
    const storeId = reqUrl.searchParams.get('storeId') || '';
    const granularity = reqUrl.searchParams.get('granularity') || 'daily';
    const series = buildTrendSeries(data.orders, { storeId, granularity });

    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      granularity: granularity === 'hourly' ? 'hourly' : 'daily',
      storeId: storeId || null,
      points: series
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/store-details' && req.method === 'GET') {
    const storeId = reqUrl.searchParams.get('storeId');
    if (!storeId) {
      sendJson(res, 400, { error: 'Missing storeId query parameter' });
      return;
    }

    const base = buildDashboardData(config.orderEventsDir);
    const from = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
    const to = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');
    const data = withDateRange(base, { from, to });
    const details = buildStoreDetails(data.orders, { storeId });
    if (!details) {
      sendJson(res, 404, { error: 'Store not found in selected range' });
      return;
    }

    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      ...details
    });
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
