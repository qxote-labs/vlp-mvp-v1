// S2 PWA-12: 7개 표시 상태 칩(글자로 구분) + 5단계 그래프 + 지연 배지(해소 시 직전 단계 복귀) + 시공 중 표시.
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  const hook = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(n + ' console: ' + m.text()); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const href = BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1';
    const c = await ctx.newPage(); hook(c, 'cust');
    await c.goto(href); await c.waitForSelector('.vlp-nav-btn');

    // 7개 상태가 텍스트로 모두 다르게 나온다 (색 외 구분)
    const seven = await c.evaluate(() => VLP.statusMap.DISPLAY.map(s => { const w = document.createElement('div'); w.innerHTML = VLP.ui.stateChip(s); return w.textContent.replace(/^[^가-힣]+/, ''); }));
    assert.strictEqual(new Set(seven).size, 7, '상태 라벨 중복: ' + seven);
    ok('7개 표시 상태 라벨이 모두 다름: ' + seven.join(' / '));

    const ids = await c.evaluate(async () => { const l = await VLP.api.contracts.list({}); const x = l.items.find(i => i.deliveryId); return { deliveryId: x.deliveryId, contractId: x.contractId }; });
    const card = () => c.locator('.vlp-case');
    const open = async () => { await c.reload(); await UI.custOpen(c, '아이오닉'); };
    const cur = async () => card().locator('.vlp-step.cur .vlp-step-name').textContent();
    const chip = async () => (await card().locator('.vlp-state-chip').textContent()).replace(/^[^가-힣]+/, '');

    await open();
    assert.strictEqual(await chip(), '출고 준비'); assert.strictEqual(await cur(), '출고');
    assert.strictEqual(await card().locator('.vlp-step.done .vlp-step-mark').first().textContent(), '완료');
    assert.strictEqual(await card().locator('.vlp-step.todo .vlp-step-mark').first().textContent(), '예정');
    ok('READY: 칩 "출고 준비", 그래프 현재=출고 (완료/진행 중/예정 글자 표시)');

    await c.evaluate((id) => { const a = VLP.api.adapter().admin; a.advance(id, 'SHIPPED'); a.advance(id, 'IN_TRANSIT'); }, ids.deliveryId);
    await open(); assert.strictEqual(await chip(), '탁송 중'); assert.strictEqual(await cur(), '배송');
    ok('IN_TRANSIT: 칩 "탁송 중", 그래프 현재=배송');

    // 지연 발생 → EXCEPTION 칩 + 배지, 단계는 그대로. 해소 → 직전 상태 복귀
    const exId = await c.evaluate(async (id) => { VLP.ui.setKarmasterSession('010-2222-3301', '김도현 카마스터'); const e = await VLP.api.deliveries.raiseException(id, { reasonCode: 'traffic' }); return e.exceptionId; }, ids.deliveryId);
    await open(); assert.strictEqual(await chip(), '지연·예외'); assert.strictEqual(await cur(), '배송');
    assert.strictEqual(await card().locator('.vlp-exc-badge').count(), 1);
    ok('EXCEPTION: 칩 "지연·예외" + 배지, 그래프 위치 유지');
    await c.evaluate(async ({ id, ex }) => { VLP.ui.setKarmasterSession('010-2222-3301', '김도현 카마스터'); await VLP.api.deliveries.resolveException(id, ex); }, { id: ids.deliveryId, ex: exId });
    await open(); assert.strictEqual(await chip(), '탁송 중'); assert.strictEqual(await card().locator('.vlp-exc-badge').count(), 0);
    ok('해소 후 직전 상태(탁송 중)로 복귀, 배지 사라짐');

    // 시공 중(CUSTOMIZING): 게시된 시공 보강정보가 있으면 파생
    await c.evaluate(async (id) => { VLP.ui.setKarmasterSession('010-2222-3301', '김도현 카마스터'); const a = await VLP.api.deliveries.addAugmentation(id, { kind: 'CUSTOMIZING', text: '선팅 시공 중', audience: 'CUSTOMER' }); await VLP.api.deliveries.publishAugmentation(id, a.augmentationId); }, ids.deliveryId);
    await open(); assert.strictEqual(await chip(), '시공 중'); assert.strictEqual(await card().locator('.vlp-step-note').textContent(), '시공 중');
    ok('CUSTOMIZING: 칩 "시공 중" + 배송 단계에 시공 표시');

    await c.evaluate((id) => { const a = VLP.api.adapter().admin; a.observe(id, '경북 구미'); a.advance(id, 'ARRIVED'); }, ids.deliveryId);
    await open(); assert.strictEqual(await chip(), '도착'); assert.strictEqual(await cur(), '도착');
    ok('ARRIVED: 칩 "도착", 그래프 현재=도착');

    // 카마스터 화면 칩도 같은 렌더러
    const k = await ctx.newPage(); hook(k, 'km');
    await k.goto(BASE + '/karmaster.html?demoKm=k1&nosw=1'); await UI.ensureClients(k); await k.waitForSelector('.vlp-app-karmaster .vlp-case-row .vlp-state-chip');
    assert.ok((await k.locator('.vlp-app-karmaster .vlp-case-row .vlp-state-chip').allTextContents()).some(t => /도착/.test(t)));
    ok('카마스터 화면도 같은 칩 렌더러 사용');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S2 PWA-12 상태 칩·단계 그래프 통과 ---');
})();
