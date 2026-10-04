// 역할 전환: 겸임(시공사+고객)인 사람에게만 전환 메뉴가 보이고, 전환하면 그 역할 화면이 열린다.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    for (const [nm, w, h] of [['PC', 1280, 800], ['폰', 390, 760]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      // 단일 역할: 전환 메뉴 없음
      await p.goto(BASE + '/customer.html?nosw=1'); await p.waitForSelector('#quick-login-customer');
      await p.selectOption('#quick-login-customer', '010-7777-1000'); await p.waitForSelector('.vlp-app');
      assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0, nm + ' 단일 고객은 전환 없음');
      await p.goto(BASE + '/shop.html?nosw=1'); await p.selectOption('#quick-login', 'a'); await p.waitForSelector('.vlp-app');
      assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0, nm + ' A샵은 전환 없음');
      await p.goto(BASE + '/karmaster.html?nosw=1'); await p.selectOption('#quick-login', 'k1'); await p.waitForSelector('.vlp-app');
      assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0, nm + ' 카마스터는 전환 없음');
      console.log('✔', nm, '단일 역할은 전환 메뉴 없음');
      // 겸임: 고객으로 로그인
      await p.evaluate(() => sessionStorage.clear());
      await p.goto(BASE + '/customer.html?nosw=1'); await p.waitForSelector('#quick-login-customer');
      assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0, '로그인 전에는 전환 없음');
      await p.selectOption('#quick-login-customer', '010-3333-4402'); await p.waitForSelector('.vlp-app');
      const sw = p.locator('#vlp-rolebar .rb-switch'); await sw.waitFor();
      assert.match(await sw.innerText(), /고객 · 박대표/); assert.strictEqual(await sw.getAttribute('aria-expanded'), 'false');
      await sw.click(); assert.strictEqual(await sw.getAttribute('aria-expanded'), 'true');
      const opts = await p.locator('#vlp-rolebar .rb-opt').allInnerTexts(); assert.strictEqual(opts.length, 2, nm + ' 역할 2개: ' + opts.join('|'));
      assert.ok(/고객/.test(opts[0]) && /현재 역할/.test(opts[0]) && /시공사/.test(opts[1]) && /울산 B샵/.test(opts[1]), opts.join('|'));
      // Esc로 닫고 포커스 복귀
      await p.keyboard.press('Escape'); assert.strictEqual(await p.locator('#vlp-rolebar .rb-menu').count(), 0);
      assert.ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('rb-switch')), 'Esc 후 포커스 복귀');
      // 바깥을 누르면 닫힘
      await sw.click(); await p.mouse.click(5, h - 5); assert.strictEqual(await p.locator('#vlp-rolebar .rb-menu').count(), 0, '바깥 클릭으로 닫힘');
      // 시공사로 전환
      await sw.click(); await Promise.all([p.waitForURL(/shop\.html/), p.locator('#vlp-rolebar .rb-opt[data-role=shop]').click()]);
      await p.waitForSelector('.vlp-case-row');
      assert.match(await p.innerText('#vlp-rolebar'), /시공사 · 울산 B샵/); assert.strictEqual(await p.evaluate(() => sessionStorage.getItem('v6_shop_id')), 'b');
      assert.ok(/20-202601-9002/.test(await p.innerText('.vlp-app-list')), 'B샵 건이 보인다');
      assert.ok(!/20-202601-9020/.test(await p.innerText('.vlp-app-list')), 'B샵 목록에 고객으로 맡긴 건(C샵)은 없다');
      // 되돌아가기: 고객 화면에서 C샵에 맡긴 건이 보인다
      await p.locator('#vlp-rolebar .rb-switch').click(); await Promise.all([p.waitForURL(/customer\.html/), p.locator('#vlp-rolebar .rb-opt[data-role=customer]').click()]);
      await p.waitForSelector('.vlp-app'); assert.match(await p.innerText('#vlp-rolebar'), /고객 · 박대표/);
      await p.locator('.vlp-nav-btn[data-tab=care]').click(); await p.waitForSelector('[data-care-id="20-202601-9020"]');
      console.log('✔', nm, '겸임: 메뉴 열기·Esc·바깥 클릭 닫기·시공사↔고객 전환, 역할별 데이터 분리');
      await ctx.close();
    }
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 역할 전환 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
