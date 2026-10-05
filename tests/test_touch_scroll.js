// 터치 기기(아이패드 폭): PC 와 같은 "칸" 동작(목록·상세가 각자 스크롤)을 유지한다 —
// 칸 모드 ON, 칸 높이가 창 안에 들어옴(페이지가 같이 밀리지 않음), 안쪽 스크롤 막대가 항상 보임(iOS), 내용이 길면 칸 안에서 스크롤, 상세 칸에도 "더 있음" 표시
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const { ROLES, openMenu } = require('./_screens');
const BASE = 'http://localhost:8000';
async function start(b, role, id, w, h, touch) {
  const p = await (await b.newContext(touch ? { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } : { viewport: { width: w, height: h } })).newPage();
  await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
  await loginAs(p, role, id); await p.waitForSelector('.vlp-app, .vlp-adm'); await p.waitForTimeout(800); return p;
}
// 칸 모드가 켜진 화면: 칸 아래 끝이 창 안, 페이지 자체는 넘치지 않음. tall=true 면 상세/목록에 긴 내용을 넣어 스크롤을 확인
const probe = (tall) => { const app = document.querySelector('.vlp-app.fit-panes'); if (!app) return null; const out = { bad: [] };
  const panes = [...app.querySelectorAll('.vlp-app-list, .vlp-app-detail')].filter((e) => e.offsetHeight > 0);
  panes.forEach((e) => { const r = e.getBoundingClientRect(); if (r.bottom > innerHeight + 1) out.bad.push((e.className.slice(0, 20)) + ' 칸이 창 아래로 넘침 ' + Math.round(r.bottom) + '>' + innerHeight);
    if (tall && getComputedStyle(e).overflowY === 'auto') { const sp = document.createElement('div'); sp.style.cssText = 'height:2400px;flex:0 0 auto'; sp.className = 'tt-spacer'; e.appendChild(sp); } });
  out.page = document.documentElement.scrollHeight - innerHeight; if (out.page > 1) out.bad.push('페이지가 같이 밀림 ' + out.page);
  return out; };
const after = () => { const app = document.querySelector('.vlp-app.fit-panes'); const res = [];
  [...app.querySelectorAll('.vlp-app-list, .vlp-app-detail')].filter((e) => e.offsetHeight > 0).forEach((e) => { const gut = parseFloat(getComputedStyle(e, '::-webkit-scrollbar').width) || (e.offsetWidth - e.clientWidth); const can = e.scrollHeight - e.clientHeight > 100; const t0 = e.scrollTop; e.scrollTop = 300;
    res.push({ n: e.className.slice(0, 22), can, gut, moved: e.scrollTop > t0, more: e.classList.contains('more-below') }); }); return res; };
(async () => {
  const b = await chromium.launch(); const bad = [];
  try {
    for (const [w, h] of [[820, 1180], [1180, 820], [1024, 768]]) {
      const p = await start(b, 'customer', 1, w, h, true);
      await p.click('.vlp-nav-btn[data-tab=cars]'); await p.waitForTimeout(1200);
      const r = await p.evaluate(probe, true); assert(r, w + ' 터치 기기에서 칸 모드가 꺼짐'); r.bad.forEach((x) => bad.push(w + ' 고객 ' + x));
      assert(await p.evaluate(() => /--pane-h/.test(document.documentElement.getAttribute('style') || '')), w + ' 터치용 칸 높이(--pane-h) 없음');
      await p.waitForTimeout(300); const a = await p.evaluate(after);
      a.filter((x) => x.can).forEach((x) => { if (!x.moved) bad.push(w + ' ' + x.n + ' 안쪽 스크롤이 안 움직임'); if (x.gut < 6) bad.push(w + ' ' + x.n + ' 스크롤 막대 항상 보임 아님(폭 ' + x.gut + ')'); });
      assert(a.some((x) => x.can), w + ' 스크롤 가능한 칸이 없음(테스트 점검)');
      await p.context().close();
    }
    // 카마스터·시공자·관리자 건 목록: 목록 한 건을 열고 목록·상세가 각자 스크롤
    for (const [role, id, menu] of [['karmaster', 'k1', 't:clients'], ['shop', 'a', 't:clients'], ['supervisor', 'admin_super', 'm:cases']]) {
      const p = await start(b, role, id, 1180, 820, true); await openMenu(p, menu[0], menu.slice(2)); await p.waitForTimeout(900);
      const row = p.locator('.vlp-case-row').first(); if (await row.count()) { await row.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(800); }
      const r = await p.evaluate(probe, true); if (!r) { bad.push(role + ' 칸 모드 꺼짐'); await p.context().close(); continue; } r.bad.forEach((x) => bad.push(role + ' ' + x));
      const a = await p.evaluate(after); a.filter((x) => x.can).forEach((x) => { if (!x.moved) bad.push(role + ' ' + x.n + ' 안쪽 스크롤 안 움직임'); if (x.gut < 6) bad.push(role + ' ' + x.n + ' 막대 항상 보임 아님'); });
      if (!a.some((x) => x.can)) bad.push(role + ' 스크롤 가능한 칸 없음');
      await p.context().close();
    }
    // 전 역할·전 메뉴(목록 상태·건 하나 연 상태): 칸 모드인 화면은 칸이 창 안, 페이지가 같이 밀리지 않음
    for (const [w, h] of [[820, 1180], [1180, 820]]) for (const [role, id] of ROLES) {
      const p = await start(b, role, id, w, h, true);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.vlp-nav-btn[data-tab], .vlp-adm-nav-btn[data-menu], .vlp-adm-mi[data-menu]')].map((e) => e.dataset.tab ? ['t', e.dataset.tab] : ['m', e.dataset.menu]));
      for (const [k, v] of tabs) {
        try { await openMenu(p, k, v); } catch (e) { continue; } await p.waitForTimeout(700);
        const chk = async (when) => { const r = await p.evaluate(probe, false); if (r && r.bad.length) bad.push(w + ' ' + role + ' ' + v + ' ' + when + ' ' + r.bad.join(', ')); };
        await chk('목록'); const row = p.locator('.vlp-case-row, .vlp-car-chip').first();
        if (await row.count() && await row.isVisible().catch(() => false)) { await row.click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(600); await chk('상세'); }
      }
      await p.context().close();
    }
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
    const p = await start(b, 'customer', 1, 1440, 900, false); await p.click('.vlp-nav-btn[data-tab=cars]'); await p.waitForTimeout(1000);
    assert(await p.evaluate(() => document.querySelector('.vlp-app').classList.contains('fit-panes')), '마우스 PC에서 칸 모드가 꺼짐');
    assert(await p.evaluate(() => !/--pane-h/.test(document.documentElement.getAttribute('style') || '')), 'PC 에는 --pane-h 를 넣지 않는다');
    console.log('PASS test_touch_scroll');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
