// 태블릿 세로: 카마스터·시공사·관리자 목록|상세 2단 화면에서 목록을 접으면 상세가 전체 폭이 되고, 폰에서는 버튼이 없다.
const { chromium } = require('playwright'); const assert = require('assert'); const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
    const d = await ctx.newPage(); await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load'); await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const check = async (p, name) => {
      p.on('pageerror', (e) => errs.push(e.message));
      await p.waitForSelector('.vlp-case-row', { timeout: 15000 }); if (!(await p.locator('.vlp-case').count())) await p.locator('.vlp-app-list .vlp-case-row, .vlp-case-row').first().click(); await p.waitForSelector('.vlp-case');
      const w = () => p.evaluate(() => ({ list: getComputedStyle(document.querySelector('.vlp-app-list')).display, det: document.querySelector('.vlp-app-detail').getBoundingClientRect().width }));
      const open = await w(); assert.notStrictEqual(open.list, 'none', name + ' 처음엔 목록이 보임');
      await p.locator('.vlp-list-toggle').click(); await p.waitForTimeout(250);
      const closed = await w(); assert.strictEqual(closed.list, 'none', name + ' 접힘'); assert.ok(closed.det > open.det * 1.6, name + ' 상세가 넓어짐 ' + open.det + '→' + closed.det);
      assert.ok(await p.locator('.vlp-nav-btn, .vlp-chip').first().isVisible(), name + ' 상단 메뉴·필터 유지');
      await p.locator('.vlp-list-toggle').click(); await p.waitForTimeout(250); assert.notStrictEqual((await w()).list, 'none', name + ' 다시 펼침');
      await p.setViewportSize({ width: 430, height: 900 }); await p.waitForTimeout(250); assert.strictEqual(await p.locator('.vlp-list-toggle').isVisible(), false, name + ' 폰에서는 버튼 없음');
      console.log('✔', name);
    };
    const k = await ctx.newPage(); await k.goto(BASE + '/karmaster.html?nosw=1&demoKm=k1'); const nav = k.locator('.vlp-nav-btn[data-tab=clients]').first(); await nav.waitFor({ state: 'attached', timeout: 15000 }); if (!(await k.locator('.vlp-chip').count())) await nav.click(); await check(k, '카마스터');
    const s = await ctx.newPage(); await s.goto(BASE + '/shop.html?nosw=1'); await s.selectOption('#quick-login', 'a'); await check(s, '시공사');
    const a = await ctx.newPage(); await a.goto(BASE + '/admin.html?nosw=1'); await a.selectOption('#quick-login', 'admin_ulsan'); await check(a, '관리자');
    assert.deepStrictEqual(errs, []); console.log('PASS test_list_collapse');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
