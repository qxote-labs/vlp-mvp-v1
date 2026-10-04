// 관리자 전용: 운영 메모와 관리자 처리 기록 (인도·케어 공통, 고객·시공사에는 보이지 않음)
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await ctx.newPage(); a.on('pageerror', e => errs.push(e.message));
    await a.goto(BASE + '/demo.html?nosw=1'); await a.click('#load'); await a.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(a, 'supervisor', 'admin_super', '');
    const nv = await a.evaluate(() => { const n = document.querySelector('.vlp-adm-nav'); return [n.scrollHeight, n.clientHeight]; });
    assert.ok(nv[0] <= nv[1], '상단 메뉴 줄에 세로 스크롤이 생기지 않음 ' + nv);
    assert.strictEqual(await a.locator('.vlp-adm-nav-btn .vlp-adm-ico').count() >= 6, true, '관리자 메뉴 앞에 아이콘');
    { const ph = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage(); await ph.goto(BASE + '/supervisor.html'); await ph.evaluate(() => { sessionStorage.clear(); });
      await loginAs(ph, 'supervisor', 'admin_super', ''); await ph.waitForSelector('.vlp-adm-more');
      const vis = await ph.evaluate(() => [...document.querySelectorAll('.vlp-adm-nav-btn')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.dataset.menu));
      assert.deepStrictEqual(vis, ['home'], '폰에서는 [홈] + 드롭다운만 보임 ' + vis);
      assert.ok(await ph.locator('.vlp-adm-panel').isHidden(), '처음엔 닫힘'); await ph.click('.vlp-adm-more'); await ph.waitForSelector('.vlp-adm-mi');
      assert.ok((await ph.locator('.vlp-adm-mi').count()) >= 5 && /로그아웃/.test(await ph.locator('.vlp-adm-panel').innerText()), '모든 메뉴가 라벨과 함께 목록에');
      await ph.keyboard.press('Escape'); assert.ok(await ph.locator('.vlp-adm-panel').isHidden(), 'Esc로 닫힘');
      await ph.click('.vlp-adm-more'); await ph.locator('.vlp-adm-mi[data-menu=care]').click(); await ph.waitForSelector('#admin-care-list');
      assert.ok(/신차 케어/.test(await ph.locator('.vlp-adm-more .vlp-adm-lbl').innerText()), '고른 메뉴 이름이 버튼에 보임');
      const ov = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(ov <= 1, '가로 넘침 없음 ' + ov); }
    // 케어 건: 운영 탭에 메모 + 기록
    await a.click('.vlp-adm-nav-btn[data-menu=care]'); await a.waitForSelector('#admin-care-list .vlp-case-row');
    await a.locator('#admin-care-list .vlp-case-row', { hasText: '20-202601-9001' }).first().click(); await a.waitForSelector('#admin-care-detail');
    await a.locator('#admin-care-detail .vlp-tabs [role=tab]', { hasText: '운영' }).click();
    await a.waitForSelector('.vlp-admin-notes'); assert.ok(await a.locator('.vlp-an-add').isDisabled(), '빈 메모는 추가 못 함');
    await a.fill('.vlp-admin-notes textarea', '고객 전화 확인 완료 — 내일 입고 예정'); await a.click('.vlp-an-add');
    await a.waitForFunction(() => /고객 전화 확인 완료/.test(document.querySelector('.vlp-admin-notes .vlp-an-list').innerText));
    assert.ok(/운영 메모 작성/.test(await a.locator('.vlp-admin-log').innerText()), '메모 작성이 처리 기록에 남음');
    // 대리 처리 버튼 → 기록
    const btn = a.locator('#care-action-inner button:not([disabled])').first(); const label = (await btn.innerText()).trim();
    await btn.click(); await a.waitForTimeout(400);
    await a.locator('#admin-care-detail .vlp-tabs [role=tab]', { hasText: '운영' }).click();
    assert.ok(/대리 처리 ·/.test(await a.locator('.vlp-admin-log').innerText()), '대리 처리 기록: ' + label);
    console.log('✔ 케어: 운영 메모 추가 · 대리 처리가 관리자 처리 기록에 남음');
    // 인도 건: 운영 탭 + 지연 안내 기록
    await a.click('.vlp-adm-nav-btn[data-menu=cases]'); await a.waitForSelector('.vlp-app-admin .vlp-case-row');
    await a.locator('.vlp-app-admin .vlp-case-row').first().click(); await a.waitForSelector('.vlp-admin-notes');
    await a.fill('.vlp-admin-notes textarea', '탁송사에 전화함'); await a.click('.vlp-an-add');
    await a.waitForFunction(() => /탁송사에 전화함/.test((document.querySelector('.vlp-admin-notes .vlp-an-list') || { innerText: '' }).innerText));
    console.log('✔ 인도: 운영 탭에 같은 메모·기록 카드');
    // 고객·시공사 화면에는 없다
    const c = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage(); c.on('pageerror', e => errs.push(e.message));
    await loginAs(c, 'customer', { name: '홍길동', phone: '010-9000-0001' }, '');
    await c.waitForTimeout(800); assert.strictEqual(await c.locator('.vlp-admin-notes, .vlp-admin-log').count(), 0, '고객 화면에 관리자 카드 없음');
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('\n--- 관리자 운영 메모·처리 기록 통과 ---');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
