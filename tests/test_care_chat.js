// 케어 건 대화: 시공사가 보내면 고객 화면에서 보이고, 고객이 답하면 시공사 화면에서 보인다. 같은 키는 한 번만 저장.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const s = await ctx.newPage(); s.on('pageerror', e => errs.push(e.message));
    await s.goto(BASE + '/demo.html?nosw=1'); await s.click('#load'); await s.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(s, 'shop', 'b'); await s.click('.vlp-nav-btn[data-tab=clients]');
    await s.waitForSelector('.vlp-shop-case', { timeout: 10000 });
    const id = '20-202601-9002'; await s.locator('.vlp-case-row[data-care-id="' + id + '"]').click(); await s.waitForFunction((i) => { const c = document.querySelector('.vlp-shop-case'); return c && c.dataset.careId === i; }, id);
    await s.locator('.vlp-case-chat').click(); await s.waitForSelector('.vlp-chatdock textarea');
    assert.ok(/시공사|고객/.test(await s.locator('.vlp-chat-sum').innerText()));
    await s.fill('.vlp-chatdock textarea', '입고 전에 차량 상태 사진 먼저 보내 주세요'); await s.click('.vlp-chat-send');
    await s.waitForSelector('.vlp-chatdock .msg-bubble.mine:not(.pending)');
    const msgs = await s.evaluate((i) => Store.getCareOrder(i).messages, id);
    assert.strictEqual(msgs.length, 1); assert.strictEqual(msgs[0].senderRole, 'shop');
    // 같은 Idempotency-Key 재전송은 중복 저장되지 않는다
    await s.evaluate((i) => { const k = Store.getCareOrder(i).messages[0].key; Store.addCareMessage(i, 'shop', 'x', k); }, id);
    assert.strictEqual((await s.evaluate((i) => Store.getCareOrder(i).messages.length, id)), 1);
    console.log('✔ 시공사 → 메시지 전송, 중복 키는 한 번만');
    // 고객 화면에서 읽고 답한다
    const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message));
    await loginAs(c, 'customer', 1);
    await c.locator('.vlp-nav-btn[data-tab=care]').waitFor({ timeout: 10000 }); await c.locator('.vlp-nav-btn[data-tab=care]').click();
    await c.waitForSelector('.vlp-care-case');
    const cid = await c.locator('.vlp-care-case').getAttribute('data-care-id');
    if (cid !== id) { console.log('· 고객 첫 건이 다른 건이라 해당 건 메시지는 직접 주입', cid); await c.evaluate(([i, t]) => Store.addCareMessage(i, 'shop', t, 'k-test'), [cid, '안녕하세요 시공사입니다']); }
    // 안 읽음: 열기 전에는 채팅 버튼에 개수(목록 표시는 test_care_seed_cases)
    const unread = await c.evaluate((i) => VLP.careApi && Store.getCareOrder(i).messages.filter((m) => m.senderRole === 'shop').length, cid); assert.ok(unread >= 1);
    assert.ok(/^[1-9]/.test((await c.locator('.vlp-chat-badge').innerText()).trim()), '채팅 버튼 배지에 안 읽은 개수');
    await c.locator('.vlp-case-chat').click(); await c.waitForSelector('.vlp-chatdock .msg-bubble.theirs');
    assert.ok(/시공사/.test(await c.locator('.vlp-chatdock .msg-bubble.theirs .vlp-msg-who').first().innerText()));
    await c.fill('.vlp-chatdock textarea', '네 알겠습니다'); await c.click('.vlp-chat-send');
    await c.waitForSelector('.vlp-chatdock .msg-bubble.mine:not(.pending)');
    const last = await c.evaluate((i) => Store.getCareOrder(i).messages.slice(-1)[0], cid);
    assert.strictEqual(last.senderRole, 'customer'); assert.strictEqual(last.body, '네 알겠습니다');
    console.log('✔ 고객: 시공사 메시지 보임, 답장 저장');
    assert.ok(await c.evaluate((i) => !!Store.getCareOrder(i).chatRead.customer, cid), '열면 읽음 기록이 남는다');
    // 관리자: 읽기 전용, 사유를 남기기 전에는 본문이 가려진다
    const ad = await ctx.newPage(); ad.on('pageerror', e => errs.push(e.message)); await ad.setViewportSize({ width: 1440, height: 900 });
    await loginAs(ad, 'supervisor', 'admin_super', '');
    await ad.click('.vlp-adm-nav-btn[data-menu=care]'); await ad.waitForSelector('#admin-care-list .vlp-case-row');
    await ad.locator('#admin-care-list .vlp-case-row', { hasText: cid }).first().click(); await ad.click('#care-chat-open'); await ad.waitForSelector('.vlp-chatdock');
    assert.strictEqual(await ad.locator('.vlp-chatdock textarea').count(), 0, '입력창 없음');
    await ad.waitForSelector('.vlp-chat-masked'); assert.ok(!/네 알겠습니다/.test(await ad.locator('.vlp-chatdock .vlp-chat-body').innerText()));
    await ad.click('.vlp-chat-reason'); await ad.selectOption('#vlp-reason-sel', 'COMPLAINT'); await ad.click('.vlp-reason-go');
    await ad.waitForFunction(() => /동의를 기다리는 중/.test((document.querySelector('.vlp-chat-masked') || { innerText: '' }).innerText));
    assert.ok(await ad.evaluate((i) => VLP.careApi.admin.recordView(i, 'COMPLAINT').then(() => false, (e) => e.status === 403), cid), '동의 없이는 열람 기록을 남길 수 없음(403)');
    await ad.evaluate((i) => { const c = Store.latestChatConsent(i); Store.respondChatConsent(c.id, 'customer', true); Store.respondChatConsent(c.id, 'other', true); }, cid);
    await ad.waitForSelector('.vlp-chat-view', { timeout: 8000 }); await ad.click('.vlp-chat-view');
    await ad.waitForFunction(() => /네 알겠습니다/.test(document.querySelector('.vlp-chatdock .vlp-chat-body').innerText), null, { timeout: 5000 });
    assert.strictEqual(await ad.evaluate((i) => Store.getCareOrder(i).chatViews.length, cid), 1);
    console.log('✔ 관리자: 읽기 전용, 사유 전 본문 가림 → 사유 기록 후 열람');
    assert.deepStrictEqual(errs, []);
  } catch (e) { console.error('❌', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
