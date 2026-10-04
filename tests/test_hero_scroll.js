// 상세 위쪽 상태 요약(그래프·다음 안내)은 폰에서만 스크롤에 따라 한 줄로 줄고, 태블릿·PC에서는 스크롤해도 그대로
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
async function openCase(b, vp) {
  const p = await (await b.newContext({ viewport: vp })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
  await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
  await loginAs(p, 'supervisor', 'admin_super', '');
  if (vp.width < 768) { await p.click('.vlp-adm-more'); await p.click('.vlp-adm-mi[data-menu=exceptions]'); } else await p.click('.vlp-adm-nav-btn[data-menu=exceptions]');
  await p.waitForSelector('.vlp-case-row'); await p.locator('.vlp-case-row').first().click(); await p.waitForSelector('.vlp-case-hero'); await p.waitForTimeout(500); return p;
}
(async () => {
  const b = await chromium.launch();
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 1000, height: 640 }]) {
      const p = await openCase(b, vp);
      await p.evaluate(() => { const d = document.querySelector('.vlp-app-detail'); if (d) d.scrollTop = 300; window.scrollTo(0, 300); });
      await p.waitForTimeout(500); assert.strictEqual(await p.evaluate(() => document.querySelector('.vlp-case-hero').classList.contains('c')), false, '태블릿·PC는 스크롤해도 상태 요약이 그대로 ' + vp.width + 'x' + vp.height);
      assert.deepStrictEqual(p.errs, []);
    }
    console.log('✔ 태블릿·PC: 스크롤해도 상세 상태 요약이 줄지 않음 (칸 모드·창 스크롤 모두)');
    const ph = await openCase(b, { width: 390, height: 800 });
    await ph.evaluate(() => window.scrollTo(0, 400)); await ph.waitForTimeout(500);
    assert.strictEqual(await ph.evaluate(() => document.querySelector('.vlp-case-hero').classList.contains('c')), true, '폰은 스크롤하면 한 줄로 줄어듦');
    console.log('✔ 폰: 스크롤하면 한 줄로 줄어듦 (공간이 좁아서)\nPASS test_hero_scroll');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
