const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');
const { EventTracker } = require('./eventTracker');
const { buildDashboardData, withDateRange, buildTrendSeries, buildStoreDetails } = require('./dashboardData');

const config = getConfig();
const processLock = acquireProcessLock(config.processLockFile);
const tracker = new EventTracker({
  storePath: config.eventStoreFile,
  recentLimit: config.recentLimit,
  orderEventsDir: config.orderEventsDir,
  rebuildOrdersOnStart: config.rebuildOrdersOnStart
});

let dashboardCache = null;

const knownShipdayStatuses = [
  'STARTED',
  'PICKED_UP',
  'READY_TO_DELIVER',
  'DELIVERED',
  'FAILED_DELIVERY',
  'INCOMPLETE',
  'ALREADY_DELIVERED'
];

function releaseProcessLock() {
  if (processLock?.active && processLock?.filePath && fs.existsSync(processLock.filePath)) {
    fs.unlinkSync(processLock.filePath);
  }
  if (processLock) {
    processLock.active = false;
  }
}

process.on('exit', releaseProcessLock);
process.on('SIGINT', () => {
  releaseProcessLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  releaseProcessLock();
  process.exit(0);
});

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function acquireProcessLock(lockFilePath) {
  const dir = path.dirname(lockFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString()
  });

  try {
    const fd = fs.openSync(lockFilePath, 'wx');
    fs.writeFileSync(fd, payload, 'utf8');
    fs.closeSync(fd);
    return { filePath: lockFilePath, active: true };
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  let existingPid = null;
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    existingPid = Number(parsed?.pid);
  } catch {
    // Treat malformed lock file as stale.
  }

  if (isProcessAlive(existingPid)) {
    throw new Error(`Another server process is already running (pid ${existingPid})`);
  }

  fs.unlinkSync(lockFilePath);
  const fd = fs.openSync(lockFilePath, 'wx');
  fs.writeFileSync(fd, payload, 'utf8');
  fs.closeSync(fd);
  return { filePath: lockFilePath, active: true };
}

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

function parseIsoDate(value) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms);
}

function normalizeAndClampDateRange(reqUrl) {
  const normalizedFrom = normalizeRangeParam(reqUrl.searchParams.get('from'), 'start');
  const normalizedTo = normalizeRangeParam(reqUrl.searchParams.get('to'), 'end');

  const now = new Date();
  const maxRangeMs = config.maxRangeDays * 24 * 60 * 60 * 1000;
  const absoluteMin = new Date(now.getTime() - maxRangeMs);
  let toDate = parseIsoDate(normalizedTo) || now;
  let fromDate = parseIsoDate(normalizedFrom);
  let wasClamped = false;

  if (toDate > now) {
    toDate = now;
    wasClamped = true;
  }

  if (toDate < absoluteMin) {
    toDate = now;
    wasClamped = true;
  }

  const minAllowedFrom = new Date(toDate.getTime() - maxRangeMs);

  if (!fromDate) {
    fromDate = absoluteMin;
    wasClamped = true;
  }

  if (fromDate > toDate) {
    fromDate = minAllowedFrom;
    wasClamped = true;
  }

  if (fromDate < absoluteMin) {
    fromDate = absoluteMin;
    wasClamped = true;
  }

  if (fromDate < minAllowedFrom) {
    fromDate = minAllowedFrom;
    wasClamped = true;
  }

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    wasClamped,
    maxRangeDays: config.maxRangeDays
  };
}

function getDashboardBase() {
  const now = Date.now();
  const version = tracker.getVersion();

  if (
    dashboardCache &&
    dashboardCache.version === version &&
    now - dashboardCache.createdAt <= config.dashboardCacheTtlMs
  ) {
    return dashboardCache.data;
  }

  const data = buildDashboardData(config.orderEventsDir);
  dashboardCache = {
    version,
    createdAt: now,
    data
  };

  return data;
}

function invalidateDashboardCache() {
  dashboardCache = null;
}

function buildIntegrityReport(baseData) {
  const summary = tracker.getSummary();
  const orderFiles = baseData.orders.length;
  const orderEventsTotal = baseData.orders.reduce((sum, order) => sum + (order.eventCount || 0), 0);
  const ndjsonTotalEvents = summary.totalEvents;

  return {
    ok: orderEventsTotal === ndjsonTotalEvents,
    ndjsonTotalEvents,
    orderFiles,
    orderEventsTotal,
    difference: ndjsonTotalEvents - orderEventsTotal,
    generatedAt: new Date().toISOString()
  };
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
    const base = getDashboardBase();
    const range = normalizeAndClampDateRange(reqUrl);
    const data = withDateRange(base, { from: range.from, to: range.to });
    data.range = range;
    sendJson(res, 200, data);
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/stores' && req.method === 'GET') {
    const base = getDashboardBase();
    const range = normalizeAndClampDateRange(reqUrl);
    const data = withDateRange(base, { from: range.from, to: range.to });
    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      range,
      count: data.stores.length,
      stores: data.stores
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/orders' && req.method === 'GET') {
    const base = getDashboardBase();
    const range = normalizeAndClampDateRange(reqUrl);
    const data = withDateRange(base, { from: range.from, to: range.to });
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
      range,
      count: filtered.length,
      orders: filtered
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/trends' && req.method === 'GET') {
    const base = getDashboardBase();
    const range = normalizeAndClampDateRange(reqUrl);
    const data = withDateRange(base, { from: range.from, to: range.to });
    const storeId = reqUrl.searchParams.get('storeId') || '';
    const granularity = reqUrl.searchParams.get('granularity') || 'daily';
    const series = buildTrendSeries(data.orders, { storeId, granularity });

    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      range,
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

    const base = getDashboardBase();
    const range = normalizeAndClampDateRange(reqUrl);
    const data = withDateRange(base, { from: range.from, to: range.to });
    const details = buildStoreDetails(data.orders, { storeId });
    if (!details) {
      sendJson(res, 404, { error: 'Store not found in selected range' });
      return;
    }

    sendJson(res, 200, {
      generatedAt: data.generatedAt,
      range,
      ...details
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard/integrity' && req.method === 'GET') {
    const base = getDashboardBase();
    sendJson(res, 200, buildIntegrityReport(base));
    return;
  }

  if (reqUrl.pathname === '/webhooks/shipday/order-status-update' && req.method === 'POST') {
    if (!isTokenValid(reqUrl, req.headers)) {
      sendJson(res, 401, { error: 'Unauthorized webhook token' });
      return;
    }

    const payload = await parseJsonBody(req);
    const event = tracker.add(payload);
    invalidateDashboardCache();

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
