/* adapters/http.js — 실 API 어댑터 (openapi.yaml 그대로 호출). PLAT-07(JEFLIX API 제공 후)에서 쓴다.
 * 지금은 tools/mock-server.js(API-03)를 상대로만 검증한다. 어댑터 교체는 VLP.config 'adapter' 한 줄.
 * 인증: Authorization: Bearer <토큰>. 토큰 발급 방식은 JEFLIX [미결]이라 identity.token을 그대로 싣는다.
 */
(function (g) {
  'use strict';
  g.VLP = g.VLP || {};
  const V = g.VLP;
  V.adapters = V.adapters || {};

  function qs(query) {
    const parts = Object.keys(query || {}).filter(k => query[k] != null && query[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
    return parts.length ? '?' + parts.join('&') : '';
  }
  V.adapters.http = {
    create(opts) {
      opts = opts || {};
      const base = (opts.baseUrl != null ? opts.baseUrl : (V.config && V.config.get('httpBaseUrl')) || '').replace(/\/$/, '');
      const doFetch = opts.fetch || g.fetch;
      return {
        name: 'http',
        async upload(uploadUrl, blob, contentType) { // 사전 서명 URL로 PUT (인증 헤더를 붙이지 않는다)
          let res;
          try { res = await doFetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream' }, body: blob }); }
          catch (e) { const ne = new Error('네트워크에 연결할 수 없습니다'); ne.network = true; throw ne; }
          if (!res.ok) { const ue = new Error('업로드 실패 HTTP ' + res.status); ue.httpStatus = res.status; throw ue; }
          return { ok: true };
        },
        mediaSrc(media) { return media ? (media.thumbUrl || media.url || null) : null; },
        async request(req) {
          if (!doFetch) throw new Error('http 어댑터: fetch를 쓸 수 없습니다');
          const headers = { Accept: 'application/json' };
          if (req.identity && req.identity.token) headers.Authorization = 'Bearer ' + req.identity.token; // 서버가 신원에서 역할을 판정한다
          if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
          if (req.method === 'GET' && req.identity && req.identity.userId) headers['X-VLP-Scope'] = encodeURIComponent(req.identity.userId); // 서비스 워커의 조회 캐시를 사용자별로 나눈다
          let body;
          if (req.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(req.body); }
          let res;
          try { res = await doFetch(base + req.path + qs(req.query), { method: req.method, headers, body }); }
          catch (e) { const ne = new Error('네트워크에 연결할 수 없습니다'); ne.network = true; throw ne; }
          let json = null;
          const text = await res.text();
          if (text) { try { json = JSON.parse(text); } catch (e) { json = { code: 'HTTP-' + res.status, message: text.slice(0, 200) }; } }
          const fromCache = res.headers && res.headers.get && res.headers.get('X-VLP-From-Cache') === '1';
          return { status: res.status, body: json, fromCache, cachedAt: fromCache ? res.headers.get('X-VLP-Cached-At') : null };
        },
      };
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.adapters.http;
})(typeof window !== 'undefined' ? window : globalThis);
