const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function toIsoFromEpochMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return new Date(ms).toISOString();
}

function minutesBetween(fromIso, toIso) {
  if (!fromIso || !toIso) {
    return null;
  }
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  return Math.round(((to - from) / 60000) * 10) / 10;
}

function normalizeStatus(status) {
  if (!status) {
    return 'UNKNOWN';
  }
  return String(status).trim().toUpperCase();
}

function normalizeStoreText(value) {
  return String(value || '')
    .replace(/ØŒ|Ø|،/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildStoreId(storeName, storeAddress) {
  const key = `${normalizeStoreText(storeName)}|${normalizeStoreText(storeAddress)}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `store_${hash}`;
}

function getLatestOrderSnapshot(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const order = events[i]?.payload?.order;
    if (order) {
      return order;
    }
  }
  return null;
}

function getCompany(events) {
  for (const event of events) {
    const company = event?.payload?.company;
    if (company?.name) {
      return {
        id: company.id || null,
        name: company.name
      };
    }
  }
  return {
    id: null,
    name: 'Unknown Company'
  };
}

function getStore(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const pickup = events[i]?.payload?.pickup_details;
    if (pickup?.name || pickup?.address) {
      return {
        name: pickup.name || 'Unknown Store',
        phone: pickup.phone || null,
        address: pickup.formatted_address || pickup.address || null,
        location: pickup.location || null
      };
    }
  }
  return {
    name: 'Unknown Store',
    phone: null,
    address: null,
    location: null
  };
}

function getCustomer(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const delivery = events[i]?.payload?.delivery_details;
    if (delivery) {
      return {
        name: delivery.name || 'Unknown Customer',
        phone: delivery.phone || null,
        address: delivery.formatted_address || delivery.address || null
      };
    }
  }
  return {
    name: 'Unknown Customer',
    phone: null,
    address: null
  };
}

function getTimeline(events, snapshot) {
  const timeline = {
    placementAt: toIsoFromEpochMs(snapshot?.placement_time),
    expectedPickupAt: toIsoFromEpochMs(snapshot?.expected_pickup_time),
    expectedDeliveryAt: toIsoFromEpochMs(snapshot?.expected_delivery_time),
    assignedAt: toIsoFromEpochMs(snapshot?.assigned_time),
    startedAt: toIsoFromEpochMs(snapshot?.start_time),
    pickedUpAt: toIsoFromEpochMs(snapshot?.pickedup_time),
    enRouteAt: toIsoFromEpochMs(snapshot?.arrived_time),
    deliveredAt: toIsoFromEpochMs(snapshot?.delivery_time),
    firstWebhookAt: events[0]?.receivedAt || null,
    lastWebhookAt: events[events.length - 1]?.receivedAt || null
  };

  if (!timeline.deliveredAt) {
    const deliveredEvent = events.find((event) =>
      ['DELIVERED', 'ALREADY_DELIVERED'].includes(normalizeStatus(event.status))
    );
    if (deliveredEvent?.receivedAt) {
      timeline.deliveredAt = deliveredEvent.receivedAt;
    }
  }

  return timeline;
}

function toOrderView(orderRecord) {
  const events = Array.isArray(orderRecord?.events) ? orderRecord.events : [];
  if (!events.length) {
    return null;
  }

  const sortedEvents = [...events].sort(
    (a, b) => Date.parse(a?.receivedAt || 0) - Date.parse(b?.receivedAt || 0)
  );
  const snapshot = getLatestOrderSnapshot(sortedEvents);
  const company = getCompany(sortedEvents);
  const store = getStore(sortedEvents);
  const storeId = buildStoreId(store.name, store.address || '');
  const customer = getCustomer(sortedEvents);
  const timeline = getTimeline(sortedEvents, snapshot);
  const currentStatus = normalizeStatus(orderRecord.lastStatus || sortedEvents[sortedEvents.length - 1]?.status);
  const isDelivered = ['DELIVERED', 'ALREADY_DELIVERED'].includes(currentStatus);
  const isFailed = ['FAILED_DELIVERY', 'INCOMPLETE'].includes(currentStatus);

  return {
    orderId: String(orderRecord.orderId || snapshot?.id || 'unknown-order'),
    orderNumber: String(orderRecord.orderNumber || snapshot?.order_number || 'N/A'),
    company,
    store: {
      ...store,
      id: storeId
    },
    customer,
    currentStatus,
    isDelivered,
    isFailed,
    eventCount: sortedEvents.length,
    trackingUrl: sortedEvents[sortedEvents.length - 1]?.payload?.trackingUrl || null,
    timeline,
    metrics: {
      minutesPlacementToPickup: minutesBetween(timeline.placementAt, timeline.pickedUpAt),
      minutesPickupToDelivered: minutesBetween(timeline.pickedUpAt, timeline.deliveredAt),
      minutesPlacementToDelivered: minutesBetween(timeline.placementAt, timeline.deliveredAt),
      minutesExpectedVsActualDelivery: minutesBetween(timeline.expectedDeliveryAt, timeline.deliveredAt)
    },
    events: sortedEvents.map((event) => ({
      receivedAt: event.receivedAt || null,
      status: normalizeStatus(event.status),
      eventType: event?.payload?.event || null
    }))
  };
}

function aggregateByStore(orders) {
  const map = new Map();

  for (const order of orders) {
    const key = order.store.id || buildStoreId(order.store.name, order.store.address || '');
    if (!map.has(key)) {
      map.set(key, {
        storeId: key,
        storeName: order.store.name,
        storeAddress: order.store.address,
        storePhone: order.store.phone,
        totalOrders: 0,
        deliveredOrders: 0,
        inProgressOrders: 0,
        failedOrders: 0,
        deliveryMinutesSamples: []
      });
    }

    const agg = map.get(key);
    agg.totalOrders += 1;
    if (order.isDelivered) {
      agg.deliveredOrders += 1;
    } else if (order.isFailed) {
      agg.failedOrders += 1;
    } else {
      agg.inProgressOrders += 1;
    }

    if (order.metrics.minutesPlacementToDelivered !== null) {
      agg.deliveryMinutesSamples.push(order.metrics.minutesPlacementToDelivered);
    }
  }

  return [...map.values()]
    .map((entry) => {
      const avgDeliveryMins = entry.deliveryMinutesSamples.length
        ? Math.round(
            (entry.deliveryMinutesSamples.reduce((sum, value) => sum + value, 0) /
              entry.deliveryMinutesSamples.length) *
              10
          ) / 10
        : null;
      return {
        storeId: entry.storeId,
        storeName: entry.storeName,
        storeAddress: entry.storeAddress,
        storePhone: entry.storePhone,
        totalOrders: entry.totalOrders,
        deliveredOrders: entry.deliveredOrders,
        inProgressOrders: entry.inProgressOrders,
        failedOrders: entry.failedOrders,
        avgDeliveryMins
      };
    })
    .sort((a, b) => b.totalOrders - a.totalOrders || a.storeName.localeCompare(b.storeName));
}

function readOrdersFromDir(ordersDir) {
  if (!fs.existsSync(ordersDir)) {
    return [];
  }

  const fileNames = fs
    .readdirSync(ordersDir)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const orders = [];
  for (const fileName of fileNames) {
    const filePath = path.join(ordersDir, fileName);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const view = toOrderView(parsed);
      if (view) {
        view.fileName = fileName;
        orders.push(view);
      }
    } catch {
      // Keep dashboard resilient even if one file is malformed.
    }
  }

  return orders.sort((a, b) => {
    const aTime = Date.parse(a.timeline.lastWebhookAt || 0);
    const bTime = Date.parse(b.timeline.lastWebhookAt || 0);
    return bTime - aTime;
  });
}

function getOrderReferenceIso(order) {
  return order.timeline.placementAt || order.timeline.firstWebhookAt || order.timeline.lastWebhookAt || null;
}

function filterOrdersByDateRange(orders, options = {}) {
  const fromMs = options.from ? Date.parse(options.from) : null;
  const toMs = options.to ? Date.parse(options.to) : null;

  return orders.filter((order) => {
    const refIso = getOrderReferenceIso(order);
    if (!refIso) {
      return false;
    }

    const refMs = Date.parse(refIso);
    if (!Number.isFinite(refMs)) {
      return false;
    }

    if (fromMs !== null && Number.isFinite(fromMs) && refMs < fromMs) {
      return false;
    }
    if (toMs !== null && Number.isFinite(toMs) && refMs > toMs) {
      return false;
    }
    return true;
  });
}

function summaryFromOrders(orders) {
  const delivered = orders.filter((order) => order.isDelivered).length;
  const failed = orders.filter((order) => order.isFailed).length;
  const inProgress = orders.length - delivered - failed;
  const samples = orders.map((order) => order.metrics.minutesPlacementToDelivered).filter((value) => value !== null);
  const avgDeliveryMins = samples.length
    ? Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10) / 10
    : null;

  return {
    totalOrders: orders.length,
    deliveredOrders: delivered,
    inProgressOrders: inProgress,
    failedOrders: failed,
    avgDeliveryMins
  };
}

function withDateRange(data, options = {}) {
  const filteredOrders = filterOrdersByDateRange(data.orders, options);
  return {
    generatedAt: data.generatedAt,
    summary: summaryFromOrders(filteredOrders),
    stores: aggregateByStore(filteredOrders),
    orders: filteredOrders
  };
}

function bucketKeyFromIso(iso, granularity) {
  const date = new Date(iso);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  if (granularity === 'hourly') {
    return `${y}-${m}-${d} ${h}:00`;
  }
  return `${y}-${m}-${d}`;
}

function buildTrendSeries(orders, options = {}) {
  const granularity = options.granularity === 'hourly' ? 'hourly' : 'daily';
  const storeId = String(options.storeId || '').trim();

  const filteredOrders = orders.filter((order) => {
    if (!storeId) {
      return true;
    }
    return order.store.id === storeId;
  });

  const map = new Map();
  for (const order of filteredOrders) {
    const refIso = getOrderReferenceIso(order);
    if (!refIso) {
      continue;
    }
    const key = bucketKeyFromIso(refIso, granularity);
    if (!map.has(key)) {
      map.set(key, {
        bucket: key,
        totalOrders: 0,
        deliveredOrders: 0,
        inProgressOrders: 0,
        failedOrders: 0
      });
    }
    const entry = map.get(key);
    entry.totalOrders += 1;
    if (order.isDelivered) {
      entry.deliveredOrders += 1;
    } else if (order.isFailed) {
      entry.failedOrders += 1;
    } else {
      entry.inProgressOrders += 1;
    }
  }

  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function buildDashboardData(ordersDir) {
  const orders = readOrdersFromDir(ordersDir);
  return {
    generatedAt: new Date().toISOString(),
    summary: summaryFromOrders(orders),
    stores: aggregateByStore(orders),
    orders
  };
}

function buildStoreDetails(orders, options = {}) {
  const storeId = String(options.storeId || '').trim();
  const filtered = orders.filter((order) => order.store.id === storeId);

  if (!filtered.length) {
    return null;
  }

  const store = filtered[0].store;
  const statusBreakdownMap = new Map();
  for (const order of filtered) {
    statusBreakdownMap.set(order.currentStatus, (statusBreakdownMap.get(order.currentStatus) || 0) + 1);
  }

  const statusBreakdown = [...statusBreakdownMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

  return {
    store,
    summary: summaryFromOrders(filtered),
    statusBreakdown,
    orders: [...filtered].sort((a, b) => {
      const aTime = Date.parse(a.timeline.lastWebhookAt || 0);
      const bTime = Date.parse(b.timeline.lastWebhookAt || 0);
      return bTime - aTime;
    })
  };
}

module.exports = {
  buildDashboardData,
  withDateRange,
  buildTrendSeries,
  buildStoreDetails
};
