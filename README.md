# Shipday Webhook Event Tracker (Node.js)

This service exposes a secured webhook endpoint for Shipday order-status updates and tracks all incoming events.
Each received event is also saved per order in `data/orders/<orderNumber>_<orderId>.json` (fallback: `<orderId>.json`).

## Endpoints

- `POST /webhooks/shipday/order-status-update`
  - Token required via one of:
    - Header: `x-webhook-token: <token>`
    - Header: `Authorization: Bearer <token>`
    - Query: `?token=<token>`
  - Accepts JSON payload and tracks any status value.

- `GET /webhooks/shipday/events`
  - Token required.
  - Returns total events, count by status, and recent events.

- `GET /health`
  - No auth.
- `GET /dashboard`
  - Read-only web UI for orders by store (`pickup_details`) with delivery timing analytics.
- `GET /api/dashboard/summary`
  - Returns full dashboard dataset (`summary`, `stores`, `orders`).
  - Optional query params: `from=YYYY-MM-DD`, `to=YYYY-MM-DD`.
- `GET /api/dashboard/stores`
  - Returns canonical store list with stable `storeId`.
  - Optional query params: `from=YYYY-MM-DD`, `to=YYYY-MM-DD`.
- `GET /api/dashboard/trends`
  - Returns bucketed trend points.
  - Query params:
    - `granularity=daily|hourly`
    - `storeId=<canonical-store-id>` optional
    - `from=YYYY-MM-DD`, `to=YYYY-MM-DD` optional
- `GET /api/dashboard/store-details`
  - Returns summary and order list for one store.
  - Query params:
    - `storeId=<canonical-store-id>` required
    - `from=YYYY-MM-DD`, `to=YYYY-MM-DD` optional
- `GET /api/dashboard/integrity`
  - Returns consistency checks between NDJSON total events and aggregated per-order event counts.

All dashboard APIs clamp date filtering to the latest `MAX_FILTER_RANGE_DAYS` (default 62 days).

## Quick Start

1. Copy `.env.example` to `.env` and set values.
2. Start server:

```bash
npm start
```

3. Configure Shipday webhook URL to point to:

```text
https://<your-domain>/webhooks/shipday/order-status-update?token=<SHIPDAY_WEBHOOK_TOKEN>
```

## Environment Variables

- `PORT` default `3000`
- `SHIPDAY_WEBHOOK_TOKEN` required shared secret token
- `TRACKER_RECENT_LIMIT` default `100`
- `TRACKER_EVENT_STORE_FILE` default `data/shipday-events.ndjson`
- `TRACKER_ORDER_EVENTS_DIR` default `data/orders`
- `PROCESS_LOCK_FILE` default `data/server.lock` (single-process lock)
- `DASHBOARD_CACHE_TTL_MS` default `5000` (dashboard dataset cache TTL)
- `MAX_FILTER_RANGE_DAYS` default `62` (latest-range clamp for dashboard APIs)
- `REBUILD_ORDERS_ON_START` default `true` (rebuild `data/orders` from NDJSON at startup)

## Sample test request

```bash
curl -X POST "http://localhost:3000/webhooks/shipday/order-status-update?token=change-me-to-a-random-long-token" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"PICKED_UP","orderId":"A-1001"}'
```

Then inspect tracker:

```bash
curl "http://localhost:3000/webhooks/shipday/events?token=change-me-to-a-random-long-token"
```
