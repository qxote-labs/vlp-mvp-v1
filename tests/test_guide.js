// 단계 설명 ▾ 와 전체 과정 안내 시트(처음 들어온 고객에게 1회)
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const errs = [];
  try {
    const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const href = await d.getAttribute('#l-cust', 'href');
    // 자동화 브라우저에서는 ?guide=1일 때만 안내 시트가 자동으로 열린다
    const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message));
    await c.goto(BASE + '/' + href + '&nosw=1&guide=1');
    await UI.custOpen(c, '쏘렌토');
    await c.waitForSelector('.vlp-sheet', { timeout: 5000 });
    assert.ok((await c.locator('.vlp-sheet').first().textContent()).includes('전체 과정 안내'));
    assert.strictEqual(await c.locator('.vlp-guide li').count(), 5);
    console.log('✔ 처음 들어오면 전체 과정 안내 시트(5단계)');
    await c.click('.vlp-guide-ok'); await c.waitForSelector('.vlp-sheet', { state: 'detached' });
    console.log('✔ 확인하면 닫힘');
    // 단계 설명 ▾
    assert.strictEqual(await c.locator('.vlp-step-desc').isHidden(), true);
    await c.click('.vlp-case-stp');
    assert.strictEqual(await c.locator('.vlp-step-desc li').count(), 5);
    assert.strictEqual(await c.locator('.vlp-step-desc').isVisible(), true);
    assert.strictEqual(await c.getAttribute('.vlp-case-stp', 'aria-expanded'), 'true');
    await c.click('.vlp-case-stp'); assert.strictEqual(await c.locator('.vlp-step-desc').isHidden(), true);
    console.log('✔ ▾ 로 5단계 설명 펼치기/접기');
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 단계 설명·전체 과정 안내 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
