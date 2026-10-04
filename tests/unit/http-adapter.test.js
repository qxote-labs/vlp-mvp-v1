// "어댑터 교체 한 줄로 목 서버 호출 전환" 확인 (PWA-02 완료 검증) + API-03 목 서버 계약 확인.
// 같은 시나리오를 (1) 인프로세스 mock 어댑터, (2) HTTP 어댑터 -> 목 서버로 돌려 결과가 같아야 한다.
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, checkAgainstOpenapi, IDS } = require('./_helpers');
const { start } = require('../../tools/mock-server');

async function scenario(f, as, admin) {
  const out = {};
  const c = await as('cust').contracts.create({ manufacturerContractNo: 'H-' + Math.random().toString(36).slice(2, 8), vehicleModel: '아이오닉 6', carmasterPhone: IDS.km.phone });
  out.created = Object.keys(c).sort();
  const masked = await as('km').contracts.get(c.contractId);
  out.maskedKeys = Object.keys(masked).sort(); out.masked = masked.masked;
  await as('km').contracts.approve(c.contractId, { destinationType: 'AFFILIATED_SHOP' });
  await as('cust').contracts.confirm(c.contractId);
  await as('cust').contracts.releaseRequest(c.contractId, { deliverySiteId: '33333333-3333-4333-8333-111111111111', receiptMode: 'REMOTE_PROXY', proxyConsent: true });
  const d = await as('km').contracts.releaseOrder(c.contractId, {});
  out.state0 = [d.storageState, d.displayState];
  await admin.advance(d.deliveryId, 'SHIPPED'); await admin.advance(d.deliveryId, 'IN_TRANSIT');
  out.state1 = (await as('cust').deliveries.get(d.deliveryId)).displayState;
  const errs = {};
  for (const [k, p] of Object.entries({ other: as('cust2').contracts.get(c.contractId), missingKey: f.call('contracts.confirm', { path: { id: c.contractId } }, { idempotencyKey: 'x' }) })) {
    try { await p; errs[k] = 'ok'; } catch (e) { errs[k] = e.status + ':' + e.code; }
  }
  out.errs = errs;
  return out;
}

test('같은 시나리오가 mock 어댑터와 http 어댑터(목 서버)에서 같은 결과', async () => {
  // (1) 인프로세스
  const { setup } = require('./_helpers');
  const t = setup();
  const direct = await scenario(t.f, t.as, { advance: async (id, to) => t.admin.advance(id, to) });

  // (2) HTTP — 어댑터 이름만 바꾼다
  const srv = await start({ port: 0, seed: false });
  try {
    VLP.config.reset(); VLP.config.set({ adapter: 'http', httpBaseUrl: 'http://127.0.0.1:' + srv.port });
    const f = VLP.createFacade();
    f.use(VLP.config.get('adapter'));                         // ← 전환은 이 설정 한 줄(adapter: 'mock' -> 'http')
    assert.equal(f.adapterName(), 'http');
    const as = (who) => { f.session.set(IDS[who]); return f; };
    const viaHttp = await scenario(f, as, { advance: async (id, to) => { const r = await fetch('http://127.0.0.1:' + srv.port + '/__mock/advance', { method: 'POST', body: JSON.stringify({ deliveryId: id, to }) }); assert.equal(r.status, 200); } });
    assert.deepEqual(viaHttp, direct);
    assert.equal(viaHttp.masked, true);
    assert.deepEqual(viaHttp.errs, { other: '404:VLP-RES-404', missingKey: '422:VLP-VAL-422' });
  } finally { await srv.close(); VLP.config.reset(); }
});

test('목 서버: 토큰이 곧 신원 — 헤더·본문의 role 값은 무시되고, 토큰이 없거나 모르면 401', async () => {
  const srv = await start({ port: 0, seed: true });
  const B = 'http://127.0.0.1:' + srv.port;
  try {
    const get = (p, tok, extra) => fetch(B + p, { headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, extra || {}) });
    assert.equal((await get('/lifecycle/contracts')).status, 401);
    assert.equal((await get('/lifecycle/contracts', 'forged-token')).status, 401);
    const id = srv.fixtures.pendingContractId;
    const r = await get('/lifecycle/contracts/' + id, 'mock-karmaster-1', { 'X-Role': 'customer' });         // 위조 헤더
    const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.masked, true); assert.ok(!('manufacturerContractNo' in j));
    assert.equal((await get('/lifecycle/contracts/00000000-0000-4000-8000-000000000000', 'mock-karmaster-1')).status, 404);
    assert.equal((await get('/lifecycle/contracts/' + id, 'mock-customer-2')).status, 404);
    assert.equal((await get('/lifecycle/contracts/' + id, 'mock-shop-1')).status, 404);
    // 오류 5종 강제
    for (const s of [401, 404, 409, 422, 429]) { const rr = await get('/lifecycle/contracts', 'mock-customer-1', { 'X-Mock-Force-Error': String(s) }); const b = await rr.json(); assert.equal(rr.status, s); assert.ok(b.code && b.message); assert.deepEqual(checkAgainstOpenapi('contracts.list', s, b), []); }
    // 시드된 조회번호는 서버 상태 어디에도 평문으로 없다
    const tok = srv.fixtures.unclaimedClaimTokenOnce; assert.match(tok, /^\d{8}$/);
    assert.ok(!JSON.stringify(srv.admin.state()).includes(tok)); assert.ok(!JSON.stringify(srv.admin.events()).includes(tok));
    assert.ok(!(await (await fetch(B + '/__mock/events')).text()).includes(tok));
    assert.ok(!(await (await fetch(B + '/__mock/notifications')).text()).includes(tok));
    // 잘못된 JSON
    const bad = await fetch(B + '/lifecycle/contracts', { method: 'POST', headers: { Authorization: 'Bearer mock-customer-1', 'Idempotency-Key': 'abcdefghijklmnop1234', 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 422);
    // 멱등 재전송 헤더
    const body = JSON.stringify({ manufacturerContractNo: 'IDEM-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
    const post = () => fetch(B + '/lifecycle/contracts', { method: 'POST', headers: { Authorization: 'Bearer mock-customer-1', 'Idempotency-Key': 'idem-http-0123456789', 'Content-Type': 'application/json' }, body });
    const r1 = await post(), r2 = await post();
    assert.equal(r1.status, 201); assert.equal(r2.status, 201); assert.equal(r2.headers.get('idempotent-replayed'), 'true');
    assert.equal((await r1.json()).contractId, (await r2.json()).contractId);
  } finally { await srv.close(); }
});
