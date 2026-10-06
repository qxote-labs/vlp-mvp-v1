// 터치 기기(아이패드 폭): PC 와 같은 "칸" 동작(목록·상세가 각자 스크롤)을 유지한다 —
// 칸 모드 ON, 칸 높이가 창 안에 들어옴(페이지가 같이 밀리지 않음), 더 있음 표시, 막대 자리 없음(iOS 기본 막대), 내용이 길면 칸 안에서 스크롤, 상세 칸에도 "더 있음" 표시
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
      a.filter((x) => x.can).forEach((x) => { if (!x.moved) bad.push(w + ' ' + x.n + ' 안쪽 스크롤이 안 움직임'); if (!x.more) bad.push(w + ' ' + x.n + ' "더 있음" 표시 없음'); if (!x.more) bad.push(w + ' ' + x.n + ' "더 있음" 표시 없음'); });
      assert(a.some((x) => x.can), w + ' 스크롤 가능한 칸이 없음(테스트 점검)');
      await p.context().close();
    }
    // 카마스터·시공자·관리자 건 목록: 목록 한 건을 열고 목록·상세가 각자 스크롤
    for (const [role, id, menu] of [['karmaster', 'k1', 't:clients'], ['shop', 'a', 't:clients'], ['supervisor', 'admin_super', 'm:cases']]) {
      const p = await start(b, role, id, 1180, 820, true); await openMenu(p, menu[0], menu.slice(2)); await p.waitForTimeout(900);
      const row = p.locator('.vlp-case-row').first(); if (await row.count()) { await row.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(800); }
      const r = await p.evaluate(probe, true); if (!r) { bad.push(role + ' 칸 모드 꺼짐'); await p.context().close(); continue; } r.bad.forEach((x) => bad.push(role + ' ' + x));
      // 스크롤 도중 resize(iOS 주소줄 변화)·클래스 변경이 들어와도 칸을 다시 재지 않아 스크롤 위치·높이가 그대로(재면 iOS 가 터치 스크롤을 끊음)
      if (role === 'karmaster') { const st = await p.evaluate(async () => { const l = document.querySelector('.vlp-app-list'); l.scrollTop = 250; const hs = []; { const cs = l.style; let cur = cs.height; Object.defineProperty(cs, 'height', { get: () => cur, set: (v) => { hs.push(v); cur = v; CSSStyleDeclaration.prototype.__lookupSetter__ ? 0 : 0; cs.setProperty('height', v); }, configurable: true }); }
          for (let i = 0; i < 4; i++) { window.dispatchEvent(new Event('resize')); { const x = document.createElement('i'); document.body.appendChild(x); x.remove(); } document.querySelector('.vlp-app-detail').classList.toggle('more-below'); await new Promise((r) => setTimeout(r, 60)); }
          await new Promise((r) => setTimeout(r, 700)); return { top: l.scrollTop, hs: hs.filter((x) => x) }; });
        if (st.top !== 250) bad.push('스크롤 중 resize 로 목록 위치가 바뀜 ' + st.top); if (st.hs.some((x) => x === '9999px')) bad.push('스크롤 중 칸 높이를 9999px 로 바꿈(재측정)'); }
      // 목록을 접어 상세만 남긴 상태(이때는 상세가 재측정 대상): 같은 조건에서 위치·높이가 유지돼야 한다
      if (role === 'karmaster') { await p.locator('.vlp-list-toggle').click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(700);
        const st = await p.evaluate(async () => { const d = document.querySelector('.vlp-app-detail'); if (!d.querySelector('.tt-spacer')) { const sp = document.createElement('div'); sp.style.cssText = 'height:2400px;flex:0 0 auto'; sp.className = 'tt-spacer'; d.appendChild(sp); } d.scrollTop = 250; const hs = []; { const cs = d.style; let cur = cs.height; Object.defineProperty(cs, 'height', { get: () => cur, set: (v) => { hs.push(v); cur = v; cs.setProperty('height', v); }, configurable: true }); }
          for (let i = 0; i < 4; i++) { window.dispatchEvent(new Event('resize')); { const x = document.createElement('i'); document.body.appendChild(x); x.remove(); } d.classList.toggle('more-below'); await new Promise((r) => setTimeout(r, 60)); }
          await new Promise((r) => setTimeout(r, 700)); return { top: d.scrollTop, hs: hs.filter((x) => x), closed: document.querySelector('.vlp-app').classList.contains('list-closed') }; });
        if (!st.closed) bad.push('목록 접힘 상태를 만들지 못함(테스트 점검)'); if (st.top !== 250) bad.push('목록 접힌 상태에서 스크롤 중 resize 로 상세 위치가 바뀜 ' + st.top); if (st.hs.some((x) => x === '9999px')) bad.push('목록 접힌 상태에서 칸 높이를 9999px 로 바꿈');
        await p.locator('.vlp-list-toggle').click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(500); }
      const a = await p.evaluate(after); a.filter((x) => x.can).forEach((x) => { if (!x.moved) bad.push(role + ' ' + x.n + ' 안쪽 스크롤 안 움직임'); });
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
