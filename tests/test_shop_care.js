// 시공사 화면(구성안 5.3): 할 일 큐 · 견적 회신 · 입고 확인(필수 6컷·경로·주행거리 선택) · 작업 · 추가 금액 · 검수 요청 · 보완 · 수령 준비
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, 'shop', 'b'); await p.click('.vlp-nav-btn[data-tab=clients]');
    const phase = (ph) => p.waitForFunction((x) => { const c = document.querySelector('.vlp-shop-case'); return c && c.dataset.phase === x; }, ph, { timeout: 10000 });
    const st = (id) => p.evaluate((i) => Store.getCareOrder(i), id);
    await p.waitForSelector('.vlp-case-row'); const id = '20-202601-9002';
    assert.ok(/견적 요청\s*2/.test(await p.locator('.sc-queues').innerText()));   // 시드: 9002 + 9017(길게 쓴 요청사항)
    await p.locator('.vlp-case-row[data-care-id="' + id + '"]').click(); await phase('REQUESTED');
    // 견적 회신
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#sc-price');
    await p.fill('#sc-price', '1500000'); await p.click('#sc-quote-send'); await phase('QUOTED');
    assert.strictEqual((await st(id)).quotedPrice, 1500000);
    assert.strictEqual(await p.locator('.vlp-primary-hero').count(), 0);
    console.log('✔ 견적 회신 → 고객 확인 대기');
    // 고객이 계약(이 화면 밖)
    await p.evaluate((i) => { Store.confirmCareQuote(i, 0); }, id); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector('.vlp-app-shop').__refresh()); await phase('CONFIRMED');
    // 입고 확인: 6컷이 모두 있어야 활성
    await p.locator('.vlp-primary-hero').click(); await p.waitForSelector('#sc-intake-ok');
    assert.strictEqual(await p.locator('#sc-intake-ok').isDisabled(), true);
    assert.strictEqual(await p.locator('.sc-shot').count(), 6);
    await p.selectOption('#sc-route', 'SHOP_PICKUP');
    await p.locator('.sc-shot').first().locator('input').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await p.waitForFunction(() => /1\/6/.test(document.querySelector('#sc-intake-ok').textContent));
    assert.strictEqual(await p.locator('#sc-intake-ok').isDisabled(), true);
    await p.click('#sc-sample-all'); await p.waitForFunction(() => !document.querySelector('#sc-intake-ok').disabled);
    // 주행거리는 비워 둬도 된다(선택)
    await p.click('#sc-intake-ok'); await phase('RECEIVED');
    const o = await st(id); assert.strictEqual(o.intakeRoute, 'SHOP_PICKUP'); assert.strictEqual(o.intakePhotos.length, 6); assert.ok(o.mileage == null);
    console.log('✔ 입고 확인: 6컷 전부 있어야 활성, 경로 기록, 주행거리 선택');
    // 작업
    await p.locator('.vlp-primary-hero').click(); await phase('WORKING');
    await p.locator('.vlp-tabs [role=tab]').nth(1).click();
    for (let i = 0; i < 2; i++) { await p.click('.sc-sample'); await p.waitForFunction((n) => document.querySelectorAll('.sc-photos figure').length === n, i + 1); }
    await p.locator('.sc-withdraw').first().click(); await p.waitForFunction(() => document.querySelectorAll('.sc-photos figure').length === 1);
    assert.strictEqual((await st(id)).photos.filter(x => !x.withdrawn).length, 1);
    await p.locator('.vlp-primary-hero').click(); await phase('INSPECTING');
    // 청구: 추가 금액 + 사유
    await p.locator('.vlp-tabs [role=tab]').nth(1).click();
    await p.fill('#sc-extra', '200000'); await p.fill('#sc-note', '후면 추가 PPF');
    assert.ok(/1,700,000원/.test(await p.locator('#sc-total').innerText()));
    await p.locator('.vlp-primary-hero').click(); await phase('CUSTOMER_INSPECT');
    const c2 = await st(id); assert.strictEqual(c2.chargedPrice, 1700000); assert.strictEqual(c2.chargeNote, '후면 추가 PPF');
    console.log('✔ 작업 중 사진(회수 포함) → 작업 완료 → 추가 금액·사유 → 검수 요청');
    // 고객 이의 → 보완 완료
    await p.evaluate((i) => { Store.raiseCareDispute(i, '문 하단 기포', { escalated: false }); }, id); await p.evaluate(() => document.querySelector('.vlp-app-shop').__refresh()); await phase('REWORK');
    const heroTxt = await p.locator('.vlp-case-hero').innerText(); assert.ok(/1\/2회/.test(heroTxt), '이의 횟수가 보여야 한다'); assert.ok(/문 하단 기포/.test(await p.locator('.vlp-shop-case').innerText()), '이의 사유가 보여야 한다');
    await p.locator('.vlp-primary-hero').click(); await phase('CUSTOMER_INSPECT');
    await p.evaluate((i) => { Store.ownerConfirmCare(i); }, id); await p.evaluate(() => document.querySelector('.vlp-app-shop').__refresh()); await phase('RELEASED');
    await p.locator('.vlp-primary-hero').click(); await phase('READY_TO_RECEIVE');
    assert.strictEqual((await st(id)).status, '수령대기');
    console.log('✔ 이의 → 보완 완료·재검수 → 출차 → 수령 준비 완료(방문 수령)');
    // 큐: 출차·완료
    await p.locator('.sc-queues [data-queue=out]').click();
    assert.ok((await p.locator('.vlp-case-row').count()) >= 1);
    assert.deepStrictEqual(errs, []); console.log('PASS test_shop_care');
  } catch (e) { console.error('FAIL', e.message, errs); process.exitCode = 1; } finally { await b.close(); }
})();
