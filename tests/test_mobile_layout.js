// 폰(390) 화면 규격: 제목 줄 높이(--t-head-m)·제목 줄 가운데·제목→첫 내용(--t-gap-bottom)·제목 위치(역할 안에서 모든 메뉴 동일)·왼쪽 시작이 같다.
const { chromium } = require('playwright');
const assert = require('assert');
const { eachScreen } = require('./_screens');
const probe = () => {
  const vis = (e) => e && e.offsetWidth > 0 && e.getBoundingClientRect().height > 0, rs = getComputedStyle(document.documentElement), px = (n) => parseFloat(rs.getPropertyValue(n));
  const fr = document.querySelector('.frame').getBoundingClientRect();
  const head = [...document.querySelectorAll('.vlp-pane-head, .vlp-home-sum')].find((e) => vis(e) && !e.closest('.vlp-case') && !e.closest('.vlp-chatdock') && !e.closest('.vlp-app-detail'));
  if (!head) return null;
  const h2 = head.querySelector('h1,h2,b') || head, rg = document.createRange(); rg.selectNodeContents(h2); const r2 = rg.getBoundingClientRect(), hr = head.getBoundingClientRect();
  let nx = head.nextElementSibling; while (nx && !vis(nx)) nx = nx.nextElementSibling;
  return { want: { h: px('--t-head-m'), bot: px('--t-gap-bottom') }, top: Math.round(r2.top - fr.top), headH: Math.round(hr.height), center: Math.round(r2.top + r2.height / 2 - hr.top), gapBottom: nx ? Math.round(nx.getBoundingClientRect().top - hr.bottom) : null, left: Math.round(r2.left) };
};
(async () => {
  const b = await chromium.launch(); const errs = [], bad = [];
  try {
    await eachScreen(b, 390, 844, async (p, role, v, seen) => {
      const m = await p.evaluate(probe); if (!m) return; const tag = '390 ' + role + ' ' + v; const f = seen[0] || (seen[0] = m);
      if (Math.abs(m.headH - m.want.h) > 1) bad.push(tag + ': 제목 줄 높이 ' + m.headH + ' (기준 ' + m.want.h + ')');
      if (Math.abs(m.center - m.want.h / 2) > 1.5) bad.push(tag + ': 제목 줄 가운데 ' + m.center);
      if (m.gapBottom != null && Math.abs(m.gapBottom - m.want.bot) > 1) bad.push(tag + ': 제목 줄→내용 ' + m.gapBottom + ' (기준 ' + m.want.bot + ')');
      if (m.top !== f.top) bad.push(tag + ': 제목 위치 ' + m.top + ' ≠ ' + f.top); if (m.left !== f.left) bad.push(tag + ': 제목 왼쪽 ' + m.left + ' ≠ ' + f.left);
    }, errs);
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n')); assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_mobile_layout');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
