// PWA-04 검증: manifest 유효, 설치 가능 판정(CDP), 서비스 워커 활성, 오프라인에서 마지막 화면 렌더,
// 조회 응답 "마지막 상태" 캐시(사용자별 분리, 명령은 캐시 안 함, 로그아웃 시 비움).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { start } = require('../tools/mock-server');
const BASE = 'http://localhost:8000';

(async () => {
  const srv = await start({ port: 0, seed: true });
  const API = 'http://127.0.0.1:' + srv.port;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  try {
    // 1) manifest 3종 + 아이콘
    for (const [html, unit] of [['customer', 'customer'], ['karmaster', 'partner'], ['shop', 'partner'], ['admin', 'admin']]) {
      await page.goto(`${BASE}/app.html?login=1`);
      const htmlText = await (await page.request.get(`${BASE}/${html}.html`)).text(); // 역할 화면은 로그인 전에 통합 로그인으로 가므로 HTML 머리만 본다
      const href = (htmlText.match(/<link rel="manifest" href="([^"]+)"/) || [])[1];
      assert.equal(href, `manifest-${unit}.webmanifest`, html);
      const m = await (await page.request.get(`${BASE}/${href}`)).json();
      assert.ok(m.name && m.short_name && m.start_url && m.scope, html + ' 기본 필드');
      assert.equal(m.display, 'standalone');
      const sizes = m.icons.map(i => i.sizes + ':' + i.purpose);
      assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), html + ' 아이콘 ' + sizes);
      for (const ic of m.icons) { const r = await page.request.get(`${BASE}/${ic.src}`); assert.equal(r.status(), 200); assert.match(r.headers()['content-type'], /image\/png/); }
      assert.ok(/<meta name="viewport"/.test(htmlText));
    }
    console.log('1) manifest 3종(고객·파트너·관리자)과 아이콘 유효, viewport 메타 있음');

    // 2) 서비스 워커 활성 + 설치 가능 판정
    await page.goto(`${BASE}/app.html?login=1`);
    await page.evaluate(() => { sessionStorage.clear(); sessionStorage.setItem('v6_customer_logged', '1'); sessionStorage.setItem('v6_customer_name', '김민준'); sessionStorage.setItem('v6_customer_phone', '010-7777-1000'); sessionStorage.setItem('v6_view', 'history'); sessionStorage.setItem('v6_shop_id', 'a'); sessionStorage.setItem('v6_km_id', 'k1'); sessionStorage.setItem('v6_admin_id', 'admin_ulsan'); });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), '서비스 워커가 화면을 제어해야 함');
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    console.log('2) 서비스 워커 활성, 설치 가능 오류:', JSON.stringify(installabilityErrors));
    assert.deepEqual(installabilityErrors, []);
    const cached = await page.evaluate(async () => (await (await caches.open('vlp-shell-v97')).keys()).length);
    assert.ok(cached >= 20, '앱 셸 캐시 항목 ' + cached);

    // 3) 오프라인에서 마지막 화면 렌더 (고객·카마스터·시공사·관리자)
    await context.setOffline(true);
    let banner = '';
    for (const html of ['customer', 'karmaster', 'shop', 'admin']) {
      await page.goto(`${BASE}/${html}.html`);
      await page.waitForFunction(() => document.body.innerText.length > 30, null, { timeout: 8000 }).catch(() => {});
      const ok = await page.evaluate(() => !!document.querySelector('.navbar, #vlp-rolebar') && document.body.innerText.length > 30);
      assert.ok(ok, html + ' 오프라인 렌더 ' + page.url() + ' ' + (await page.evaluate(() => document.body.innerText.slice(0, 80))));
      assert.ok(await page.isVisible('#vlp-rolebar .rb-status'), html + ' 오프라인 표시');
      if (html === 'customer') banner = await page.innerText('#vlp-rolebar .rb-status');
    }
    assert.match(banner, /오프라인/);
    console.log('3) 오프라인에서 4개 화면이 렌더되고 "오프라인" 배너가 뜸:', banner);
    await context.setOffline(false);

    // 4) 조회 응답 "마지막 상태" 캐시
    await page.goto(`${BASE}/customer.html`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const call = (who, base) => page.evaluate(async ({ who, base }) => {
      const ID = { cust: { userId: 'cust-1', role: 'customer', phone: '010-1111-0001', name: '홍길동', token: 'mock-customer-1' }, cust2: { userId: 'cust-2', role: 'customer', phone: '010-1111-0002', name: '이영희', token: 'mock-customer-2' } };
      const f = VLP.createFacade(); f.use('http', { baseUrl: base }); f.session.set(ID[who]);
      let fromCache = null; f.onResponse((q, r) => { fromCache = r.fromCache ? r.cachedAt : false; });
      try { const body = await f.contracts.list(); return { ok: true, n: body.items.length, fromCache }; } catch (e) { return { ok: false, status: e.status, code: e.code, fromCache }; }
    }, { who, base });
    const online = await call('cust', API);
    assert.deepEqual([online.ok, online.n >= 3, online.fromCache], [true, true, false]);
    await context.setOffline(true);
    const off = await call('cust', API);
    assert.equal(off.ok, true); assert.equal(off.n, online.n); assert.ok(off.fromCache, '캐시 표식 + 갱신 시각');
    console.log('4a) 오프라인 조회: 마지막 상태 반환, 갱신 시각', off.fromCache);
    const other = await call('cust2', API);                      // 다른 사용자의 캐시는 없다
    assert.deepEqual([other.ok, other.status, other.code], [false, 503, 'VLP-OFFLINE']);
    console.log('4b) 다른 사용자는 캐시를 받지 못함:', other.code);
    await context.setOffline(false);
    // 명령은 캐시되지 않는다
    const cachedPosts = await page.evaluate(async () => { const keys = await (await caches.open('vlp-api-v1')).keys(); return keys.filter(k => k.method !== 'GET').length; });
    assert.equal(cachedPosts, 0);
    // 로그아웃 시 비움
    await page.evaluate(() => VLP.pwa.clearApiCache()); await page.waitForTimeout(300);
    await context.setOffline(true);
    const cleared = await call('cust', API);
    assert.deepEqual([cleared.ok, cleared.code], [false, 'VLP-OFFLINE']);
    await context.setOffline(false);
    console.log('4c) 캐시 비우기 후에는 오프라인 조회 불가(로그아웃 처리)');
    assert.deepEqual(errors, []);
    console.log('\n--- PWA 셸 시나리오 통과 ---');
  } catch (e) { console.error('실패:', e); process.exitCode = 1; }
  finally { await browser.close(); await srv.close(); }
})();
