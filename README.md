# Shipday Webhook Event Tracker (Node.js)

This service exposes a secured webhook endpoint for Shipday order-status updates and tracks all incoming events.
Each received event is also saved per order in `data/orders/<orderId>.json`.

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
