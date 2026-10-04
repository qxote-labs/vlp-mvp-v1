// 관리자 대화 열람 동의: 당사자 승인/거부, 예외 열람(슈퍼바이저만), 안내 문구
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await ctx.newPage(); a.on('pageerror', e => errs.push(e.message));
    await a.goto(BASE + '/demo.html?nosw=1'); await a.click('#load'); await a.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const id = '20-202601-9001';
    await loginAs(a, 'supervisor', 'admin_super', '');
    await a.click('.vlp-adm-nav-btn[data-menu=care]'); await a.waitForSelector('#admin-care-list .vlp-case-row');
    await a.locator('#admin-care-list .vlp-case-row', { hasText: id }).first().click();
    assert.strictEqual(await a.locator('.vlp-chatdock').count(), 0, '관리자는 건을 골라도 대화 패널이 자동으로 열리지 않음');
    await a.click('#care-chat-open'); await a.waitForSelector('.vlp-chat-masked');
    assert.ok(await a.locator('.vlp-chat-exc').count(), '슈퍼바이저에게는 예외 열람 버튼');
    // 동의 요청 → 한쪽(고객) 거부 → 열람 불가
    await a.click('.vlp-chat-reason'); await a.selectOption('#vlp-reason-sel', 'COMPLAINT'); await a.click('.vlp-reason-go');
    await a.waitForFunction(() => /동의를 기다리는 중/.test((document.querySelector('.vlp-chat-masked') || { innerText: '' }).innerText));
    await a.waitForFunction(() => !document.querySelector('.vlp-sheet'));
    // 고객 쪽 대화창에 안내 배너가 뜨고 거부 (본문 API는 가짜로 대체해 배너만 본다)
    await a.evaluate((i) => { VLP.chat.close(); VLP.chat.open(i, { role: 'customer', other: '시공사', summary: '테스트', api: { messages: async () => ({ items: [], nextCursor: null }), send: async () => ({}), markRead: async () => ({}) } }); }, id);
    await a.waitForSelector('.vlp-chat-consent:not([hidden]) .vlp-cc-no');
    assert.ok(/열람 동의를 요청/.test(await a.locator('.vlp-chat-consent').innerText()) && /민원 처리/.test(await a.locator('.vlp-chat-consent').innerText()), '요청 사유가 보임');
    await a.click('.vlp-cc-no'); await a.waitForFunction(() => document.querySelector('.vlp-chat-consent').hidden);
    await a.evaluate(() => VLP.chat.close());
    await a.click('#care-chat-open'); await a.waitForSelector('.vlp-chat-masked');
    await a.waitForFunction(() => /거부했어요/.test((document.querySelector('.vlp-chat-masked') || { innerText: '' }).innerText), null, { timeout: 8000 });
    assert.strictEqual(await a.locator('.vlp-chat-view').count(), 0, '거부되면 열람하기 없음');
    console.log('✔ 동의 요청 → 응답 대기 → 한쪽 거부 → 열람 불가');
    // 예외 열람(슈퍼바이저): 사유 + 상세 사유 필수
    await a.click('.vlp-chat-exc'); await a.waitForSelector('#vlp-reason-sel');
    await a.selectOption('#vlp-reason-sel', 'LEGAL_REQUEST'); assert.ok(await a.locator('.vlp-reason-go').isDisabled(), '예외는 상세 사유 필수');
    await a.fill('#vlp-reason-note', '법원 요청 2026-0001'); await a.click('.vlp-reason-go');
    await a.waitForFunction(() => !document.querySelector('.vlp-chat-masked'), null, { timeout: 8000 });
    const ex = await a.evaluate((i) => Store.getChatConsents(i).filter(c => c.exception).length, id); assert.strictEqual(ex, 1, '예외 열람이 따로 기록됨');
    assert.ok(/예외 사유로 열람 중 · 남은 시간 약 \d+분/.test(await a.locator('.vlp-chat-consent.viewing').innerText()), '열람 중에는 남은 시간 안내가 보임');
    console.log('✔ 슈퍼바이저 예외 열람(사유+상세 필수) → 예외로 기록');
    // 커뮤니티관리자에는 예외 버튼이 없다
    const c2 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const a2 = await c2.newPage(); a2.on('pageerror', e => errs.push(e.message));
    await a2.goto(BASE + '/demo.html?nosw=1'); await a2.click('#load'); await a2.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await a2.goto(BASE + '/admin.html?nosw=1'); await a2.evaluate(() => { window.tryLogin(Store.getAdmins().find(x => x.adminScope === 'community').id, 'delivery'); });
    await a2.waitForSelector('.vlp-adm-nav-btn[data-menu=care]'); await a2.click('.vlp-adm-nav-btn[data-menu=care]'); await a2.waitForSelector('#admin-care-list .vlp-case-row');
    await a2.locator('#admin-care-list .vlp-case-row').first().click(); await a2.click('#care-chat-open'); await a2.waitForSelector('.vlp-chat-masked');
    assert.strictEqual(await a2.locator('.vlp-chat-exc').count(), 0, '커뮤니티관리자는 예외 열람 불가');
    console.log('✔ 커뮤니티관리자는 예외 열람 버튼 없음');
    // 당사자 알림: 고객(김민준)·카마스터(k1) 화면에 요청이 왔다는 표시(알림 목록·채팅 버튼 점·목록 행 표시)
    {
      const ctx3 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const adm = await ctx3.newPage(); adm.on('pageerror', e => errs.push(e.message));
      await adm.goto(BASE + '/demo.html?nosw=1'); await adm.click('#load'); await adm.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      const cu = await ctx3.newPage(); cu.on('pageerror', e => errs.push(e.message));
      await loginAs(cu, 'customer', { name: '김민준', phone: '010-7777-1000' }, ''); await cu.waitForTimeout(1500);
      const cid = await cu.evaluate(async () => { const p = await VLP.api.contracts.list({ limit: 50 }); const c = p.items.find(x => x.vehicleModel === '투싼'); return c && c.contractId; });
      assert.ok(cid, '김민준 투싼 계약');
      await adm.evaluate((i) => { Store.requestChatConsent(i, '테스트관리자', 'COMPLAINT', '민원 접수'); }, cid);
      await cu.waitForFunction(() => /1|2|3/.test((document.querySelector('.vlp-notes-badge') || { textContent: '' }).textContent) && !document.querySelector('.vlp-notes-badge').hidden, null, { timeout: 8000 });
      await cu.click('.vlp-notes-head'); await cu.waitForSelector('.vlp-note.consent');
      assert.ok(/운영자가 대화 열람 동의를 요청했어요 · 투싼/.test(await cu.locator('.vlp-note.consent').first().innerText()), '알림 목록에 요청 표시');
      await cu.click('.vlp-note.consent .vlp-note-open'); await cu.waitForSelector('.vlp-case');
      await cu.waitForFunction(() => document.querySelector('.vlp-case-chat.has-consent'), null, { timeout: 8000 });
      console.log('✔ 당사자(고객)에게 알림 목록·채팅 버튼 점으로 동의 요청이 보임');
      const km = await ctx3.newPage(); km.on('pageerror', e => errs.push(e.message));
      await loginAs(km, 'karmaster', 'k1', ''); await km.waitForTimeout(1500);
      await km.waitForFunction(() => { const b = document.querySelector('.vlp-notes-badge'); return b && !b.hidden; }, null, { timeout: 8000 });
      // 관리자 쪽 대기 칩
      const admp = await ctx3.newPage(); admp.on('pageerror', e => errs.push(e.message));
      await loginAs(admp, 'supervisor', 'admin_super', ''); await admp.waitForFunction(() => { const c = document.getElementById('adm-consent-chip'); return c && !c.hidden && /대기 1건/.test(c.textContent); }, null, { timeout: 8000 });
      console.log('✔ 카마스터 알림 배지 · 관리자 "열람 동의 대기 1건" 칩');
      await adm.evaluate((i) => { const c = Store.latestChatConsent(i); Store.respondChatConsent(c.id, 'customer', false); }, cid);
      await admp.waitForFunction(() => /거부됐어요/.test((document.getElementById('vlp-toast') || { textContent: '' }).textContent), null, { timeout: 8000 });
      console.log('✔ 거부 결과가 관리자에게 알림(토스트)으로 전달');
      await ctx3.close();
    }
    // 좁은 창: 스크롤 막대가 생겨 본문 틀이 옆으로 밀려도 대화창이 틀에 맞게 다시 놓인다
    {
      const b2 = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
      try {
        const p2 = await (await b2.newContext({ viewport: { width: 1150, height: 800 } })).newPage(); p2.on('pageerror', e => errs.push(e.message));
        await p2.goto(BASE + '/demo.html?nosw=1'); await p2.click('#load'); await p2.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
        await p2.goto(BASE + '/admin.html?nosw=1'); await p2.evaluate(() => { window.tryLogin(Store.getAdmins().find(x => x.adminScope === 'community').id, 'delivery'); });
        await p2.waitForSelector('.vlp-app-admin .vlp-case-row'); await p2.locator('.vlp-app-admin .vlp-case-row').nth(2).click(); await p2.waitForSelector('.vlp-case-chat'); await p2.click('.vlp-case-chat'); await p2.waitForSelector('.vlp-chatdock');
        await p2.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.body.appendChild(d); }); await p2.waitForTimeout(600);
        const m = await p2.evaluate(() => { const d = document.querySelector('.vlp-chatdock').getBoundingClientRect(), x = document.querySelector('.vlp-adm-main').getBoundingClientRect(); return [Math.round(d.left), Math.round(d.right), Math.round(x.left), Math.round(x.right)]; });
        assert.ok(Math.abs(m[0] - m[2]) <= 1 && Math.abs(m[1] - m[3]) <= 1, '대화창이 본문 틀과 어긋남 ' + JSON.stringify(m));
        const navTop = await p2.evaluate(() => Math.round(document.querySelector('.vlp-adm-nav').getBoundingClientRect().top)), dockTop = await p2.evaluate(() => Math.round(document.querySelector('.vlp-chatdock').getBoundingClientRect().top));
        assert.ok(dockTop <= navTop + 1, '좁은 창에서 대화창은 위쪽 메뉴 줄(건 목록·예외 큐…)까지 덮음 ' + dockTop + '/' + navTop);
        const rbi = await p2.evaluate(() => { const r = document.querySelector('#vlp-rolebar'); return { has: !!r, text: r ? r.innerText.replace(/\s+/g, ' ') : '', old: !!document.querySelector('.navbar'), foot: !!document.querySelector('.footer-note') }; });
        assert.ok(rbi.has && /관리자|슈퍼바이저/.test(rbi.text) && /실시간 동기화/.test(rbi.text) && !rbi.old && !rbi.foot, '관리자도 다른 역할과 같은 상단 띠 ' + JSON.stringify(rbi));
        console.log('✔ 관리자 상단이 다른 역할과 같은 역할 띠');
        console.log('✔ 스크롤 막대가 생겨도 대화창이 본문 틀에 맞게 다시 놓임');
      } finally { await b2.close(); }
    }
    assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('\n--- 대화 열람 동의 통과 ---');
  } catch (e) { console.error('FAIL', e.stack || e.message); process.exitCode = 1; } finally { await b.close(); }
})();
