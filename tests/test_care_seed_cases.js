// 시드 사례(store.js CARE_DEMO_GUIDE) 전수 검증: 15단계가 모두 시드에 있고, 단계·분기마다 고객·시공사·관리자 화면이 맞게 보인다.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const EXPECT = { // id → [단계, 시공사]
  '20-202601-9001': ['WORKING', 'a'], '20-202601-9002': ['REQUESTED', 'b'], '20-202601-9003': ['CONFIRMED', 'c'],
  '20-202601-9004': ['INSPECTING', 'a'], '20-202601-9005': ['CUSTOMER_INSPECT', 'a'], '20-202601-9006': ['REWORK', 'a'], '20-202601-9007': ['ESCALATED', 'a'],
  '20-202601-9008': ['RECEIVED', 'c'], '20-202601-9009': ['RELEASED', 'c'], '20-202601-9010': ['READY_TO_RECEIVE', 'c'], '20-202601-9011': ['RELEASED', 'c'],
  '20-202601-9012': ['QUOTED', 'a'], '20-202601-9013': ['PRICE_CHECK', 'b'], '20-202601-9014': ['DISPUTED', 'b'], '20-202601-9015': ['RATE', 'b'], '20-202601-9016': ['DONE', 'b'],
  '20-202601-9017': ['REQUESTED', 'b'], '20-202601-9018': ['CONFIRMED', 'c'], '20-202601-9019': ['WORKING', 'a'], '20-202601-9020': ['WORKING', 'c'],
};
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w) => { const p = await (await b.newContext({ viewport: { width: w || 1280, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const text = async (p, sel) => (await p.locator(sel).innerText()).replace(/\s+/g, ' ');
  try {
    // 1) 단계 매핑: 15단계 전부 + 각 건의 시공사
    const d = await mk(); await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load'); await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const got = await d.evaluate(() => Store.getCareOrders().map(c => [c.id, VLP.careApi && c.status, c.shopId]));
    const phases = await d.evaluate(async () => {
      const out = {}; const U = VLP.ui;
      for (const c of Store.getCareOrders()) { U.setCustomerSession(c.customer.name, c.customer.phone); const l = await VLP.api.care.list(); l.items.forEach(x => { out[x.careId] = [x.phase, x.shop && x.shop.shopId]; }); }
      return out;
    });
    Object.entries(EXPECT).forEach(([id, [ph, shop]]) => assert.deepStrictEqual(phases[id], [ph, shop], id + ' ' + JSON.stringify(phases[id])));
    const all15 = ['REQUESTED', 'QUOTED', 'CONFIRMED', 'RECEIVED', 'WORKING', 'INSPECTING', 'CUSTOMER_INSPECT', 'REWORK', 'ESCALATED', 'RELEASED', 'READY_TO_RECEIVE', 'PRICE_CHECK', 'DISPUTED', 'RATE', 'DONE'];
    assert.deepStrictEqual(all15.filter(x => !Object.values(phases).some(v => v[0] === x)), [], '시드에 없는 단계');
    console.log('✔ 시드 ' + Object.keys(EXPECT).length + '건: 15단계 전부, 시공사 배정 일치');
    // 시연 안내 표와 [사례 처음 상태로]
    assert.strictEqual(await d.locator('#care-guide tr').count(), 18, '안내 표: 머리 + 사례 17줄');
    await d.evaluate(() => { Store.setCareShopStage('20-202601-9008', '작업중'); });
    await d.click('#care-reset'); await d.waitForFunction(() => /되돌렸/.test(document.querySelector('#care-reset-status').textContent));
    assert.strictEqual(await d.evaluate(() => Store.getCareOrder('20-202601-9008').status), '입고완료');
    console.log('✔ demo.html 사례 안내 표 · 처음 상태로 되돌리기');
    await d.close();

    // 2) 고객 화면: 윤서아(정찰제 불일치) · 최수민(추가 금액+포인트) · 정하늘(이의 보완·중재)
    const openCare = async (p, phone, id) => {
      await loginAs(p, 'customer', phone);
      await p.locator('.vlp-nav-btn[data-tab=care]').click(); await p.locator('[data-care-id="' + id + '"]').first().click();
      await p.waitForFunction((i) => { const c = document.querySelector('.vlp-care-case'); return c && c.dataset.careId === i; }, id);
    };
    const prime = async () => { const p = await mk(); await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent)); return p; };
    const c = await prime();
    await openCare(c, '010-7777-8000', '20-202601-9014');
    let t = await text(c, '.vlp-care-case'); assert.ok(/견적 1,480,000원 \+ 추가 300,000원/.test(t) && /추가 요금 제보/.test(t), t.slice(0, 300));
    await c.locator('.vlp-case-chat').click(); await c.waitForSelector('.vlp-chatdock .msg-bubble.mine');
    assert.ok(/30만원/.test(await text(c, '.vlp-chatdock .vlp-chat-body')), '시드 대화(고객→시공사)가 보인다');
    console.log('✔ 고객: 정찰제 불일치 건 — 견적+추가 표시, 제보 상태, 시드 대화');
    await openCare(c, '010-7777-4000', '20-202601-9005');
    t = await text(c, '.vlp-care-case'); assert.ok(/추가 120,000원/.test(t), t.slice(0, 300));
    await openCare(c, '010-7777-5000', '20-202601-9007'); t = await text(c, '.vlp-care-case'); assert.ok(/운영자/.test(t), t.slice(0, 300));
    await openCare(c, '010-7777-5000', '20-202601-9006'); t = await text(c, '.vlp-care-case'); assert.ok(/이의|보완/.test(t), t.slice(0, 300));
    console.log('✔ 고객: 추가 금액 청구 · 이의 보완 중 · 운영자 중재 중');
    await c.close();

    // 3) 시공사 화면
    const shopOpen = async (p, shop, id) => {
      await loginAs(p, 'shop', shop); await p.click('.vlp-nav-btn[data-tab=clients]'); await p.waitForSelector('.vlp-case-row');
      await p.locator('.vlp-case-row[data-care-id="' + id + '"]').click();
      await p.waitForFunction((i) => { const c = document.querySelector('.vlp-shop-case'); return c && c.dataset.careId === i; }, id);
    };
    const sc = await prime();
    await shopOpen(sc, 'a', '20-202601-9001');
    const rowTxt = (id) => text(sc, '.vlp-case-row[data-care-id="' + id + '"]');
    assert.ok(/새 메시지 1/.test(await rowTxt('20-202601-9006')) && /새 메시지 1/.test(await rowTxt('20-202601-9019')) && !/새 메시지/.test(await rowTxt('20-202601-9005')), '고객이 마지막으로 말한 건만 시공사 쪽 안 읽음');
    console.log('✔ 시공사: 목록에 안 읽은 대화 표시');
    await shopOpen(sc, 'c', '20-202601-9008'); t = await text(sc, '.vlp-shop-case'); assert.ok(/시공사 수령/.test(t) && /사전 촬영 6장/.test(t), t.slice(0, 300));
    await sc.locator('.vlp-tabs [role=tab]').nth(0).click(); t = await text(sc, '.vlp-shop-case'); assert.ok(/주행거리\s*12/.test(t), t.slice(0, 400));
    await shopOpen(sc, 'c', '20-202601-9011'); await sc.locator('.vlp-tabs [role=tab]').nth(1).click(); await sc.waitForSelector('.sc-delivering');
    assert.ok(/삼산로 100/.test(await text(sc, '.sc-delivering')));
    await shopOpen(sc, 'c', '20-202601-9018'); assert.ok(/입고 확인/.test(await text(sc, '.vlp-primary-hero')));
    await sc.locator('.vlp-primary-hero').click(); await sc.waitForSelector('.sc-shot'); assert.strictEqual(await sc.locator('.sc-shot').count(), 6);
    console.log('✔ 시공사 C: 시공사 수령·주행거리 / 배송 중 도착지 / 입고 대기→6컷 시트');
    await shopOpen(sc, 'a', '20-202601-9019'); await sc.locator('.vlp-tabs [role=tab]').nth(1).click();
    assert.strictEqual(await sc.locator('.sc-photos figure').count(), 2, '3장 중 회수 1장은 빠진다'); assert.ok(/2\/6/.test(await text(sc, '.sc-photos')));
    await sc.locator('.vlp-case-chat').click(); await sc.waitForSelector('.vlp-chatdock .msg-bubble.mine');
    assert.strictEqual(await sc.locator('.vlp-chatdock .msg-bubble').count(), 2); assert.strictEqual(await sc.locator('.vlp-chatdock .msg-bubble.mine').count(), 1, '시공사 입장에서 내 말풍선은 시공사 것');
    await sc.locator('.vlp-chat-close').click();
    await shopOpen(sc, 'a', '20-202601-9006'); t = await text(sc, '.vlp-shop-case'); assert.ok(/고객 이의 \(1\/2회째\)/.test(t) && /문 하단 기포/.test(t), t.slice(0, 300));
    await shopOpen(sc, 'a', '20-202601-9007'); t = await text(sc, '.vlp-shop-case'); assert.ok(/운영자가 중재/.test(t), t.slice(0, 300)); assert.strictEqual(await sc.locator('.vlp-primary-hero').count(), 0, '중재 중에는 시공사 조작이 없다');
    console.log('✔ 시공사 A: 사진 회수 제외·대화 방향·이의 사유/횟수·중재 중 조작 없음');
    await shopOpen(sc, 'b', '20-202601-9017'); t = await text(sc, '.vlp-shop-case'); assert.ok(/하이패스 단말기 위치/.test(t) && /아이나비/.test(t), '긴 요청사항이 잘리지 않는다');
    console.log('✔ 시공사 B: 긴 요청사항 전체 표시');
    await sc.close();

    // 3-1) 고객이 정찰제 불일치를 제보하면 단계가 DISPUTED가 된다(이전엔 RATE로 넘어가던 오류 — 시드 9014로 발견)
    const pm = await prime(); const r2 = await pm.evaluate(async () => { VLP.ui.setCustomerSession('윤서아', '010-7777-8000'); const x = await VLP.api.care.answerPriceCheck('20-202601-9013', false); return x.phase; });
    assert.strictEqual(r2, 'DISPUTED'); await pm.close(); console.log('✔ 정찰제 불일치 제보 → DISPUTED');
    // 4) 관리자: 케어 전체·이의 큐
    const ad = await prime(); await ad.setViewportSize({ width: 1440, height: 900 });
    await loginAs(ad, 'supervisor', 'admin_super', '');
    await ad.waitForSelector('.vlp-adm-nav-btn[data-menu=dispute]'); assert.ok(/●2/.test(await text(ad, '.vlp-adm-nav-btn[data-menu=dispute]')));
    await ad.click('.vlp-adm-nav-btn[data-menu=care]'); await ad.waitForSelector('#admin-care-list .vlp-case-row');
    assert.strictEqual(await ad.locator('#admin-care-list .vlp-case-row').count(), 20, '전체 케어 20건');
    await ad.locator('#admin-care-list .vlp-case-row', { hasText: '20-202601-9014' }).first().click(); await ad.waitForSelector('#admin-care-detail');
    t = await text(ad, '#admin-care-detail'); assert.ok(/추가 300,000원/.test(t), t.slice(0, 300));
    console.log('✔ 관리자: 전체 20건, 이의 큐 2건, 정찰제 불일치 건 청구 표시');
    assert.deepStrictEqual(errs, []); console.log('PASS test_care_seed_cases');
  } catch (e) { console.error('FAIL', e.message, errs); process.exitCode = 1; } finally { await b.close(); }
})();
