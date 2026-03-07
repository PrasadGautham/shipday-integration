const DEFAULT_PORT = 3000;
const DEFAULT_RECENT_LIMIT = 100;
const DEFAULT_DASHBOARD_CACHE_TTL_MS = 5000;
const DEFAULT_MAX_RANGE_DAYS = 62;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getConfig() {
  const webhookToken = process.env.SHIPDAY_WEBHOOK_TOKEN;
  if (!webhookToken) {
    throw new Error('Missing SHIPDAY_WEBHOOK_TOKEN environment variable');
  }

  return {
    port: toPositiveInt(process.env.PORT, DEFAULT_PORT),
    webhookToken,
    recentLimit: toPositiveInt(process.env.TRACKER_RECENT_LIMIT, DEFAULT_RECENT_LIMIT),
    eventStoreFile: process.env.TRACKER_EVENT_STORE_FILE || 'data/shipday-events.ndjson',
    orderEventsDir: process.env.TRACKER_ORDER_EVENTS_DIR || 'data/orders',
    processLockFile: process.env.PROCESS_LOCK_FILE || 'data/server.lock',
    dashboardCacheTtlMs: toPositiveInt(process.env.DASHBOARD_CACHE_TTL_MS, DEFAULT_DASHBOARD_CACHE_TTL_MS),
    maxRangeDays: toPositiveInt(process.env.MAX_FILTER_RANGE_DAYS, DEFAULT_MAX_RANGE_DAYS),
    rebuildOrdersOnStart: String(process.env.REBUILD_ORDERS_ON_START || 'true').toLowerCase() !== 'false'
  };
}

module.exports = {
  getConfig
};
