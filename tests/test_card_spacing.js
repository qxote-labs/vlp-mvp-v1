// 카드(테두리 상자)가 위아래로 맞닿아 붙어 보이지 않는다 — 모든 역할·메뉴, 데스크톱(1440)과 폰(390)
const { chromium } = require('playwright');
const assert = require('assert');
const { eachScreen } = require('./_screens');
const probe = () => { const out = [], vis = (e) => e.offsetWidth > 0 && e.offsetHeight > 0;
  const boxed = (e) => { const cs = getComputedStyle(e); return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderRadius) > 0; };
  document.querySelectorAll('.frame *').forEach((e) => { if (!vis(e) || !boxed(e) || e.closest('.vlp-chatdock')) return; const n = e.nextElementSibling; if (!n || !vis(n) || !boxed(n)) return;
    const a = e.getBoundingClientRect(), c = n.getBoundingClientRect(), gap = Math.round(c.top - a.bottom);
    if (gap < 4 && gap >= -1 && Math.abs(c.left - a.left) < 4) out.push((e.className.toString().slice(0, 20) || e.tagName) + ' → ' + (n.className.toString().slice(0, 20) || n.tagName) + ' 간격 ' + gap); });
  return out.slice(0, 4); };
(async () => {
  const b = await chromium.launch(); const errs = [], bad = [];
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) await eachScreen(b, w, h, async (p, role, v) => { const r = await p.evaluate(probe); r.forEach((x) => bad.push(w + ' ' + role + ' ' + v + ': ' + x)); }, errs);
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n')); assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_card_spacing');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
