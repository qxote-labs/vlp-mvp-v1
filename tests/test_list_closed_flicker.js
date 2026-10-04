// 목록을 접은 상태에서 필터 칩을 눌러 화면이 다시 만들어질 때, 새 화면이 처음부터 접힌 모양(list-closed)으로 붙는다(목록이 한 번 보였다 사라지는 깜박임 방지)
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, 'supervisor', 'admin_super', '');
    await p.click('.vlp-adm-nav-btn[data-menu=care]'); await p.waitForSelector('.vlp-case-row');
    await p.locator('.vlp-list-toggle:visible').first().click(); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__bad = 0; window.__seen = 0; new MutationObserver((ms) => { ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { const a = n.matches && n.matches('.vlp-app') ? n : (n.querySelector && n.querySelector('.vlp-app')); if (a) { window.__seen++; if (!a.classList.contains('list-closed')) window.__bad++; } } })); }).observe(document.body, { childList: true, subtree: true }); });
    for (const t of ['견적', '품질 이의', '전체']) { await p.locator('.vlp-chip', { hasText: t }).first().click(); await p.waitForTimeout(500); }
    const r = await p.evaluate(() => ({ bad: window.__bad, seen: window.__seen }));
    assert.ok(r.seen >= 3 && r.bad === 0, '새로 붙는 화면이 처음부터 접힌 모양 ' + JSON.stringify(r));
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_list_closed_flicker');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
