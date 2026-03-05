const fs = require('node:fs');
const path = require('node:path');

class EventTracker {
  constructor(options) {
    this.storePath = options.storePath;
    this.recentLimit = options.recentLimit;
    this.orderEventsDir = options.orderEventsDir;
    this.countByStatus = new Map();
    this.totalEvents = 0;
    this.recentEvents = [];

    this.ensureStoreDirs();
    this.loadFromDisk();
  }

  ensureStoreDirs() {
    const ndjsonDir = path.dirname(this.storePath);
    if (!fs.existsSync(ndjsonDir)) {
      fs.mkdirSync(ndjsonDir, { recursive: true });
    }

    if (!fs.existsSync(this.orderEventsDir)) {
      fs.mkdirSync(this.orderEventsDir, { recursive: true });
    }
  }

  loadFromDisk() {
    if (!fs.existsSync(this.storePath)) {
      return;
    }

    const content = fs.readFileSync(this.storePath, 'utf8');
    if (!content.trim()) {
      return;
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        this.applyEvent(event);
      } catch {
        // Skip malformed historical lines without crashing startup.
      }
    }
  }

  normalizeStatus(rawStatus) {
    if (!rawStatus) {
      return 'UNKNOWN';
    }

    return String(rawStatus).trim().toUpperCase();
  }

  add(rawBody) {
    const status = this.normalizeStatus(rawBody?.status || rawBody?.order_status || rawBody?.event);

    const event = {
      receivedAt: new Date().toISOString(),
      status,
      orderId: rawBody?.orderId || rawBody?.order_id || rawBody?.id || null,
      source: 'shipday',
      payload: rawBody
    };

    this.applyEvent(event);
    fs.appendFileSync(this.storePath, `${JSON.stringify(event)}\n`, 'utf8');
    this.appendPerOrderLog(event);

    return event;
  }

  appendPerOrderLog(event) {
    const orderId = event.orderId ? String(event.orderId) : 'unknown-order';
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const orderFilePath = path.join(this.orderEventsDir, `${safeOrderId}.json`);

    let record = {
      orderId,
      eventCount: 0,
      events: []
    };

    if (fs.existsSync(orderFilePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(orderFilePath, 'utf8'));
        if (parsed && Array.isArray(parsed.events)) {
          record = parsed;
        }
      } catch {
        // If one file is malformed, reset this order file and keep service running.
      }
    }

    record.orderId = orderId;
    record.events.push(event);
    record.eventCount = record.events.length;
    record.lastReceivedAt = event.receivedAt;
    record.lastStatus = event.status;

    fs.writeFileSync(orderFilePath, JSON.stringify(record, null, 2), 'utf8');
  }

  applyEvent(event) {
    this.totalEvents += 1;
    this.countByStatus.set(event.status, (this.countByStatus.get(event.status) || 0) + 1);

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.recentLimit) {
      this.recentEvents.splice(0, this.recentEvents.length - this.recentLimit);
    }
  }

  getSummary() {
    return {
      totalEvents: this.totalEvents,
      countByStatus: Object.fromEntries(this.countByStatus),
      recentEvents: [...this.recentEvents].reverse()
    };
  }
}

module.exports = {
  EventTracker
};
