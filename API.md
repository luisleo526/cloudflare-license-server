# License Server API Documentation

## Overview

This API provides license key management with support for creation, validation, purchasing with USDT (TRC20), and extension. All endpoints return JSON responses.

**Base URL**: `https://your-worker.workers.dev`

## Authentication

### Admin Authentication
Some endpoints require admin authentication via the `X-Admin-Key` header.

### IP Whitelist
The `/create` endpoint supports optional IP whitelisting. If configured, only whitelisted IPs can access this endpoint (in addition to admin key requirement).

---

## Endpoints

### 1. Create License Key (Admin Only)

Create a new license key with optional expiration date.

**Endpoint**: `POST /create`

**Headers**:
- `X-Admin-Key`: Your admin secret key (required)

**Request Body** (optional):
```json
{
  "expiration": "2024-12-31"  // Optional, defaults to 14 days from creation
}
```

**Response** (200 OK):
```json
{
  "license_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid or missing admin key
- `403 Forbidden`: IP not authorized (if IP whitelist is configured)
- `400 Bad Request`: Invalid expiration format

---

### 2. Validate License Key

Validate a license key and bind it to a MAC address if not already bound.

**Endpoint**: `POST /validate`

**Request Body**:
```json
{
  "key": "550e8400-e29b-41d4-a716-446655440000",
  "mac": "00:11:22:33:44:55"
}
```

**Response** (200 OK):
- If unbound: `"License valid and bound to this device"`
- If already bound to same MAC: `"License valid"`

**Error Responses**:
- `400 Bad Request`: Missing key or mac
- `403 Forbidden`: License bound to different device
- `404 Not Found`: Invalid license key
- `410 Gone`: License expired

---

### 3. Get Test License

Get a free 7-day test license for a MAC address (one per MAC).

**Endpoint**: `POST /test`

**Request Body**:
```json
{
  "mac": "00:11:22:33:44:55"
}
```

**Response** (200 OK):
```json
{
  "license_key": "550e8400-e29b-41d4-a716-446655440000",
  "expires": "2024-01-07"
}
```

**Error Responses**:
- `400 Bad Request`: Missing mac
- `409 Conflict`: MAC address already has a license

---

### 4. Purchase License with USDT

Create a license by verifying a USDT TRC20 payment.

**Endpoint**: `POST /purchase`

**Request Body**:
```json
{
  "tx_hash": "abc123def456...",  // TRON transaction hash
  "mac": "00:11:22:33:44:55"
}
```

**Response** (200 OK):
```json
{
  "license_key": "550e8400-e29b-41d4-a716-446655440000",
  "expires": "2024-04-01",
  "amount_paid": 10.5,
  "days_granted": 90
}
```

**Pricing**:
- $5+ = 30 days
- $10+ = 90 days
- $20+ = 180 days
- $50+ = 365 days

**Error Responses**:
- `400 Bad Request`: 
  - Missing parameters
  - Transaction failed/pending
  - Not a USDT transfer
  - Payment to wrong address
  - Amount too low (minimum $5)
- `404 Not Found`: Transaction not found
- `409 Conflict`: Transaction already used

---

### 5. Extend License with USDT

Extend an existing license by verifying a USDT TRC20 payment.

**Endpoint**: `POST /extend`

**Request Body**:
```json
{
  "tx_hash": "xyz789ghi012...",
  "license_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** (200 OK):
```json
{
  "license_key": "550e8400-e29b-41d4-a716-446655440000",
  "new_expiration": "2024-07-01",
  "days_added": 90,
  "amount_paid": 10.5,
  "extended_from": "current_expiration"  // or "today" if expired
}
```

**Notes**:
- Uses same pricing as purchase
- If license is expired, extension starts from today
- If license is active, adds to current expiration

**Error Responses**:
- Same as `/purchase` endpoint
- `404 Not Found`: License key not found

---

### 6. Check License Status

Get detailed information about a license key.

**Endpoint**: `GET /check`

**Query Parameters**:
- `key`: License key UUID (required)

**Example**: `GET /check?key=550e8400-e29b-41d4-a716-446655440000`

**Response** (200 OK):
```json
{
  "license_key": "550e8400-e29b-41d4-a716-446655440000",
  "expiration": "2024-04-01",
  "is_expired": false,
  "days_remaining": 45,
  "bound_mac": "00:11:22:33:44:55",
  "is_test": false,
  "purchase_date": "2024-01-01T10:00:00.000Z",
  "last_extended": null
}
```

**Error Responses**:
- `400 Bad Request`: Missing key parameter
- `404 Not Found`: License not found

---

## Common Response Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Access denied
- `404 Not Found`: Resource not found
- `409 Conflict`: Resource conflict (e.g., duplicate)
- `410 Gone`: Resource expired
- `500 Internal Server Error`: Server error

---

## USDT Payment Information

### Supported Network
- **TRON (TRC20)** only

### USDT Contract Address
- `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (Official USDT on TRON)

### Payment Process
1. Send USDT to the configured wallet address
2. Wait for transaction confirmation
3. Call `/purchase` or `/extend` with the transaction hash
4. Receive license key or extension confirmation

### Transaction Verification
- Transactions are verified via TronGrid public API
- Each transaction can only be used once
- Minimum payment: $5 USDT

---

## Rate Limiting

This API is deployed on Cloudflare Workers with the following limits:
- Free tier: 100,000 requests/day
- No explicit rate limiting implemented
- Consider implementing rate limiting for production use

---

## Examples

### Create a License (Admin)
```bash
curl -X POST https://your-worker.workers.dev/create \
  -H "X-Admin-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"expiration": "2024-12-31"}'
```

### Validate a License
```bash
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"key": "550e8400-e29b-41d4-a716-446655440000", "mac": "00:11:22:33:44:55"}'
```

### Purchase with USDT
```bash
curl -X POST https://your-worker.workers.dev/purchase \
  -H "Content-Type: application/json" \
  -d '{"tx_hash": "abc123...", "mac": "00:11:22:33:44:55"}'
```

### Check License Status
```bash
curl "https://your-worker.workers.dev/check?key=550e8400-e29b-41d4-a716-446655440000"
```

---

## Error Handling

All error responses include a plain text message describing the error. For example:

```
HTTP/1.1 400 Bad Request
Content-Type: text/plain

Missing key or mac in body
```

For production use, consider implementing structured error responses with error codes. 