export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/create') {
      const clientIp = request.headers.get('CF-Connecting-IP');
      const whitelist = (env.IP_WHITELIST || '').split(',').map(ip => ip.trim());
      if (whitelist.length > 0 && !whitelist.includes(clientIp)) {
        return new Response('IP not authorized', { status: 403 });
      }

      const adminKey = request.headers.get('X-Admin-Key');
      if (adminKey !== env.ADMIN_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      let expiration = null;
      try {
        const body = await request.json();
        if (body.expiration) {
          // Validate YYYY-MM-DD format
          if (!/\d{4}-\d{2}-\d{2}/.test(body.expiration)) {
            return new Response('Invalid expiration format (use YYYY-MM-DD)', { status: 400 });
          }
          expiration = body.expiration;
        }
      } catch (error) {
        return new Response('Error parsing body: ' + error.message, { status: 400 });
      }

      if (!expiration) {
        const now = new Date();
        now.setDate(now.getDate() + 14);
        expiration = now.toISOString().split('T')[0]; // YYYY-MM-DD
      }

      const licenseKey = crypto.randomUUID();
      await env.LICENSE_KV.put(licenseKey, JSON.stringify({ bound_mac: null, expiration }));

      return new Response(JSON.stringify({ license_key: licenseKey }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method === 'POST' && url.pathname === '/test') {
      try {
        const body = await request.json();
        const { mac } = body;
        if (!mac) {
          return new Response('Missing mac in body', { status: 400 });
        }

        // Check if any license is already bound to this MAC
        const keys = await env.LICENSE_KV.list();
        for (const key of keys.keys) {
          const license = await env.LICENSE_KV.get(key.name);
          if (license) {
            const data = JSON.parse(license);
            if (data.bound_mac === mac) {
              return new Response('MAC address already has a license', { status: 409 });
            }
          }
        }

        // Create a 7-day test license
        const now = new Date();
        now.setDate(now.getDate() + 7);
        const expiration = now.toISOString().split('T')[0]; // YYYY-MM-DD

        const licenseKey = crypto.randomUUID();
        await env.LICENSE_KV.put(licenseKey, JSON.stringify({ bound_mac: mac, expiration, is_test: true }));

        return new Response(JSON.stringify({ license_key: licenseKey, expires: expiration }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response('Error processing request: ' + error.message, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/validate') {
      try {
        const body = await request.json();
        const { key, mac } = body;
        if (!key || !mac) {
          return new Response('Missing key or mac in body', { status: 400 });
        }

        const license = await env.LICENSE_KV.get(key);
        if (!license) {
          return new Response('Invalid license key', { status: 404 });
        }

        const data = JSON.parse(license);

        // Check expiration if set
        if (data.expiration) {
          const expDate = new Date(data.expiration);
          const now = new Date();
          if (now > expDate) {
            return new Response('License expired', { status: 410 });
          }
        }

        if (data.bound_mac === null) {
          data.bound_mac = mac;
          await env.LICENSE_KV.put(key, JSON.stringify(data));
          return new Response('License valid and bound to this device', { status: 200 });
        } else if (data.bound_mac === mac) {
          return new Response('License valid', { status: 200 });
        } else {
          return new Response('License invalid for this device', { status: 403 });
        }
      } catch (error) {
        return new Response('Error processing request: ' + error.message, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}; 