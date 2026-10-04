// 관리자 홈(오늘 처리할 건): 급한 순서 · 홈에서 연 건의 "← 홈으로" · 처리 후 안내 · 🏠 점 · 커뮤니티관리자 범위 제한
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, 'supervisor', 'admin_super', '');
    await p.click('.vlp-adm-nav-btn[data-menu=home]'); await p.waitForSelector('.vlp-home-row');
    const first = await p.locator('.vlp-home-row').first().innerText();
    assert.ok(/운영자 중재 필요/.test(first), '가장 급한 항목이 맨 위: ' + first);
    assert.ok(/오늘 처리할 건 \d+/.test(await p.locator('.vlp-home-sum').innerText()));
    assert.ok(/●\d+/.test(await p.locator('.vlp-adm-nav-btn[data-menu=home]').innerText()), '홈 메뉴에 건수 점');
    console.log('✔ 슈퍼바이저 홈: 급한 순서 · 건수 · 🏠 점');
    // 예외 큐 숫자는 어느 메뉴로 옮겨도(메뉴줄을 다시 만들어도) 사라졌다 나타나지 않는다
    await p.waitForFunction(() => { const d = document.querySelector('.vlp-adm-nav-btn[data-menu=exceptions] .vlp-adm-dot'); return d && !d.hidden; });
    for (const m of ['users', 'care', 'shops', 'dispute', 'cases']) { await p.click('.vlp-adm-nav-btn[data-menu=' + m + ']'); assert.ok(await p.evaluate(() => { const d = document.querySelector('.vlp-adm-nav-btn[data-menu=exceptions] .vlp-adm-dot'); return !!d && !d.hidden && /●\d/.test(d.textContent); }), '예외 큐 숫자 유지: ' + m); }
    console.log('✔ 예외 큐 숫자가 메뉴를 옮겨도 유지');
    await p.click('.vlp-adm-nav-btn[data-menu=home]'); await p.waitForSelector('.vlp-home-row');
    // 열기 → 크럼 → 홈으로
    await p.locator('.vlp-home-row[data-home=escalated]').click(); await p.waitForSelector('#admin-care-detail');
    assert.ok(/홈에서 열었어요/.test(await p.locator('.vlp-home-crumb').innerText()), '크럼 표시');
    await p.locator('.vlp-home-crumb button').click(); await p.waitForSelector('.vlp-home-row');
    assert.strictEqual(await p.locator('.vlp-home-crumb').count(), 0);
    // 중재 완료 → 안내 배너
    await p.locator('.vlp-home-row[data-home=escalated]').click(); await p.waitForSelector('#a-resolve-dispute'); await p.click('#a-resolve-dispute');
    await p.waitForSelector('.vlp-home-done'); assert.ok(/처리했어요/.test(await p.locator('.vlp-home-done').innerText()));
    await p.locator('.vlp-home-done button', { hasText: '홈으로' }).click(); await p.waitForSelector('.vlp-home-row');
    assert.ok(await p.locator('.vlp-home-row[data-home=escalated]').isDisabled(), '처리된 항목은 0건으로');
    console.log('✔ 홈에서 연 건: ← 홈으로 · 처리 후 안내 · 홈 갱신');
    // 인도 건 열기
    const ex = p.locator('.vlp-home-row[data-home=exception]:not([disabled])');
    if (await ex.count()) { await ex.click(); await p.waitForSelector('.vlp-home-crumb'); await p.locator('.vlp-home-crumb button').click(); await p.waitForSelector('.vlp-home-row'); console.log('✔ 인도 지연 건에서도 홈으로 복귀'); }
    // 커뮤니티관리자
    const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); c.on('pageerror', e => errs.push(e.message));
    await c.goto(BASE + '/demo.html?nosw=1'); await c.click('#load'); await c.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(c, 'admin', 'admin_ulsan', '');
    await c.click('.vlp-adm-nav-btn[data-menu=home]'); await c.waitForSelector('.vlp-home-row');
    const cnt = async (pg) => { await pg.waitForFunction(() => ![...document.querySelectorAll('.vlp-home-row .hn')].some(n => n.textContent === '…')); return pg.evaluate(() => [...document.querySelectorAll('.vlp-home-row')].reduce((n, r) => n + (+r.querySelector('.hn').textContent || 0), 0)); };
    const sup = await (async () => { const s = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); await s.goto(BASE + '/demo.html?nosw=1'); await s.click('#load'); await s.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent)); await loginAs(s, 'supervisor', 'admin_super', ''); await s.click('.vlp-adm-nav-btn[data-menu=home]'); await s.waitForSelector('.vlp-home-row'); return cnt(s); })();
    assert.ok(await cnt(c) <= sup, '커뮤니티관리자는 담당 범위만(슈퍼바이저 이하)');
    console.log('✔ 커뮤니티관리자 홈: 범위 제한 적용');
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_admin_home');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
