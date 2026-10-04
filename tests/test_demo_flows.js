// 시연 데이터(신차인도 단계별 건·계정)와 계정별 확인 안내가 서로 맞는지 확인한다.
const { chromium } = require('playwright');
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const BASE = 'http://localhost:8000';
// 모델 → [고객, 카마스터 id, 기대 계약 상태 또는 배송 상태]
const EXPECT = {
  '투싼': ['김민준', 'k1', 'DELIVERED'], '스포티지': ['김민준', 'k1', 'DELIVERED'], '니로 EV': ['이서연', 'k2', 'IN_TRANSIT'],
  '싼타페': ['박지훈', 'k1', 'ARRIVED'], '스타리아': ['박지훈', 'k1', 'ARRIVED'], '셀토스': ['최수민', 'k3', 'SHIPPED'], '캐스퍼': ['최수민', 'k3', 'PLANNED'],
  '쏘나타': ['정하늘', 'k2', 'ARRIVED'], '코나': ['정하늘', 'k2', 'ARRIVED'], '팰리세이드': ['한도윤', 'k1', 'PLANNED'], '레이': ['한도윤', 'k1', 'APPROVED'],
  'EV6': ['오지안', 'k3', 'SHIPPED'], 'K5': ['오지안', 'k3', 'PENDING_APPROVAL'], 'K8': ['오지안', 'k3', 'REJECTED'], 'G80': ['윤서아', 'k2', 'DELIVERED'],
};
(async () => {
  // 안내 문서가 demo-guide.js 와 같은지
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'gen-demo-guide.js'), '--check'], { stdio: 'inherit' });
  const G = require('../demo-guide.js'); const guideText = JSON.stringify(G);
  Object.keys(EXPECT).forEach((m) => assert.ok(guideText.includes(m), '안내에 없는 건: ' + m));
  ['김민준', '이서연', '박지훈', '최수민', '정하늘', '한도윤', '오지안', '윤서아', '김도현', '박서연', '이준호', '울산 A샵'].forEach((n) => assert.ok(guideText.includes(n), '안내에 없는 계정: ' + n));

  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const d = await ctx.newPage(); d.on('pageerror', (e) => errs.push(e.message));
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load'); await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    assert.ok(await d.locator('#acct-list details').count() >= 15, 'demo.html 계정별 안내');
    // 1) 상태: 목 어댑터의 실제 값
    const st = await d.evaluate(() => { const s = VLP.api.adapter().admin.state(); return s.contracts.map((c) => { const dl = s.deliveries.find((x) => x.deliveryId === c.deliveryId); return [c.vehicleModel, c.status, dl && dl.storageState, c.carmasterPhone]; }); });
    const kmPhone = { k1: '01022223301', k2: '01022223302', k3: '01022223303' };
    Object.entries(EXPECT).forEach(([model, [who, km, want]]) => {
      const r = st.find((x) => x[0] === model); assert.ok(r, model + ' 계약 없음');
      assert.strictEqual(String(r[3]).replace(/\D/g, ''), kmPhone[km], model + ' 카마스터');
      assert.strictEqual(r[2] || r[1], want, model + ' 상태 ' + JSON.stringify(r));
    });
    // 2) 고객 화면
    const cust = async (name, phone, model) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.setViewportSize({ width: 430, height: 900 });
      await p.goto(BASE + '/customer.html?nosw=1&demoName=' + encodeURIComponent(name) + '&demoPhone=' + phone); await p.locator('.vlp-nav-btn[data-tab=cars]').click(); await p.locator('.vlp-case-row', { hasText: model }).click(); await p.waitForSelector('.vlp-case', { timeout: 10000 }); await p.waitForTimeout(500); return p; };
    const prim = (p) => p.$$eval('.vlp-primary-btn:not(.vlp-primary-hero)', (e) => [...new Set(e.map((x) => x.textContent.trim()))]);
    let p = await cust('김민준', '010-7777-1000', '투싼'); assert.deepStrictEqual(await prim(p), ['평가 남기기'], '투싼 평가 전'); await p.close();
    p = await cust('김민준', '010-7777-1000', '스포티지'); assert.deepStrictEqual(await prim(p), [], '스포티지 평가 완료'); await p.close();
    p = await cust('윤서아', '010-7777-8000', 'G80'); assert.deepStrictEqual(await prim(p), ['평가 남기기'], 'G80 일부만 평가'); await p.close();
    p = await cust('박지훈', '010-7777-3000', '스타리아'); if (!(await p.locator('.vlp-sheet').count())) await p.locator('.vlp-primary-btn:not(.vlp-primary-hero)').first().click();
    assert.ok(/불합격/.test(await p.locator('.vlp-sheet').innerText()), '스타리아 검수 불합격 표시'); await p.close();
    p = await cust('정하늘', '010-7777-5000', '코나'); if (!(await p.locator('.vlp-sheet').count())) await p.locator('.vlp-primary-btn:not(.vlp-primary-hero)').first().click();
    assert.ok(/열람 0\/6/.test(await p.locator('.vlp-sheet').innerText()), '코나 사진 6장'); await p.close();
    p = await cust('최수민', '010-7777-4000', '셀토스'); assert.ok(/지연/.test(await p.locator('.vlp-case').first().innerText()), '셀토스 지연'); await p.close();
    p = await cust('이서연', '010-7777-2000', '니로 EV'); await p.locator('.vlp-tab', { hasText: '위치' }).first().click(); await p.waitForTimeout(500);
    assert.ok(/대전 휴게소/.test(await p.locator('.vlp-case').first().innerText()), '니로 위치 안내'); await p.close();
    // 3) 카마스터
    const kmRows = async (k) => { const kp = await ctx.newPage(); kp.on('pageerror', (e) => errs.push(e.message)); await kp.goto(BASE + '/karmaster.html?nosw=1&demoKm=' + k); const nav = kp.locator('.vlp-nav-btn[data-tab=clients]').first(); await nav.waitFor({ state: 'attached', timeout: 15000 }); if (!(await kp.locator('.vlp-chip').count())) await nav.click(); await kp.waitForSelector('.vlp-chip'); await kp.waitForTimeout(500); const t = await kp.$$eval('.vlp-app-karmaster .vlp-case-row', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' '))); await kp.close(); return t; };
    const k1 = await kmRows('k1'), k2 = await kmRows('k2'), k3 = await kmRows('k3');
    assert.strictEqual(k1.length, 11); assert.strictEqual(k2.length, 4); assert.strictEqual(k3.length, 5);
    assert.ok(k3.some((t) => /셀토스/.test(t) && /지연 중/.test(t)), 'k3 셀토스 지연 중'); assert.ok(k1.some((t) => /스타리아/.test(t) && /도착/.test(t)));
    // 4) 시공사 A샵: 인도 건 5건
    const sp = await ctx.newPage(); sp.on('pageerror', (e) => errs.push(e.message)); await sp.goto(BASE + '/shop.html?nosw=1'); await sp.selectOption('#quick-login', 'a'); await sp.waitForSelector('.vlp-case-row', { timeout: 10000 }); await sp.waitForTimeout(800);
    const shopRows = await sp.$$eval('.vlp-case-row', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')).filter((t) => /SS-/.test(t)));
    assert.strictEqual(shopRows.length, 5, '시공사 A샵 인도 건 ' + shopRows.length); assert.ok(shopRows.some((t) => /G80/.test(t) && /인도 종결/.test(t)));
    // 5) 관리자
    const ap = await ctx.newPage(); ap.on('pageerror', (e) => errs.push(e.message)); await ap.goto(BASE + '/admin.html?nosw=1'); await ap.selectOption('#quick-login', 'admin_ulsan'); await ap.waitForSelector('.vlp-chip', { timeout: 10000 }); await ap.waitForTimeout(800);
    const chips = await ap.$$eval('.vlp-chip', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
    assert.ok(chips.includes('전체 21') && chips.includes('예외·지연 1') && chips.includes('완료 3'), '관리자 필터 ' + JSON.stringify(chips));
    assert.deepStrictEqual(errs, []); console.log('PASS test_demo_flows');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
