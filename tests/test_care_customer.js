// 구매자 신차케어 1차 이식: 신청 → 견적 → 계약 → 입고·작업·검수 → 출차 승인 → 수령 → 정찰제 확인 → 평가 (VLP.api.care 경유)
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const errs = [];
  try {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await loginAs(p, 'customer', 1);
    const reload = async () => { await p.evaluate(() => { const a = document.querySelector('.vlp-app-customer'); if (a && a.__reload) a.__reload(); }); await p.waitForTimeout(350); };
    // Store를 바꾸면 화면이 다시 그려질 수 있으므로, 기대하는 단계가 화면에 반영될 때까지 기다린 뒤 다음 조작을 한다
    const adv = async (fn, arg, phase) => { await p.evaluate(fn, arg); await reload(); if (phase) { await p.waitForFunction((ph) => { const c = document.querySelector('.vlp-care-case'); return c && c.dataset.phase === ph; }, phase, { timeout: 8000 }); await p.waitForTimeout(250); } };
    await p.locator('.vlp-nav-btn[data-tab=care]').waitFor({ timeout: 10000 });
    await p.locator('.vlp-nav-btn[data-tab=care]').click();
    await p.waitForSelector('.vlp-care-case');
    assert.strictEqual(await p.locator('.vlp-care-case').getAttribute('data-phase'), 'WORKING');
    console.log('✔ 케어 탭: 진행 중 건(작업 중)이 상세로 열린다');

    // 새 신청
    await p.click('#care-new-sm');
    assert.strictEqual(await p.locator('#care-submit').isDisabled(), true);
    await p.selectOption('#care-car', { index: 1 });
    await p.locator('.care-shop').first().click();
    await p.locator('.care-seg-b[data-mode=SHOP_DELIVERY]').click();
    await p.locator('#care-submit').click();
    await p.waitForFunction(() => { const c = document.querySelector('.vlp-care-case'); return c && c.dataset.phase === 'REQUESTED'; });
    const id = await p.locator('.vlp-care-case').getAttribute('data-care-id');
    assert.ok(/^20-/.test(id));
    assert.ok((await p.locator('.vlp-care-case').textContent()).includes('시공사 배송'));
    console.log('✔ 신청 → 견적 대기, 수령 방식(시공사 배송) 표시');

    // 견적 도착 → 계약
    await adv((cid) => Store.respondCareQuote(cid, 1730000), id, 'QUOTED');
    await p.locator('.vlp-primary-hero').click();
    await p.waitForSelector('#care-confirm');
    await p.click('#care-confirm');
    await p.waitForFunction(() => (document.querySelector('.vlp-care-case')||{dataset:{}}).dataset.phase === 'CONFIRMED');
    console.log('✔ 견적 확인 → 계약 완료');

    // 시공사 쪽 처리 (이 화면 밖)
    await adv((cid) => { Store.confirmCareDropoff(cid); }, id, 'RECEIVED');
    assert.strictEqual(await p.locator('.vlp-care-case').getAttribute('data-phase'), 'RECEIVED');
    { const t = (await p.locator('.vlp-care-case').textContent()).replace(/\s+/g, ' '); assert.ok(t.includes('입고 확인') && t.includes('고객 방문'), t.slice(0, 300)); }
    await adv((cid) => { Store.setCareShopStage(cid, '작업중'); }, id, 'WORKING');
    assert.strictEqual(await p.locator('.vlp-care-case').getAttribute('data-phase'), 'WORKING');
    await adv((cid) => { Store.setCareShopStage(cid, '최종검수'); Store.setCareCharged(cid, 0, ''); Store.requestCareInspection(cid); }, id, 'CUSTOMER_INSPECT');
    assert.strictEqual(await p.locator('.vlp-care-case').getAttribute('data-phase'), 'CUSTOMER_INSPECT');
    console.log('✔ 입고 → 작업 → 검수 요청 단계 반영');

    // 이의 접수 후 상태 확인은 별도 건에서 하지 않고, 승인 경로를 먼저 검증
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-approve');
    await p.click('#care-approve');
    await p.waitForFunction(() => (document.querySelector('.vlp-care-case')||{dataset:{}}).dataset.phase === 'RELEASED');
    console.log('✔ 출차 승인 → 출차 완료');

    await adv((cid) => { Store.startCareSecondLeg(cid); Store.forceArrive(cid); }, id, 'READY_TO_RECEIVE');
    assert.strictEqual(await p.locator('.vlp-care-case').getAttribute('data-phase'), 'READY_TO_RECEIVE');
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-receive'); await p.click('#care-receive');
    await p.waitForFunction(() => (document.querySelector('.vlp-care-case')||{dataset:{}}).dataset.phase === 'PRICE_CHECK');
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-pc-ok'); await p.click('#care-pc-ok');
    await p.waitForFunction(() => (document.querySelector('.vlp-care-case')||{dataset:{}}).dataset.phase === 'RATE');
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-rate-send'); await p.click('#care-rate-send');
    await p.waitForFunction(() => (document.querySelector('.vlp-care-case')||{dataset:{}}).dataset.phase === 'DONE');
    console.log('✔ 수령 → 정찰제 확인 → 평가 → 완료');

    // 이의 → 보완 → 재검수 (2회까지, 넘기면 운영자 중재)
    const id2 = await p.evaluate(async () => { const cars = await VLP.api.care.cars(); const shops = await VLP.api.care.shops(); const r = await VLP.api.care.request({ reservationId: cars[0].reservationId, shopId: shops[0].shopId, packageId: 'basic' });
      Store.respondCareQuote(r.careId, 980000); Store.confirmCareQuote(r.careId, 0); Store.confirmCareDropoff(r.careId); Store.setCareShopStage(r.careId, '작업중'); Store.setCareShopStage(r.careId, '최종검수'); Store.requestCareInspection(r.careId); return r.careId; });
    await p.locator('.vlp-car-chip', { hasText: id2.slice(-4) }).click();
    await p.waitForFunction((cid) => { const c = document.querySelector('.vlp-care-case'); return c && c.dataset.careId === cid && c.dataset.phase === 'CUSTOMER_INSPECT'; }, id2);
    for (let round = 1; round <= 2; round++) {
      await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-dispute-open');
      assert.ok((await p.locator('#care-dispute-open').textContent()).includes('남은 ' + (3 - round) + '회'));
      await p.click('#care-dispute-open'); await p.fill('#care-dispute-reason', '마감 불량 ' + round); await p.click('#care-dispute-send');
      await adv(() => {}, null, 'REWORK');
      assert.ok((await p.locator('.vlp-case-sm').first().textContent()).includes('이의 ' + round + '/2회'));
      await adv((cid) => { Store.completeCareRework(cid); }, id2, 'CUSTOMER_INSPECT');
    }
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#care-dispute-open');
    assert.ok((await p.locator('#care-dispute-open').textContent()).includes('운영자에게 중재 요청'));
    await p.click('#care-dispute-open'); await p.fill('#care-dispute-reason', '계속 불량'); await p.click('#care-dispute-send');
    await adv(() => {}, null, 'ESCALATED');
    await adv((cid) => { Store.completeCareRework(cid); }, id2, 'ESCALATED'); // 중재 중에는 시공사 보완 완료가 먹지 않는다
    await adv((cid) => { Store.resolveCareDispute(cid); }, id2, 'CUSTOMER_INSPECT');
    console.log('✔ 이의 2회까지 보완·재검수, 초과 시 운영자 중재, 운영자 해소 후 재검수');

    // 여러 건이면 칩 줄, 폰 폭에서는 목록 → 상세
    assert.ok(await p.locator('.vlp-car-chip').count() >= 2);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
    await p.locator('.vlp-case-back').click(); await p.waitForSelector('.vlp-case-row');
    assert.ok(await p.locator('.vlp-case-row').count() >= 2);
    console.log('✔ 칩 줄(PC) / 목록→상세(폰)');
    assert.deepStrictEqual(errs, []);
    console.log('PASS test_care_customer');
  } catch (e) { console.error('FAIL', e.message, errs); process.exitCode = 1; } finally { await b.close(); }
})();
