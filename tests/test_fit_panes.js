// 카마스터·시공사 2단: 창이 충분히 높으면 목록·상세가 화면 높이 칸, 각자 스크롤 / 낮은 창은 페이지 스크롤
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (role, id, w, h) => {
    const c = await b.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    await loginAs(p, role, id); await p.waitForSelector('.vlp-app'); await p.click('.vlp-nav-btn[data-tab=clients]'); await p.waitForSelector('.vlp-case-row');
    await p.locator('.vlp-case-row').first().click(); await p.waitForSelector('.vlp-case'); await p.waitForTimeout(600); return p;
  };
  try {
    for (const [role, id] of [['karmaster', 'k1'], ['shop', 'a']]) {
      for (const [w, h] of [[1440, 900], [900, 900]]) {
        const p = await open(role, id, w, h);
        assert.ok(await p.evaluate(() => document.querySelector('.vlp-app').classList.contains('fit-panes')), role + ' ' + w + ': 칸 모드');
        const m = await p.evaluate(() => ({ page: document.documentElement.scrollHeight, vh: innerHeight, lb: document.querySelector('.vlp-app-list').getBoundingClientRect().bottom, db: document.querySelector('.vlp-app-detail').getBoundingClientRect().bottom }));
        assert.ok(Math.abs(m.page - m.vh) <= 1, role + ' ' + w + ': 페이지가 화면 높이를 넘지 않음 ' + JSON.stringify(m));
        assert.ok(Math.abs(m.lb - m.db) <= 1 && m.lb < m.vh, '목록·상세 아래끝이 같고 화면 안');
        assert.ok(await p.evaluate(() => document.querySelector('.vlp-app-list').classList.contains('more-below')), '목록 아래에 더 있음 표시');
        await p.mouse.move(150, 500); await p.mouse.wheel(0, 300); await p.waitForTimeout(250);
        const s = await p.evaluate(() => ({ y: scrollY, lt: document.querySelector('.vlp-app-list').scrollTop }));
        assert.strictEqual(s.y, 0, '목록 스크롤이 페이지를 움직이지 않음'); assert.ok(s.lt > 0, '목록이 스크롤됨');
        await p.evaluate(() => { const l = document.querySelector('.vlp-app-list'); l.scrollTop = l.scrollHeight; }); await p.waitForTimeout(400);
        assert.ok(!(await p.evaluate(() => document.querySelector('.vlp-app-list').classList.contains('more-below'))), '끝까지 내리면 표시 사라짐');
        await p.context().close();
      }
    }
    console.log('✔ 카마스터·시공사: 칸 모드(≥700px) — 페이지 고정, 목록 독립 스크롤, 더 있음 표시');
    // 필터를 바꾸면 목록에 없는 건은 상세에 남지 않고, 맨 위 건이 열린다
    {
      const check = async (p, chipSel, label) => {
        const n = await p.locator(chipSel).count(); let hit = false;
        for (let i = 0; i < n; i++) {
          const chip = p.locator(chipSel).nth(i); if (/ 0$/.test((await chip.innerText()).replace(/\s+/g, ' ').trim())) continue;
          await chip.click(); await p.waitForTimeout(500);
          const st = await p.evaluate(() => { const rows = [...document.querySelectorAll('.vlp-app-list .vlp-case-row')]; const on = document.querySelector('.vlp-app-list .vlp-case-row.on, .vlp-app-list .vlp-case-row[aria-current=true]'); return { rows: rows.length, onInList: !!on, detail: !!document.querySelector('.vlp-app-detail .vlp-case') }; });
          assert.ok(st.rows === 0 || (st.onInList && st.detail), label + ': 목록의 선택 항목과 상세가 일치 ' + JSON.stringify(st)); hit = true;
        }
      };
      let p = await open('karmaster', 'k1', 1440, 900); await check(p, '.vlp-chip-row .vlp-chip:not(.zero)', '카마스터'); await p.context().close();
      p = await open('shop', 'a', 1440, 900); await check(p, '.sc-queues .vlp-chip:not(.zero)', '시공사'); await p.context().close();
      console.log('✔ 필터 변경 시 목록과 상세가 일치(카마스터·시공사)');
    }
    // 관리자 건 목록도 칸 모드 + ⋯(개입) 메뉴는 구분되는 버튼 카드
    {
      const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); const a = await c.newPage(); a.on('pageerror', e => errs.push(e.message));
      await a.goto(BASE + '/demo.html?nosw=1'); await a.click('#load'); await a.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await a.goto(BASE + '/admin.html?nosw=1'); await a.evaluate(() => { window.tryLogin(Store.getAdmins().find(x => x.adminScope === 'super').id, 'delivery'); });
      await a.waitForSelector('.vlp-app-admin .vlp-case-row'); await a.locator('.vlp-app-admin .vlp-case-row').first().click(); await a.waitForSelector('.vlp-intervene-btn'); await a.waitForTimeout(500);
      const m = await a.evaluate(() => ({ fit: document.querySelector('.vlp-app-admin').classList.contains('fit-panes'), page: document.documentElement.scrollHeight, vh: innerHeight, more: document.querySelector('.vlp-app-list').classList.contains('more-below') }));
      assert.ok(m.fit && Math.abs(m.page - m.vh) <= 1 && m.more, '관리자 칸 모드 ' + JSON.stringify(m));
      await a.locator('.vlp-list-toggle:visible').first().click(); await a.waitForTimeout(500); // 목록 접어도 같은 칸 높이(창 스크롤 없음)
      const mc = await a.evaluate(() => ({ closed: document.querySelector('.vlp-app-admin').classList.contains('list-closed'), fit: document.querySelector('.vlp-app-admin').classList.contains('fit-panes'), page: document.documentElement.scrollHeight, vh: innerHeight, db: Math.round(document.querySelector('.vlp-app-detail').getBoundingClientRect().bottom) }));
      assert.ok(mc.closed && mc.fit && Math.abs(mc.page - mc.vh) <= 1 && mc.db < mc.vh, '목록을 접어도 칸 모드 유지 ' + JSON.stringify(mc));
      await a.locator('.vlp-list-toggle:visible').first().click(); await a.waitForTimeout(300);
      await a.click('.vlp-intervene-btn'); await a.waitForSelector('.vlp-menu-item');
      const it = await a.evaluate(() => [...document.querySelectorAll('.vlp-menu-item')].map(e => { const s = getComputedStyle(e); return { b: s.borderTopWidth, r: s.borderTopLeftRadius }; }));
      assert.ok(it.length >= 2 && it.every(x => x.b === '1px' && parseInt(x.r) >= 8), '메뉴 항목이 테두리·둥근 모서리 버튼');
      {
        const sel = await a.evaluate(() => location.hash);
        await a.evaluate(() => document.querySelectorAll('.vlp-sheet, .vlp-sheet-back').forEach(e => e.remove()));
        await a.locator('.vlp-chip[data-filter=done]').click(); await a.waitForTimeout(500);
        const r = await a.evaluate((h) => ({ same: location.hash === h, rows: document.querySelectorAll('.vlp-app-list .vlp-case-row').length, on: !!document.querySelector('.vlp-app-list .vlp-case-row.on, .vlp-app-list .vlp-case-row[aria-current=true]'), detail: !!document.querySelector('.vlp-app-detail .vlp-case') }), sel);
        assert.ok(!r.same && r.on && r.detail && r.rows > 0, '관리자: 필터로 빠진 건 대신 맨 위 건이 열림 ' + JSON.stringify(r));
      }
      await c.close();
      console.log('✔ 관리자 칸 모드 + 메뉴 항목 버튼 스타일');
    }
    const q = await open('karmaster', 'k1', 1440, 640);
    assert.ok(!(await q.evaluate(() => document.querySelector('.vlp-app').classList.contains('fit-panes'))), '낮은 창은 칸 모드 아님');
    assert.ok(await q.evaluate(() => document.documentElement.scrollHeight > innerHeight), '낮은 창은 페이지 스크롤');
    console.log('✔ 낮은 창(<700px)은 페이지 전체 스크롤');
    assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('\n--- 칸 모드 통과 ---');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
