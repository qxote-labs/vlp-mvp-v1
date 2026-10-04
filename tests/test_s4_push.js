// S4 PWA-24: 알림 "열기" · 딥링크로 해당 카드가 펼쳐진다 · 푸시 설정 안내(제공자 미정)
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  const hook = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(n + ' console: ' + m.text()); }); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const custHref = BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1';
    const c = await ctx.newPage(); hook(c, 'cust'); await c.setViewportSize({ width: 360, height: 740 });
    await c.goto(custHref); await c.waitForSelector('.vlp-nav-btn');
    const ids = await c.evaluate(async () => { const l = await VLP.api.contracts.list({}); return l.items.map(x => ({ c: x.contractId, d: x.deliveryId })); });
    const target = ids.find(x => x.d) || ids[0];
    // 닫혀 있는 카드가 딥링크로 열린다
    await c.goto(custHref + '&open=contract:' + target.c); await c.waitForSelector('.vlp-case');
    await c.waitForFunction((id) => document.querySelector('.vlp-case').dataset.contractId === id, target.c);
    assert.ok(!/open=/.test(await c.evaluate(() => location.search)), '주소에서 open 제거');
    ok('?open=contract:<id> → 해당 계약 상세가 열림, 주소의 open 값 정리');
    // 알림 패널의 "열기"
    await c.goto(custHref); await c.waitForSelector('.vlp-notes-head'); await c.click('.vlp-notes-head');
    const hasOpen = await c.locator('.vlp-note-open').count();
    if (hasOpen) { const href = await c.locator('.vlp-note-open').first().getAttribute('href'); assert.ok(/^customer\.html\?open=(contract|delivery)%3A/.test(href), href); ok('알림 행에 [열기] 링크 ' + href); }
    assert.ok(/준비 중/.test(await c.locator('.vlp-pushrow').textContent()));
    ok('푸시 제공자 미설정: "준비 중" 안내만(앱 안 알림 계속 사용)');
    // 잘못된 값은 무시
    await c.goto(custHref + '&open=contract:../../x'); await c.waitForSelector('.vlp-nav-btn');
    ok('이상한 open 값은 무시되고 화면이 정상 표시');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S4 PWA-24 딥링크 통과 ---');
})();
