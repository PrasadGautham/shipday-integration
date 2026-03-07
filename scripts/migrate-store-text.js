const fs = require('node:fs');
const path = require('node:path');

const ordersDir = path.join('data', 'orders');
const ndjsonPath = path.join('data', 'shipday-events.ndjson');

function normalizeStoreText(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .replace(/ØŒ|Ø|،/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function patchPickupDetails(payload) {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }
  const pickup = payload.pickup_details;
  if (!pickup || typeof pickup !== 'object') {
    return 0;
  }

  let changes = 0;
  for (const key of ['name', 'address', 'formatted_address']) {
    const before = pickup[key];
    const after = normalizeStoreText(before);
    if (typeof before === 'string' && before !== after) {
      pickup[key] = after;
      changes += 1;
    }
  }
  return changes;
}

function migrateOrderFiles() {
  let filesChanged = 0;
  let fieldChanges = 0;

  if (!fs.existsSync(ordersDir)) {
    return { filesChanged, fieldChanges };
  }

  const files = fs.readdirSync(ordersDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const full = path.join(ordersDir, file);
    const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
    let fileChanges = 0;

    if (Array.isArray(obj.events)) {
      for (const event of obj.events) {
        fileChanges += patchPickupDetails(event.payload);
      }
    }

    if (fileChanges > 0) {
      fs.writeFileSync(full, JSON.stringify(obj, null, 2), 'utf8');
      filesChanged += 1;
      fieldChanges += fileChanges;
    }
  }

  return { filesChanged, fieldChanges };
}

function migrateNdjson() {
  if (!fs.existsSync(ndjsonPath)) {
    return { linesChanged: 0, fieldChanges: 0 };
  }

  const lines = fs.readFileSync(ndjsonPath, 'utf8').split(/\r?\n/);
  let linesChanged = 0;
  let fieldChanges = 0;
  const next = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const obj = JSON.parse(line);
    const changes = patchPickupDetails(obj.payload);
    if (changes > 0) {
      linesChanged += 1;
      fieldChanges += changes;
    }
    next.push(JSON.stringify(obj));
  }

  fs.writeFileSync(ndjsonPath, `${next.join('\n')}\n`, 'utf8');
  return { linesChanged, fieldChanges };
}

const orderStats = migrateOrderFiles();
const ndjsonStats = migrateNdjson();
console.log(JSON.stringify({ orderStats, ndjsonStats }));
