// 시연 데이터(demo.html): 한 번에 채워진 5개 상태 + 카마스터 KPI + 조회번호 claim이 바로 동작하는지.
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
    const tok = (await d.textContent('#claim-token')).trim();
    const c = await ctx.newPage(); hook(c, 'cust');
    await c.goto(BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1&sw=chips'); await c.click('.vlp-nav-btn[data-tab=cars]'); await c.waitForSelector('.vlp-case-row, .vlp-car-chip');
    const badges = (await c.locator('.vlp-case-row .vlp-row-badge, .vlp-car-chip .vlp-row-badge').allTextContents()).map(t => t.replace(/^[^가-힣]+/, '')).sort();
    assert.deepStrictEqual(badges, ['거절됨', '승인 대기', '승인됨', '승인됨', '출고 준비']);
    const k = await ctx.newPage(); hook(k, 'km');
    await k.goto(BASE + '/karmaster.html?demoKm=k1&nosw=1'); await UI.ensureClients(k); await k.waitForSelector('.vlp-case-row');
    assert.strictEqual(await UI.chipCount(k, 'pending'), 1);
    assert.strictEqual(await UI.chipCount(k, 'order'), 3); // 카니발·그랜저·레이(승인됨)
    assert.strictEqual(await k.locator('.vlp-app-karmaster .vlp-case-row .vlp-state-chip[data-state=READY]').count(), 2); // 아이오닉 6·팰리세이드
    const n = await ctx.newPage(); hook(n, 'claim');
    await n.goto(BASE + '/karmaster.html?demoClaim=1&nosw=1'); await n.fill('#cl-phone', '010-9999-0009'); await n.fill('#cl-token', tok); await n.fill('#cl-pin', '123456'); await n.click('#cl-submit'); await n.waitForSelector('#cl-pin2:visible'); await n.fill('#cl-pin2', '123456'); await n.click('#cl-submit');
    await n.waitForSelector('.vlp-app-karmaster .vlp-today-row');
    console.log('✔ 데모 데이터: 고객 5상태, 카마스터 승인대기1·출고의뢰2·READY1, 조회번호 claim');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error(errs.join('\n')); process.exitCode = 1; }
  await b.close();
})();
