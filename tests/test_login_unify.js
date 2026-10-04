// 로그인 통합: 시공사·카마스터·구매자 화면은 로그인이 필요하면 app.html(통합 로그인)로 보낸다. 시공사 홈은 오늘/고객 건/메시지/내 정보.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    // 1) 세 역할 화면은 로그인 없이 열면 통합 로그인으로
    for (const [page, role] of [['shop', 'shop'], ['karmaster', 'karmaster'], ['customer', 'customer']]) {
      await p.evaluate(() => sessionStorage.clear());
      await p.goto(BASE + '/' + page + '.html'); await p.waitForURL(/app\.html/, { timeout: 10000 }); await p.waitForSelector('#app-phone');
      assert.ok(p.url().includes('role=' + role), page + ' → role=' + role);
    }
    console.log('✔ 시공사·카마스터·구매자 로그인은 통합 로그인으로 이동');
    // 2) prefill 값이 이어진다 + 시공업체 신규 등록 경로 유지
    await p.evaluate(() => sessionStorage.clear());
    await p.goto(BASE + '/shop.html?prefill=010-3333-4402'); await p.waitForURL(/app\.html/);
    assert.strictEqual(await p.inputValue('#app-phone'), '010-3333-4402');
    await p.click('#app-shop-reg'); await p.waitForURL(/shop\.html\?register=1/); await p.waitForSelector('#rg-submit');
    console.log('✔ 번호 이어받기 · 신규 업체 등록 화면 유지');
    // 3) 로그인 → 시공사 홈: 오늘 / 고객 건 / 메시지 / 내 정보
    await p.evaluate(() => sessionStorage.clear());
    await p.goto(BASE + '/app.html?login=1&role=shop&nosw=1'); await p.fill('#app-phone', '010-3333-4402'); await p.click('#app-go');
    await p.waitForURL(/shop\.html/); await p.waitForSelector('.vlp-app-shop .vlp-nav-btn');
    assert.deepStrictEqual(await p.$$eval('.vlp-app-shop .vlp-nav-btn b', (e) => e.map((x) => x.textContent)), ['오늘', '고객 건', '메시지', '내 정보']);
    assert.strictEqual(await p.getAttribute('.vlp-app-shop', 'data-tab'), 'today');
    await p.waitForSelector('.vlp-kpi-strip');
    assert.ok(await p.locator('.vlp-today-sec').count() > 0 || await p.locator('.vlp-todo-none').count() > 0, '오늘 할 일 영역');
    await p.click('.vlp-nav-btn[data-tab=clients]'); await p.waitForSelector('.sc-queues'); await p.waitForSelector('.vlp-case-row');
    await p.click('.vlp-nav-btn[data-tab=msgs]'); await p.waitForSelector('.vlp-msg-row');
    await p.click('.vlp-nav-btn[data-tab=me]'); await p.waitForSelector('#sc-logout');
    await p.click('#sc-logout'); await p.waitForURL(/app\.html/);
    console.log('✔ 시공사 홈 4개 메뉴 · 로그아웃은 통합 로그인으로');
    assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('PASS test_login_unify');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  finally { await b.close(); }
})();
