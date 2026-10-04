// 시연 페이지 ⑥ 배송 진행 버튼: 순서대로 누르면 고객 화면 칩이 바뀐다.
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  const hook = (p, n) => p.on('pageerror', e => errs.push(n + ': ' + e.message));
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const c = await ctx.newPage(); hook(c, 'cust');
    await c.goto(BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1'); await c.waitForSelector('.vlp-nav-btn');
    const seq = [['dispatch', '배차 완료'], ['transit', '탁송 중'], ['stale', '탁송 중'], ['location', '탁송 중'], ['delay', '지연·예외'], ['resolve', '탁송 중'], ['custom', '시공 중'], ['arrive', '도착']];
    for (const [step, expect] of seq) {
      await d.click('[data-step=' + step + ']');
      await d.waitForFunction((s) => /완료:/.test(document.querySelector('#step-status').textContent), step);
      await c.reload(); await UI.custOpen(c, '아이오닉');
      const chip = (await c.locator('.vlp-case .vlp-state-chip').first().textContent()).replace(/^[^가-힣]+/, '');
      assert.strictEqual(chip, expect, step + ' 다음 칩: ' + chip);
      console.log('✔ ' + step + ' → ' + chip);
      await d.evaluate(() => { document.querySelector('#step-status').textContent = ''; });
    }
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error(errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S2 시연 배송 진행 버튼 통과 ---');
})();
