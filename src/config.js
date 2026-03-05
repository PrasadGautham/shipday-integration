const DEFAULT_PORT = 3000;
const DEFAULT_RECENT_LIMIT = 100;

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
    orderEventsDir: process.env.TRACKER_ORDER_EVENTS_DIR || 'data/orders'
  };
}

module.exports = {
  getConfig
};
