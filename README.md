# Cloudflare License Server

This is a simple license server built with Cloudflare Workers and KV.

## Setup

1. Install dependencies: `npm install`

2. Create KV namespace: `npx wrangler kv:namespace create LICENSE_KV`
   - Update wrangler.toml with the returned IDs.

3. Set admin secret: `npx wrangler secret put ADMIN_KEY`
   - Enter your secret admin key.

   Optional: Set IP whitelist (comma-separated IPs) for /create: `npx wrangler secret put IP_WHITELIST`
   - e.g., Enter: "1.2.3.4,5.6.7.8"
   - If set, only these IPs can access /create (in addition to admin key).

   Set your TRON wallet address for payments: `npx wrangler secret put TRON_WALLET_ADDRESS`
   - Enter your TRC20 wallet address (e.g., "TYourWalletAddress...")

4. Deploy: `npx wrangler deploy`

## Usage

- Create license: POST /create with header X-Admin-Key: your_secret
  Optional JSON body: { "expiration": "YYYY-MM-DD" } (defaults to 14 days from creation if omitted)
  - Returns { "license_key": "uuid" }

- Validate: POST /validate with JSON body { "key": "uuid", "mac": "mac-address" }
  - Returns 200 if valid (binds if unbound), 403 if bound to different mac or invalid for device, 410 if expired, 404 if not found.

- Get test license: POST /test with JSON body { "mac": "mac-address" }
  - Returns { "license_key": "uuid", "expires": "YYYY-MM-DD" } with a 7-day test license
  - Returns 409 if MAC already has a license bound to it

- Purchase license with USDT: POST /purchase with JSON body { "tx_hash": "transaction_hash", "mac": "mac-address" }
  - Verifies USDT TRC20 payment to your wallet address
  - Returns { "license_key": "uuid", "expires": "YYYY-MM-DD", "amount_paid": 10.5, "days_granted": 90 }
  - Pricing: $5+ = 30 days, $10+ = 90 days, $20+ = 180 days, $50+ = 365 days
  - Returns 409 if transaction already used, 400 if invalid/insufficient payment
  - MAC address is optional; if not provided, license will be bound on first validation

- Extend license with USDT: POST /extend with JSON body { "tx_hash": "transaction_hash", "license_key": "uuid" }
  - Verifies USDT TRC20 payment and extends license expiration
  - Returns { "license_key": "uuid", "new_expiration": "YYYY-MM-DD", "days_added": 90, "amount_paid": 10.5, "extended_from": "current_expiration" }
  - Uses same pricing as purchase: $5+ = 30 days, $10+ = 90 days, $20+ = 180 days, $50+ = 365 days
  - If license is expired, extension starts from today; otherwise adds to current expiration
  - Returns 404 if license not found, 409 if transaction already used

- Check license expiration: GET /check?key=license_key_uuid
  - Returns license information including expiration date and status
  - Response: { "license_key": "uuid", "expiration": "YYYY-MM-DD", "is_expired": false, "days_remaining": 45, "bound_mac": "mac-address", "is_test": false, "purchase_date": "2024-01-01T10:00:00Z", "last_extended": null }
  - Returns 404 if license not found

Note: This uses only Cloudflare Workers and KV; no other services. 