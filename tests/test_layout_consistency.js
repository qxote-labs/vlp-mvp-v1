// 화면 규격(v102): 모든 역할·메뉴에서 ① 상단 메뉴 시작 높이 ② 메뉴→제목 줄 간격 ③ 제목 줄 가운데 ④ 제목 줄→첫 내용 ⑤ 제목 왼쪽 시작이 같다(기준값은 app.css 의 변수를 읽는다). ⑥ 제목 윗선이 메뉴 아래 19px(1440 폭 화면 y 154).
// 어느 화면의 여백을 고치다 다른 화면이 틀어지면 여기서 걸린다. 값은 app.css 의 --t-gap-top / --t-head-h / --t-gap-bottom.
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
const probe = () => {
  const vis = (e) => e && e.offsetWidth > 0 && e.getBoundingClientRect().height > 0;
  const nav = [...document.querySelectorAll('.vlp-adm-nav, nav.vlp-bottomnav')].find((n) => vis(n) && n.getBoundingClientRect().top < 300);
  const head = [...document.querySelectorAll('.vlp-pane-head, .vlp-adm-home .vlp-home-sum')].find((e) => vis(e) && !e.closest('.vlp-case') && !e.closest('.vlp-chatdock') && e.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 2);
  if (!nav || !head) return null;
  const nb = nav.getBoundingClientRect(), hr = head.getBoundingClientRect(), h2 = head.querySelector('h1,h2,b') || head, rg = document.createRange(); rg.selectNodeContents(h2); const r2 = rg.getBoundingClientRect(); /* 제목 글자 줄 기준 */
  let nx = head.nextElementSibling; while (nx && !vis(nx)) nx = nx.nextElementSibling;
  const rs = getComputedStyle(document.documentElement), px = (n) => parseFloat(rs.getPropertyValue(n));
  return { want: { top: px('--t-gap-top'), h: px('--t-head-h'), bot: px('--t-gap-bottom') }, h2Top: Math.round(r2.top - nb.bottom), navTop: Math.round(nb.top), gapTop: Math.round(hr.top - nb.bottom), center: Math.round(r2.top + r2.height / 2 - hr.top), left: Math.round(r2.left), gapBottom: nx ? Math.round(nx.getBoundingClientRect().top - hr.bottom) : null, text: (h2.textContent || '').trim().slice(0, 12) };
};
(async () => {
  const b = await chromium.launch(); const errs = [], bad = [];
  try {
    for (const [w, h] of [[1440, 900], [820, 1100]]) for (const [role, id] of [['customer', 1], ['karmaster', 'k1'], ['shop', 'a'], ['supervisor', 'admin_super']]) {
      const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await loginAs(p, role, id); await p.waitForSelector('.vlp-app, .vlp-adm'); await p.waitForTimeout(900);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.vlp-nav-btn[data-tab], .vlp-adm-nav-btn[data-menu]')].filter((e) => e.offsetWidth > 0).map((e) => e.dataset.tab ? ['t', e.dataset.tab] : ['m', e.dataset.menu]).filter((x) => x[1] !== 'logout'));
      let first = null;
      for (const [k, v] of tabs) {
        await p.click(k === 't' ? '.vlp-nav-btn[data-tab=' + v + ']' : '.vlp-adm-nav-btn[data-menu=' + v + ']'); await p.waitForTimeout(1000);
        const m = await p.evaluate(probe); if (!m) continue; const tag = w + ' ' + role + ' ' + v + ' "' + m.text + '"';
        first = first || m;
        if (Math.abs(m.gapTop - m.want.top) > 1) bad.push(tag + ': 메뉴→제목 줄 ' + m.gapTop + ' (기준 ' + m.want.top + ')');
        if (Math.abs(m.h2Top - 19) > 1) bad.push(tag + ': 메뉴→제목 윗선 ' + m.h2Top + ' (기준 19 = y 154)');
        if (Math.abs(m.center - m.want.h / 2) > 1) bad.push(tag + ': 제목 줄 가운데 ' + m.center + ' (기준 ' + m.want.h / 2 + ')');
        if (m.gapBottom != null && Math.abs(m.gapBottom - m.want.bot) > 1) bad.push(tag + ': 제목 줄→내용 ' + m.gapBottom + ' (기준 ' + m.want.bot + ')');
        if (m.navTop !== first.navTop) bad.push(tag + ': 상단 메뉴 시작 높이 ' + m.navTop + ' ≠ ' + first.navTop);
        if (m.left !== first.left) bad.push(tag + ': 제목 왼쪽 ' + m.left + ' ≠ ' + first.left);
      }
      await p.context().close(); console.log('✔ ' + w + ' ' + role + ' ' + tabs.length + '개 메뉴 확인');
    }
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n')); assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('PASS test_layout_consistency');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
