const https = require('https');
const { UA_INSTAGRAM_ANDROID } = require('./ua');

// Hard caps so a bad upstream can't hang the request or blow up memory.
const HTTP_TIMEOUT_MS = 15000;
const HTTP_MAX_BODY_BYTES = 32 * 1024 * 1024;
const HTTP_MAX_HOPS = 5;

function httpsGet(url, headers = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > HTTP_MAX_HOPS) return reject(new Error('too many redirects'));
    const options = {
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Accept-Encoding': 'identity', ...headers },
      rejectUnauthorized: false,
    };
    const req = https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsGet(res.headers.location, headers, hops + 1).then(resolve).catch(reject);
      }
      let data = '';
      let total = 0;
      let aborted = false;
      res.on('data', chunk => {
        if (aborted) return;
        total += chunk.length;
        if (total > HTTP_MAX_BODY_BYTES) {
          aborted = true;
          res.destroy();
          reject(new Error('response too large'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => { if (!aborted) resolve({ status: res.statusCode, body: data, headers: res.headers, cookies: res.headers['set-cookie'] || [] }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => { req.destroy(new Error('request timeout')); });
  });
}

function httpsPost(url, body, headers = {}, _collectedCookies = []) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = typeof body === 'string' ? body : JSON.stringify(body);
    const isJson = typeof body !== 'string';
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'User-Agent': UA_INSTAGRAM_ANDROID,
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept-Encoding': 'identity',
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      const newCookies = [..._collectedCookies, ...(res.headers['set-cookie'] || [])];
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = `https://${parsed.hostname}${loc}`;
        res.resume();
        const cookieStr = newCookies.map(c => c.split(';')[0]).join('; ');
        return httpsGet(loc, { ...headers, 'Cookie': cookieStr })
          .then(r => resolve({ ...r, cookies: [...newCookies, ...r.cookies] }))
          .catch(reject);
      }
      let data = '';
      let total = 0;
      let aborted = false;
      res.on('data', chunk => {
        if (aborted) return;
        total += chunk.length;
        if (total > HTTP_MAX_BODY_BYTES) {
          aborted = true;
          res.destroy();
          reject(new Error('response too large'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => { if (!aborted) resolve({ status: res.statusCode, body: data, headers: res.headers, cookies: newCookies }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => { req.destroy(new Error('request timeout')); });
    req.write(postData);
    req.end();
  });
}

function httpHead(url, headers, hops = 0) {
  if (hops > 5) return Promise.resolve({ url, size: 0, contentType: '' });
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      host: u.host,
      path: u.pathname + u.search,
      method: 'HEAD',
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
                   ? res.headers.location
                   : `https://${u.host}${res.headers.location}`;
        httpHead(next, headers, hops + 1).then(resolve);
        return;
      }
      resolve({
        url,
        size: Number(res.headers['content-length']) || 0,
        contentType: (res.headers['content-type'] || '').toLowerCase(),
      });
    });
    req.on('error', () => resolve({ url, size: 0, contentType: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ url, size: 0, contentType: '' }); });
    req.end();
  });
}

module.exports = { httpsGet, httpsPost, httpHead };
