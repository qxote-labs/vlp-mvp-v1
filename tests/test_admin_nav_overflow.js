// 관리자 상단 메뉴(≥768px): 가로 스크롤 막대 없이, 들어가는 만큼만 보이고 넘치는 메뉴는 로그아웃 앞 [⋯ n] 목록으로. 선택한 메뉴는 항상 보임.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    for (const w of [820, 1024, 1100, 1280]) {
      const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await loginAs(p, 'supervisor', 'admin_super', ''); await p.waitForTimeout(1200);
      const st = () => p.evaluate(() => { const n = document.querySelector('.vlp-adm-nav'), o = document.querySelector('.vlp-adm-ovf'); const vis = [...n.querySelectorAll('.vlp-adm-nav-btn')].filter(x => x.offsetWidth > 0).map(x => x.dataset.menu); const all = [...n.querySelectorAll('.vlp-adm-nav-btn')].map(x => x.dataset.menu).filter(m => m !== 'logout'); const hid = all.filter(m => !vis.includes(m)); const dn = (m) => { const d = n.querySelector('.vlp-adm-nav-btn[data-menu=' + m + '] .vlp-adm-dot'); return d && !d.hidden ? (parseInt(d.textContent.replace(/\D/g, ''), 10) || 1) : 0; }; const od = o.querySelector('.vlp-adm-dot'); const ln = n.querySelector('[data-menu=logout]').getBoundingClientRect(), ob = o.getBoundingClientRect(); return { over: n.scrollWidth - n.clientWidth, ovf: !o.hidden && o.offsetWidth > 0, hid, vis, cur: (n.querySelector('[aria-current=page]') || {}).dataset ? n.querySelector('[aria-current=page]').dataset.menu : '', sum: hid.reduce((a, m) => a + dn(m), 0), shown: od && !od.hidden ? parseInt(od.textContent.replace(/\D/g, ''), 10) : 0, num: o.querySelector('.vlp-adm-ovn').textContent, before: !o.hidden && ob.right <= ln.left + 1 }; });
      let s = await st();
      assert.ok(s.over <= 1, w + ': 가로 스크롤 없음 ' + JSON.stringify(s));
      if (w >= 1280) { assert.ok(!s.ovf && s.hid.length === 0, w + ': 충분히 넓으면 전부 보임 ' + JSON.stringify(s)); continue; }
      assert.ok(s.ovf && s.hid.length > 0, w + ': 넘치면 [⋯] 표시 ' + JSON.stringify(s));
      assert.ok(s.before, w + ': [⋯]는 로그아웃 앞');
      assert.strictEqual(String(s.hid.length), s.num, w + ': 숨은 개수 표시'); assert.strictEqual(s.shown, s.sum, w + ': 숨은 메뉴 알림 합계 표시 ' + JSON.stringify(s));
      // 열기·키보드·이동
      await p.click('.vlp-adm-ovf'); assert.ok(await p.locator('.vlp-adm-ovp .vlp-adm-mi').count() === s.hid.length, w + ': 목록 항목 수');
      await p.keyboard.press('Escape'); assert.ok(await p.locator('.vlp-adm-ovp').isHidden(), w + ': Esc로 닫힘');
      const target = s.hid[s.hid.length - 1];
      await p.click('.vlp-adm-ovf'); await p.click('.vlp-adm-ovp .vlp-adm-mi[data-menu=' + target + ']'); await p.waitForTimeout(900);
      s = await st(); assert.ok(s.over <= 1 && s.cur === target && s.vis.includes(target), w + ': 목록에서 고른 메뉴로 이동·항상 보임 ' + JSON.stringify(s));
      await p.context().close();
    }
    // 터치(탭)로 열기: 목록이 실제로 화면 안에 보이고(잘리거나 가려지지 않음), 각 항목을 눌러 이동할 수 있다
    for (const [w, h] of [[820, 1180], [1024, 768]]) {
      const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage(); p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await loginAs(p, 'supervisor', 'admin_super', ''); await p.waitForTimeout(1200);
      await p.locator('.vlp-adm-ovf').tap(); await p.waitForTimeout(500);
      const r = await p.evaluate(() => { const pan = document.querySelector('.vlp-adm-ovp'), q = pan.getBoundingClientRect(), cs = getComputedStyle(pan); const items = [...pan.querySelectorAll('.vlp-adm-mi')];
        const hit = items.map((it) => { const b = it.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && (it === e || it.contains(e)); });
        return { hidden: pan.hidden, pos: cs.position, inView: q.left >= 0 && q.right <= innerWidth && q.top >= 0 && q.bottom <= innerHeight, hit, n: items.length }; });
      assert.ok(!r.hidden && r.pos === 'fixed' && r.inView && r.n > 0 && r.hit.every(Boolean), w + ': 탭으로 연 목록이 화면 안에 보이고 눌림 ' + JSON.stringify(r));
      await p.locator('.vlp-adm-ovp .vlp-adm-mi').last().tap(); await p.waitForTimeout(900);
      assert.ok(await p.locator('.vlp-adm-ovp').isHidden(), w + ': 항목을 탭하면 닫힘');
      await p.context().close();
    }
    assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_admin_nav_overflow');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
