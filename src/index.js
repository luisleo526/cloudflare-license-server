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

    if (request.method === 'POST' && url.pathname === '/purchase') {
      try {
        const body = await request.json();
        const { tx_hash, mac } = body;
        
        if (!tx_hash) {
          return new Response('Missing tx_hash in body', { status: 400 });
        }

        // Check if transaction was already used
        const existingTx = await env.LICENSE_KV.get(`tx:${tx_hash}`);
        if (existingTx) {
          return new Response('Transaction already used', { status: 409 });
        }

        // Fetch transaction details from TronGrid (free, no auth needed)
        const txResponse = await fetch(`https://api.trongrid.io/v1/transactions/${tx_hash}`);
        const txResult = await txResponse.json();
        
        if (!txResult.data || txResult.data.length === 0) {
          return new Response('Transaction not found', { status: 404 });
        }
        
        const tx = txResult.data[0];
        
        // Verify transaction is successful
        if (!tx.ret || tx.ret[0].contractRet !== 'SUCCESS') {
          return new Response('Transaction failed or pending', { status: 400 });
        }

        // Check if it's a smart contract call (USDT transfers are)
        const contract = tx.raw_data.contract[0];
        if (contract.type !== 'TriggerSmartContract') {
          return new Response('Not a USDT transfer', { status: 400 });
        }

        // USDT TRC20 contract address
        const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const contractAddress = contract.parameter.value.contract_address;
        
        if (contractAddress !== USDT_CONTRACT) {
          return new Response('Not a USDT transaction', { status: 400 });
        }

        // Decode transfer data
        const data = contract.parameter.value.data;
        // Method ID for transfer(address,uint256) is a9059cbb
        if (!data.startsWith('a9059cbb')) {
          return new Response('Not a transfer transaction', { status: 400 });
        }

        // Extract recipient address (remove method ID, get next 32 bytes)
        const recipientHex = data.substring(8, 72);
        // Remove padding (24 zeros) and add TRON prefix
        const recipientAddress = 'T' + Buffer.from('41' + recipientHex.substring(24), 'hex').toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // Verify recipient is your wallet
        if (recipientAddress !== env.TRON_WALLET_ADDRESS) {
          return new Response('Payment not sent to correct address', { status: 400 });
        }

        // Extract amount (next 32 bytes after address)
        const amountHex = data.substring(72, 136);
        const amountWei = BigInt('0x' + amountHex);
        const amountUSDT = Number(amountWei) / 1e6; // USDT has 6 decimals

        // Determine license duration based on amount
        let days = 0;
        if (amountUSDT >= 50) days = 365;      // $50+ = 1 year
        else if (amountUSDT >= 20) days = 180; // $20+ = 6 months  
        else if (amountUSDT >= 10) days = 90;  // $10+ = 3 months
        else if (amountUSDT >= 5) days = 30;   // $5+ = 1 month
        else {
          return new Response('Payment amount too low (minimum $5)', { status: 400 });
        }

        // Create license
        const now = new Date();
        now.setDate(now.getDate() + days);
        const expiration = now.toISOString().split('T')[0];

        const licenseKey = crypto.randomUUID();
        await env.LICENSE_KV.put(licenseKey, JSON.stringify({ 
          bound_mac: mac || null, // Optional MAC binding at purchase
          expiration,
          tx_hash,
          amount_usdt: amountUSDT,
          purchase_date: new Date().toISOString()
        }));
        
        // Mark transaction as used
        await env.LICENSE_KV.put(`tx:${tx_hash}`, JSON.stringify({
          license_key: licenseKey,
          processed_at: new Date().toISOString()
        }));

        return new Response(JSON.stringify({ 
          license_key: licenseKey, 
          expires: expiration,
          amount_paid: amountUSDT,
          days_granted: days
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response('Error processing payment: ' + error.message, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/extend') {
      try {
        const body = await request.json();
        const { tx_hash, license_key } = body;
        
        if (!tx_hash || !license_key) {
          return new Response('Missing tx_hash or license_key in body', { status: 400 });
        }

        // Check if license exists
        const existingLicense = await env.LICENSE_KV.get(license_key);
        if (!existingLicense) {
          return new Response('License not found', { status: 404 });
        }

        const licenseData = JSON.parse(existingLicense);

        // Check if transaction was already used
        const existingTx = await env.LICENSE_KV.get(`tx:${tx_hash}`);
        if (existingTx) {
          return new Response('Transaction already used', { status: 409 });
        }

        // Fetch transaction details from TronGrid (free, no auth needed)
        const txResponse = await fetch(`https://api.trongrid.io/v1/transactions/${tx_hash}`);
        const txResult = await txResponse.json();
        
        if (!txResult.data || txResult.data.length === 0) {
          return new Response('Transaction not found', { status: 404 });
        }
        
        const tx = txResult.data[0];
        
        // Verify transaction is successful
        if (!tx.ret || tx.ret[0].contractRet !== 'SUCCESS') {
          return new Response('Transaction failed or pending', { status: 400 });
        }

        // Check if it's a smart contract call (USDT transfers are)
        const contract = tx.raw_data.contract[0];
        if (contract.type !== 'TriggerSmartContract') {
          return new Response('Not a USDT transfer', { status: 400 });
        }

        // USDT TRC20 contract address
        const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const contractAddress = contract.parameter.value.contract_address;
        
        if (contractAddress !== USDT_CONTRACT) {
          return new Response('Not a USDT transaction', { status: 400 });
        }

        // Decode transfer data
        const data = contract.parameter.value.data;
        // Method ID for transfer(address,uint256) is a9059cbb
        if (!data.startsWith('a9059cbb')) {
          return new Response('Not a transfer transaction', { status: 400 });
        }

        // Extract recipient address (remove method ID, get next 32 bytes)
        const recipientHex = data.substring(8, 72);
        // Remove padding (24 zeros) and add TRON prefix
        const recipientAddress = 'T' + Buffer.from('41' + recipientHex.substring(24), 'hex').toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // Verify recipient is your wallet
        if (recipientAddress !== env.TRON_WALLET_ADDRESS) {
          return new Response('Payment not sent to correct address', { status: 400 });
        }

        // Extract amount (next 32 bytes after address)
        const amountHex = data.substring(72, 136);
        const amountWei = BigInt('0x' + amountHex);
        const amountUSDT = Number(amountWei) / 1e6; // USDT has 6 decimals

        // Determine extension duration based on amount (same price table)
        let days = 0;
        if (amountUSDT >= 50) days = 365;      // $50+ = 1 year
        else if (amountUSDT >= 20) days = 180; // $20+ = 6 months  
        else if (amountUSDT >= 10) days = 90;  // $10+ = 3 months
        else if (amountUSDT >= 5) days = 30;   // $5+ = 1 month
        else {
          return new Response('Payment amount too low (minimum $5)', { status: 400 });
        }

        // Calculate new expiration
        const currentExpiration = new Date(licenseData.expiration);
        const now = new Date();
        
        // If license already expired, extend from today; otherwise extend from current expiration
        const baseDate = currentExpiration > now ? currentExpiration : now;
        baseDate.setDate(baseDate.getDate() + days);
        const newExpiration = baseDate.toISOString().split('T')[0];

        // Update license
        licenseData.expiration = newExpiration;
        licenseData.last_extended = new Date().toISOString();
        licenseData.extension_tx_hash = tx_hash;
        licenseData.extension_amount = amountUSDT;
        
        await env.LICENSE_KV.put(license_key, JSON.stringify(licenseData));
        
        // Mark transaction as used
        await env.LICENSE_KV.put(`tx:${tx_hash}`, JSON.stringify({
          license_key: license_key,
          action: 'extension',
          processed_at: new Date().toISOString()
        }));

        return new Response(JSON.stringify({ 
          license_key: license_key,
          new_expiration: newExpiration,
          days_added: days,
          amount_paid: amountUSDT,
          extended_from: currentExpiration > now ? 'current_expiration' : 'today'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response('Error processing extension: ' + error.message, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/check') {
      try {
        // Get license key from query parameter
        const licenseKey = url.searchParams.get('key');
        
        if (!licenseKey) {
          return new Response('Missing key parameter', { status: 400 });
        }

        // Fetch license data
        const licenseData = await env.LICENSE_KV.get(licenseKey);
        
        if (!licenseData) {
          return new Response('License not found', { status: 404 });
        }

        const data = JSON.parse(licenseData);
        const now = new Date();
        const expirationDate = new Date(data.expiration);
        const isExpired = expirationDate < now;
        const daysRemaining = isExpired ? 0 : Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));

        return new Response(JSON.stringify({
          license_key: licenseKey,
          expiration: data.expiration,
          is_expired: isExpired,
          days_remaining: daysRemaining,
          bound_mac: data.bound_mac || null,
          is_test: data.is_test || false,
          purchase_date: data.purchase_date || null,
          last_extended: data.last_extended || null
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response('Error checking license: ' + error.message, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}; 