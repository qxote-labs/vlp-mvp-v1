// S3 PWA-18~22: 시공사 필수 촬영(연결 끊김 → 복구) · 대리 인수 · 카마스터 인도 확인 · 고객 원격 승인(사진 전부 열람 후, 검수 불합격 사유) · 평가
const { chromium } = require('playwright');
const { loginAs } = require('./_login');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
// 1x1 PNG (촬영 대신 파일 선택으로 넣는다)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  const hook = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(n + ' console: ' + m.text()); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const step = async (name) => { await d.evaluate(() => { document.querySelector('#step-status').textContent = ''; }); await d.click('[data-step=' + name + ']'); await d.waitForFunction(() => /완료:|실패:/.test(document.querySelector('#step-status').textContent)); const t = await d.textContent('#step-status'); assert.ok(/완료:/.test(t), name + ' ' + t); };
    const custHref = BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1', kmHref = BASE + '/' + await d.getAttribute('#l-km', 'href') + '&nosw=1';
    for (const s of ['dispatch', 'transit', 'arrive', 'inspect']) await step(s);

    const c = await ctx.newPage(); hook(c, 'cust');
    const openCust = async () => { await c.goto(custHref); await UI.custOpen(c, '아이오닉'); await UI.primary(c); const card = c.locator('.vlp-sheet'); await card.locator('.vlp-hand-cust .vlp-hand-body:not(.hint)').waitFor(); return card; };
    const chipOf = async () => (await c.locator('.vlp-case .vlp-state-chip').first().textContent()).replace(/^[^가-힣]+/, '');
    let card = await openCust();
    assert.ok(/불합격/.test(await card.locator('.vlp-insp').textContent()));
    assert.strictEqual(await card.locator('input[value=REMOTE]').isDisabled(), true);
    assert.ok(/대리 인수 기록이 아직 없|인도 확인이 끝나야/.test(await card.locator('.vlp-why').textContent()));
    ok('도착 직후: 원격 승인 비활성(사유 안내), 검수 불합격 항목 표시');

    // ---- 시공사: 연결 끊김 중 3장 촬영 → 복구 후 3장 모두 1회씩 ----
    const s = await ctx.newPage(); hook(s, 'shop');
    // 시드에 대리 인수 건이 여럿(쏘나타·코나 등)이라, 이 시나리오가 진행시킨 홍길동 아이오닉 6 건을 이름으로 고른다
    const openShop = async () => { await s.waitForSelector('.vlp-case-row', { timeout: 15000 }); const row = s.locator('.vlp-case-row', { hasText: '아이오닉 6' }).filter({ hasText: 'SS-' }); await row.first().click(); await s.waitForSelector('.vlp-primary-btn', { timeout: 15000 }); await UI.primary(s); await s.waitForSelector('.vlp-cap-row'); };
    await loginAs(s, 'shop', 'a'); await s.evaluate(() => sessionStorage.setItem('vlp_shop_tab', 'clients'));
    await s.reload(); await openShop();
    assert.strictEqual(await s.locator('.vlp-cap-row').count(), 6);
    assert.strictEqual(await s.locator('.vlp-proxy-go').isDisabled(), true);
    ok('시공사: 대리 인수 대상 1건, 필수 촬영 6컷, 모두 찍기 전에는 [대리 인수 기록] 비활성');
    const base = await s.evaluate(() => { const st = VLP.api.adapter().admin.state(); return { n: st.media.length, pub: st.media.filter(m => m.status === 'PUBLISHED').length, ev: st.events.filter(e => e.eventType === 'MediaPublished').length }; }); // 시드가 만든 사진(코나·G80)은 기준에서 뺀다
    const baseMedia = base.n;
    await s.evaluate(() => VLP.api.adapter().admin.setOffline(true));
    for (let i = 0; i < 3; i++) await s.locator('.vlp-cap-row').nth(i).locator('input.vlp-cap-input').setInputFiles({ name: 'shot' + i + '.png', mimeType: 'image/png', buffer: PNG });
    await s.waitForFunction(() => /저장 대기 3장/.test(document.querySelector('.vlp-cap-note').textContent));
    const during = await s.evaluate(() => VLP.api.adapter().admin.state().media.length);
    assert.strictEqual(during, baseMedia, '끊긴 동안 서버에 등록됨'); // 시드가 만든 사진(코나·G80)은 기준에서 뺀다
    ok('연결 끊김 중 3장 촬영 → "저장 대기 3장", 서버 등록 0건');
    const idbCount = await s.evaluate(async () => (await VLP.uploadQueue.shared().list()).length);
    assert.strictEqual(idbCount, 3);
    // 앱을 새로고침해도 대기 사진이 남는다(IndexedDB)
    await s.reload(); await openShop();
    await s.waitForFunction(() => /저장 대기 3장/.test(document.querySelector('.vlp-cap-note').textContent));
    ok('새로고침 후에도 대기 사진 3장 유지(IndexedDB)');
    await s.evaluate(() => { VLP.api.adapter().admin.setOffline(false); window.dispatchEvent(new Event('online')); });
    await s.waitForFunction(() => document.querySelectorAll('.vlp-cap-row[data-state=DONE]').length === 3, null, { timeout: 15000 });
    const after = await s.evaluate(() => { const st = VLP.api.adapter().admin.state(); return { n: st.media.length, pub: st.media.filter(m => m.status === 'PUBLISHED').length, ev: st.events.filter(e => e.eventType === 'MediaPublished').length }; });
    assert.deepStrictEqual(after, { n: base.n + 3, pub: base.pub + 3, ev: base.ev + 3 });
    ok('연결 복구 → 3장 모두 1회씩만 등록 (media 3, 게시 이벤트 3)');
    for (let i = 3; i < 6; i++) await s.locator('.vlp-cap-row').nth(i).locator('input.vlp-cap-input').setInputFiles({ name: 'shot' + i + '.png', mimeType: 'image/png', buffer: PNG });
    await s.waitForFunction(() => !document.querySelector('.vlp-proxy-go').disabled, null, { timeout: 15000 });
    await s.fill('.vlp-proxy-note', '특이사항 없음'); await s.click('.vlp-proxy-go');
    await s.waitForSelector('.vlp-sheet .vlp-hand-done');
    ok('필수 6컷 완료 → 대리 인수 기록');
    assert.strictEqual(await s.evaluate(() => VLP.api.adapter().admin.state().media.length), base.n + 6);

    // ---- 카마스터: 개인수령확인 ----
    const k = await ctx.newPage(); hook(k, 'km');
    await k.goto(kmHref); await UI.kmOpen(k, '아이오닉'); await UI.primary(k, '카마스터 확인');
    const kc = k.locator('.vlp-sheet');
    await kc.locator('.vlp-km-confirm').waitFor();
    assert.ok(/고객이 최종 승인하기 전/.test(await kc.locator('.vlp-hand-km').textContent()));
    await kc.locator('.vlp-km-confirm').click();
    await kc.locator('.vlp-hand-km').getByText('고객의 최종 승인을 기다리고').waitFor();
    assert.notStrictEqual((await k.locator('.vlp-case .vlp-state-chip').first().textContent()).replace(/^[^가-힣]+/, ''), '인도 종결');
    ok('카마스터 인도 확인 → 고객 승인 전에는 종결(인도 종결) 아님');

    // ---- 고객: 사진 전부 열람 전 원격 승인 비활성 → 열람 후 활성, 불합격 사유 필수 ----
    card = await openCust();
    assert.strictEqual(await card.locator('input[value=REMOTE]').isDisabled(), true);
    assert.ok(/열어 보지 않았어요/.test(await card.locator('.vlp-why').textContent()), await card.locator('.vlp-why').textContent());
    const n = await card.locator('.vlp-photo').count(); assert.strictEqual(n, 6);
    for (let i = 0; i < n - 1; i++) { await card.locator('.vlp-photo').nth(i).click(); await c.waitForSelector('.vlp-sheet'); await c.keyboard.press('Escape'); await card.locator('.vlp-hand-cust .vlp-approve-form, .vlp-hand-cust .vlp-checks').first().waitFor(); }
    assert.strictEqual(await card.locator('input[value=REMOTE]').isDisabled(), true, '5/6장만 열었는데 활성');
    ok('사진 5/6장 열람: 원격 승인 여전히 비활성');
    await card.locator('.vlp-photo').nth(n - 1).click(); await c.waitForSelector('.vlp-sheet'); await c.keyboard.press('Escape');
    await c.waitForFunction(() => { const r = document.querySelector('input[value=REMOTE]'); return r && !r.disabled; });
    ok('6/6장 열람: 원격 승인 활성');
    await card.locator('input[value=REMOTE]').check();
    assert.strictEqual(await card.locator('.vlp-approve-go').isDisabled(), true, '불합격 사유 없이 승인 가능');
    await card.locator('textarea[name=overrideReason]').fill('현장에서 공기압 보충 예정');
    assert.strictEqual(await card.locator('.vlp-approve-go').isDisabled(), false);
    await card.locator('input[name=signature]').fill('홍길동');
    await card.locator('.vlp-approve-go').click();
    await card.locator('.vlp-hand-done').waitFor();
    await c.waitForFunction(() => /인도 종결/.test(document.querySelector('.vlp-case .vlp-state-chip').textContent)); assert.strictEqual(await chipOf(), '인도 종결');
    ok('불합격 사유 입력 후 원격 승인 → 양측 완료, 칩 "인도 종결"');

    // ---- 평가: 인도 종결 후, 반복 진입 가능 ----
    await UI.dismissSheets(c); await UI.primary(c); await c.waitForSelector('.vlp-rate-screen');
    let scr = c.locator('.vlp-rate-screen');
    assert.strictEqual(await scr.locator('.vlp-rate-row').count(), 3);
    assert.strictEqual(await scr.locator('.vlp-rate-submit').isDisabled(), true);
    const row = scr.locator('.vlp-rate-row[data-target=KARMASTER]');
    for (const a of await row.locator('.vlp-aspect').all()) await a.locator('label.vlp-star').nth(4).click();
    await scr.locator('.vlp-rate-submit').click(); await scr.locator('.vlp-rate-done').waitFor();
    ok('평가 제출(카마스터) → 접수·포인트 표시: ' + (await scr.locator('.vlp-rate-done').textContent()).trim());
    await scr.locator('.vlp-rate-back').click(); await c.waitForSelector('.vlp-rate-screen', { state: 'detached' });
    await c.goto(custHref); await UI.custOpen(c, '아이오닉'); await UI.primary(c); await c.waitForSelector('.vlp-rate-screen'); scr = c.locator('.vlp-rate-screen');
    assert.ok(await scr.locator('.vlp-rate-row[data-target=KARMASTER] .vlp-rate-state').isVisible());
    assert.strictEqual(await scr.locator('.vlp-rate-row[data-target=DELIVERY_COMPANY] .vlp-aspect').first().isVisible(), true);
    ok('다시 들어와도 평가 상태 유지, 다른 대상은 계속 평가 가능');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S3 인수 흐름 통과 ---');
})();
