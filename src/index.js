export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/create') {
      const adminKey = request.headers.get('X-Admin-Key');
      if (adminKey !== env.ADMIN_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      const licenseKey = crypto.randomUUID();
      await env.LICENSE_KV.put(licenseKey, JSON.stringify({ bound_mac: null }));

      return new Response(JSON.stringify({ license_key: licenseKey }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
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