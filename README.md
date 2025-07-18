# Cloudflare License Server

This is a simple license server built with Cloudflare Workers and KV.

## Setup

1. Install dependencies: `npm install`

2. Create KV namespace: `npx wrangler kv:namespace create LICENSE_KV`
   - Update wrangler.toml with the returned IDs.

3. Set admin secret: `npx wrangler secret put ADMIN_KEY`
   - Enter your secret admin key.

4. Deploy: `npx wrangler deploy`

## Usage

- Create license: POST /create with header X-Admin-Key: your_secret
  - Returns { "license_key": "uuid" }

- Validate: POST /validate with JSON body { "key": "uuid", "mac": "mac-address" }
  - Returns 200 if valid (binds if unbound), 403 if bound to different mac, 404 if invalid.

Note: This uses only Cloudflare Workers and KV; no other services. 