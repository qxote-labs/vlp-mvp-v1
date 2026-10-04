/* tools/mock-server.js — API-03 목 서버. openapi.yaml 계약을 HTTP로 노출한다(목 어댑터 엔진을 그대로 감싼다).
 *   node tools/mock-server.js [--port 8100] [--no-seed]
 * 인증: Authorization: Bearer <토큰>. 토큰은 tools/mock-fixtures.js (GET /__mock/fixtures 로도 확인).
 * 오류 강제: 요청에 X-Mock-Force-Error: 401|404|409|422|429 헤더를 보내면 해당 오류를 그대로 돌려준다(화면의 오류 표시 확인용).
 * 목 전용 관리 경로(/__mock/*)는 실제 API에 없다: reset, seed, advance, observe, time, events, notifications, fixtures.
 */
const http = require('http');
const path = require('path');
const root = path.join(__dirname, '..');
['vlp-config.js', 'vlp-ops.js', 'status-map.js', 'adapters/mock.js'].forEach(f => require(path.join(root, f)));
const VLP = globalThis.VLP;
const { IDENTITIES, byToken } = require('./mock-fixtures');

const FORCED = {
  401: { code: 'VLP-AUTH-401', message: '로그인이 필요합니다' }, 404: { code: 'VLP-RES-404', message: '찾을 수 없습니다' },
  409: { code: 'VLP-STATE-409', message: '현재 상태에서 할 수 없습니다' }, 422: { code: 'VLP-VAL-422', message: '입력을 확인해 주세요' },
  429: { code: 'VLP-RATE-429', message: '시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요' },
};

// operation 표 -> 경로 정규식
const routes = VLP.ops.list.map(op => {
  const re = new RegExp('^' + op.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '$');
  return { op, re };
});
function matchRoute(method, pathname) {
  for (const r of routes) { if (r.op.method !== method) continue; const m = r.re.exec(pathname); if (m) return { op: r.op, params: Object.assign({}, m.groups) }; }
  return null;
}

function start(opts) {
  opts = opts || {};
  const storage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  const engine = VLP.adapters.mock.createEngine({ storage, config: VLP.config });
  const admin = engine.admin;
  const fixtures = {};

  async function call(who, op, o) { // 시드용: 서버 안에서 직접 호출
    const r = await engine.handle({ op, identity: IDENTITIES[who], pathParams: o.path || {}, query: o.query || {}, body: o.body, idempotencyKey: 'seed-' + Math.random().toString(36).slice(2) + '-0123456789' });
    if (r.status >= 300) throw new Error('seed ' + op + ' -> ' + r.status + ' ' + JSON.stringify(r.body));
    return r.body;
  }
  async function seed() {
    admin.reset();
    const mk = (mfr, phone, extra) => call('cust', 'contracts.create', { body: Object.assign({ manufacturerContractNo: mfr, vehicleModel: '아이오닉 6', carmasterPhone: phone, trim: '프레스티지', color: '화이트' }, extra || {}) });
    const pending = await mk('SEED-PENDING-1', IDENTITIES.km.phone);              // 승인 대기: 카마스터가 조회하면 masked=true
    const unclaimed = await mk('SEED-CLAIM-1', IDENTITIES.kmNew.phone);            // 미가입 카마스터: claim 필요 (claimToken은 이 응답 1회뿐)
    const ap = await mk('SEED-DELIVERY-1', IDENTITIES.km.phone);
    await call('km', 'contracts.approve', { path: { id: ap.contractId }, body: { destinationType: 'AFFILIATED_SHOP' } });
    await call('cust', 'contracts.confirm', { path: { id: ap.contractId } });
    await call('cust', 'contracts.releaseRequest', { path: { id: ap.contractId }, body: { deliverySiteId: admin.ids.site1, receiptMode: 'REMOTE_PROXY', proxyConsent: true } });
    const delivery = await call('km', 'contracts.releaseOrder', { path: { id: ap.contractId }, body: {} });
    admin.advance(delivery.deliveryId, 'SHIPPED'); admin.advance(delivery.deliveryId, 'IN_TRANSIT'); admin.observe(delivery.deliveryId, '경북 구미');
    Object.assign(fixtures, {
      pendingContractId: pending.contractId, unclaimedContractId: unclaimed.contractId, unclaimedClaimTokenOnce: unclaimed.claimToken,
      deliveryContractId: ap.contractId, deliveryId: delivery.deliveryId,
      note: 'unclaimedClaimTokenOnce는 시드 직후 이 응답에서만 보이는 개발용 값이다(실제 API 규칙: 등록 응답 1회).',
    });
  }

  const send = (res, status, body, extra) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Mock-Force-Error, X-VLP-Scope', 'Access-Control-Expose-Headers': 'X-VLP-From-Cache, X-VLP-Cached-At, Idempotent-Replayed', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, extra || {}));
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if (s.length > 2e6) reject(new Error('too large')); }); req.on('end', () => resolve(s)); req.on('error', reject); });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, 204);
      const raw = await readBody(req);
      let body;
      if (raw) { try { body = JSON.parse(raw); } catch (e) { return send(res, 422, { code: 'VLP-VAL-422', message: 'JSON 형식이 올바르지 않습니다' }); } }

      // ---- 목 전용 관리 경로 ----
      if (url.pathname.startsWith('/__mock/')) {
        const p = url.pathname.slice('/__mock/'.length);
        if (p === 'fixtures' && req.method === 'GET') return send(res, 200, { identities: Object.values(IDENTITIES).map(i => ({ role: i.role, name: i.name, phone: i.phone, token: i.token })), registry: admin.state().registry, seeded: fixtures, forceErrors: Object.keys(FORCED) });
        if (p === 'reset' && req.method === 'POST') { admin.reset(); Object.keys(fixtures).forEach(k => delete fixtures[k]); return send(res, 200, { ok: true }); }
        if (p === 'seed' && req.method === 'POST') { await seed(); return send(res, 200, fixtures); }
        if (p === 'advance' && req.method === 'POST') { return send(res, 200, admin.advance(body.deliveryId, body.to)); }
        if (p === 'observe' && req.method === 'POST') { admin.observe(body.deliveryId, body.regionText); return send(res, 200, { ok: true }); }
        if (p === 'time' && req.method === 'POST') { admin.advanceTime(Number(body.advanceMs) || 0); admin.sweepNow(); return send(res, 200, { ok: true }); }
        if (p === 'events' && req.method === 'GET') return send(res, 200, admin.events());
        if (p === 'notifications' && req.method === 'GET') return send(res, 200, admin.notifications());
        return send(res, 404, { code: 'VLP-RES-404', message: '찾을 수 없습니다' });
      }

      // ---- 오류 강제 ----
      const forced = req.headers['x-mock-force-error'];
      if (forced) { const f = FORCED[forced]; if (!f) return send(res, 422, { code: 'VLP-VAL-422', message: 'X-Mock-Force-Error는 ' + Object.keys(FORCED).join('|') + ' 중 하나입니다' }); return send(res, Number(forced), f); }

      // ---- 실제 API ----
      const m = matchRoute(req.method, url.pathname);
      if (!m) return send(res, 404, { code: 'VLP-RES-404', message: '찾을 수 없습니다' });
      const auth = req.headers['authorization'] || '';
      const idn = /^Bearer (.+)$/.exec(auth) ? (byToken[RegExp.$1] || { token: RegExp.$1 }) : null; // 고정 데모 토큰이 아니면 claim/login이 발급한 세션 토큰으로 보고 엔진이 신원을 복원한다   // 서버가 토큰에서 신원·역할을 판정한다. 헤더·본문의 role은 보지 않는다.
      const query = {}; url.searchParams.forEach((v, k) => { query[k] = v; });
      const out = await engine.handle({ op: m.op.name, method: m.op.method, path: url.pathname, pathParams: m.params, query, body, idempotencyKey: req.headers['idempotency-key'] || null, identity: idn });
      return send(res, out.status, out.body, out.replayed ? { 'Idempotent-Replayed': 'true' } : undefined);
    } catch (e) {
      return send(res, 500, { code: 'MOCK-500', message: String(e && e.message || e) });
    }
  });
  return new Promise(resolve => {
    server.listen(opts.port == null ? 8100 : opts.port, '127.0.0.1', async () => {
      if (opts.seed !== false) await seed();
      resolve({ server, port: server.address().port, admin, fixtures, close: () => new Promise(r => server.close(r)) });
    });
  });
}

module.exports = { start };
if (require.main === module) {
  const args = process.argv.slice(2);
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8100;
  start({ port, seed: !args.includes('--no-seed') }).then(s => {
    console.log('VLP mock server http://127.0.0.1:' + s.port + '  (토큰/픽스처: GET /__mock/fixtures)');
    console.log('seed:', JSON.stringify(s.fixtures));
  });
}
