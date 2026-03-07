const fs = require('node:fs');
const path = require('node:path');

class EventTracker {
  constructor(options) {
    this.storePath = options.storePath;
    this.recentLimit = options.recentLimit;
    this.orderEventsDir = options.orderEventsDir;
    this.rebuildOrdersOnStart = options.rebuildOrdersOnStart !== false;
    this.countByStatus = new Map();
    this.totalEvents = 0;
    this.recentEvents = [];
    this.orderFileByOrderId = new Map();
    this.version = 0;

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

    if (this.rebuildOrdersOnStart) {
      this.clearOrderFiles();
    }

    const rebuiltRecords = new Map();
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        this.applyEvent(event);
        if (this.rebuildOrdersOnStart) {
          this.appendToRecordMap(rebuiltRecords, event);
        }
      } catch {
        // Skip malformed historical lines without crashing startup.
      }
    }

    if (this.rebuildOrdersOnStart) {
      this.flushRecordMap(rebuiltRecords);
    }

    this.version = this.totalEvents;
  }

  normalizeStatus(rawStatus) {
    if (!rawStatus) {
      return 'UNKNOWN';
    }

    return String(rawStatus).trim().toUpperCase();
  }

  normalizeStoreText(value) {
    return String(value || '')
      .replace(/Ã˜Å’|Ã˜ÂŒ|ØŒ/g, ',')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizePayload(rawBody) {
    if (!rawBody || typeof rawBody !== 'object') {
      return rawBody;
    }

    const body = JSON.parse(JSON.stringify(rawBody));
    const pickup = body.pickup_details;
    if (pickup && typeof pickup === 'object') {
      if (pickup.name) {
        pickup.name = this.normalizeStoreText(pickup.name);
      }
      if (pickup.address) {
        pickup.address = this.normalizeStoreText(pickup.address);
      }
      if (pickup.formatted_address) {
        pickup.formatted_address = this.normalizeStoreText(pickup.formatted_address);
      }
    }

    return body;
  }

  add(rawBody) {
    const normalizedBody = this.normalizePayload(rawBody);
    const extractedOrderId =
      normalizedBody?.orderId ||
      normalizedBody?.order_id ||
      normalizedBody?.id ||
      normalizedBody?.order?.id ||
      null;
    const extractedOrderNumber =
      normalizedBody?.orderNumber ||
      normalizedBody?.order_number ||
      normalizedBody?.order?.order_number ||
      null;
    const status = this.normalizeStatus(normalizedBody?.status || normalizedBody?.order_status || normalizedBody?.event);

    const event = {
      receivedAt: new Date().toISOString(),
      status,
      orderId: extractedOrderId,
      orderNumber: extractedOrderNumber,
      source: 'shipday',
      payload: normalizedBody
    };

    this.applyEvent(event);
    fs.appendFileSync(this.storePath, `${JSON.stringify(event)}\n`, 'utf8');
    this.appendPerOrderLog(event);
    this.version += 1;

    return event;
  }

  clearOrderFiles() {
    const files = fs.readdirSync(this.orderEventsDir).filter((name) => name.endsWith('.json'));
    for (const fileName of files) {
      const filePath = path.join(this.orderEventsDir, fileName);
      fs.unlinkSync(filePath);
    }
  }

  resolveOrderFilePath(orderId, orderNumber) {
    if (orderId && this.orderFileByOrderId.has(orderId)) {
      return this.orderFileByOrderId.get(orderId);
    }

    if (orderId) {
      const orderIdSuffix = `_${orderId}.json`;
      const candidates = fs
        .readdirSync(this.orderEventsDir)
        .filter((name) => name.endsWith('.json'))
        .filter((name) => name === `${orderId}.json` || name.endsWith(orderIdSuffix))
        .sort((a, b) => a.localeCompare(b));

      if (candidates.length > 0) {
        // Prefer the structured name "<orderNumber>_<orderId>.json" when present.
        const preferred = candidates.find((name) => name !== `${orderId}.json`) || candidates[0];
        const matchedPath = path.join(this.orderEventsDir, preferred);
        this.orderFileByOrderId.set(orderId, matchedPath);
        return matchedPath;
      }
    }

    const rawFileKey = orderNumber && orderId ? `${orderNumber}_${orderId}` : orderId || 'unknown-order';
    const safeFileKey = rawFileKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    const generatedPath = path.join(this.orderEventsDir, `${safeFileKey}.json`);
    if (orderId) {
      this.orderFileByOrderId.set(orderId, generatedPath);
    }
    return generatedPath;
  }

  atomicWriteJson(filePath, value) {
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const payload = JSON.stringify(value, null, 2);
    fs.writeFileSync(tempPath, payload, 'utf8');

    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      fs.writeFileSync(filePath, payload, 'utf8');
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  appendToRecordMap(recordMap, event) {
    const orderId = event.orderId ? String(event.orderId) : null;
    const orderNumber = event.orderNumber ? String(event.orderNumber) : null;
    const orderFilePath = this.resolveOrderFilePath(orderId, orderNumber);

    let record = recordMap.get(orderFilePath);
    if (!record) {
      record = {
        orderId: orderId || 'unknown-order',
        orderNumber: orderNumber || null,
        eventCount: 0,
        events: []
      };
    }

    record.orderId = orderId || record.orderId || 'unknown-order';
    record.orderNumber = record.orderNumber || orderNumber;
    record.events.push(event);
    record.eventCount = record.events.length;
    record.lastReceivedAt = event.receivedAt;
    record.lastStatus = event.status;

    recordMap.set(orderFilePath, record);
  }

  flushRecordMap(recordMap) {
    for (const [filePath, record] of recordMap.entries()) {
      this.atomicWriteJson(filePath, record);
    }
  }

  appendPerOrderLog(event) {
    const orderId = event.orderId ? String(event.orderId) : null;
    const orderNumber = event.orderNumber ? String(event.orderNumber) : null;
    const orderFilePath = this.resolveOrderFilePath(orderId, orderNumber);

    let record = {
      orderId: orderId || 'unknown-order',
      orderNumber,
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

    record.orderId = orderId || record.orderId || 'unknown-order';
    record.orderNumber = record.orderNumber || orderNumber;
    record.events.push(event);
    record.eventCount = record.events.length;
    record.lastReceivedAt = event.receivedAt;
    record.lastStatus = event.status;

    this.atomicWriteJson(orderFilePath, record);
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

  getVersion() {
    return this.version;
  }
}

module.exports = {
  EventTracker
};
