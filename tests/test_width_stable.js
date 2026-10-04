// 필터 칩을 눌러 화면을 다시 만들 때 화면 가로 폭이 순간적으로 달라지지 않는다(세로 스크롤 막대가 생겼다 사라지며 15px 흔들리던 것, 메뉴가 전부 보였다 줄던 것)
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 820, height: 1100 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, 'supervisor', 'admin_super', ''); await p.waitForTimeout(1500);
    const go = async (m) => { const vis = await p.evaluate((x) => document.querySelector('.vlp-adm-nav-btn[data-menu=' + x + ']').offsetWidth > 0, m); if (vis) await p.click('.vlp-adm-nav-btn[data-menu=' + m + ']'); else { await p.click('.vlp-adm-ovf'); await p.click('.vlp-adm-mi[data-menu=' + m + ']'); } await p.waitForTimeout(1200); };
    for (const [menu, chips] of [['care', ['견적', '품질 이의', '전체']], ['cases', ['배송 중', '전체']]]) {
      await go(menu);
      for (const t of chips) {
        await p.evaluate(() => { window.__w = new Set(); window.__n = 0; const tick = () => { const a = document.querySelector('.vlp-adm'); window.__w.add(document.documentElement.clientWidth + '/' + (a ? Math.round(a.getBoundingClientRect().width) : -1)); if (window.__n++ < 50) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        await p.locator('.vlp-chip', { hasText: t }).first().click(); await p.waitForTimeout(1000);
        const w = await p.evaluate(() => [...window.__w]); assert.strictEqual(w.length, 1, menu + ' · ' + t + ': 화면 가로 폭이 변하지 않음 ' + JSON.stringify(w));
      }
    }
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_width_stable');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
