// 디자인 토큰(--k-*) 적용 확인 — 모든 역할·메뉴에서 카드·행·섹션 제목·칩이 :root 토큰 값을 따른다 + 업체 승인이 창 높이를 넘지 않는다
const { chromium } = require('playwright');
const assert = require('assert');
const { eachScreen } = require('./_screens');
const probe = () => { const bad = [], vis = (e) => e.offsetWidth > 0 && e.offsetHeight > 0 && !e.closest('.vlp-chatdock');
  const t = document.createElement('div'); t.style.cssText = 'position:absolute;visibility:hidden;padding:var(--k-card-pad);border-radius:var(--k-card-radius);font-size:var(--k-sec-fs);font-weight:var(--k-sec-fw);min-height:var(--k-chip-h);line-height:var(--k-row-title-lh)'; document.body.appendChild(t);
  const T = getComputedStyle(t), pad = [T.paddingTop, T.paddingRight], rad = T.borderTopLeftRadius, secFs = T.fontSize, secFw = T.fontWeight, chipH = parseFloat(T.minHeight), titleLh = T.lineHeight; t.remove();
  document.querySelectorAll('.frame .vlp-cd, .frame .vlp-case-row, .frame .vlp-home-row').forEach((e) => { if (!vis(e)) return; const cs = getComputedStyle(e);
    if (cs.borderTopLeftRadius !== rad) bad.push(e.className + ' 모서리 ' + cs.borderTopLeftRadius + '≠' + rad);
    if (e.matches('.vlp-cd, .vlp-case-row, .vlp-home-row') && (cs.paddingTop !== pad[0] || cs.paddingLeft !== pad[1])) bad.push(e.className + ' 안쪽여백 ' + cs.paddingTop + '/' + cs.paddingLeft + '≠' + pad.join('/')); });
  document.querySelectorAll('.frame .vlp-section-title').forEach((e) => { if (!vis(e)) return; const cs = getComputedStyle(e); if (cs.fontSize !== secFs || cs.fontWeight !== secFw) bad.push('섹션제목 ' + cs.fontSize + '/' + cs.fontWeight + '≠' + secFs + '/' + secFw); });
  document.querySelectorAll('.frame .vlp-case-row .vlp-row-title').forEach((e) => { if (!vis(e)) return; if (getComputedStyle(e).lineHeight !== titleLh) bad.push('행 제목 줄높이 ' + getComputedStyle(e).lineHeight + '≠' + titleLh); });
  document.querySelectorAll('.frame .vlp-chip').forEach((e) => { if (!vis(e) || e.closest('.vlp-kpi-strip')) return; if (e.getBoundingClientRect().height + 0.5 < chipH) bad.push('칩 높이 ' + Math.round(e.getBoundingClientRect().height) + '<' + chipH); });
  return [...new Set(bad)].slice(0, 5); };
(async () => {
  const b = await chromium.launch(); const errs = [], bad = [];
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) await eachScreen(b, w, h, async (p, role, v) => { (await p.evaluate(probe)).forEach((x) => bad.push(w + ' ' + role + ' ' + v + ': ' + x)); if (role === 'supervisor' && v === 'shops' && w === 1440) { const m = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(m <= 0, '업체 승인 가로 넘침 ' + m); } }, errs);
    await eachScreen(b, 1280, 720, async (p, role, v) => { if (role === 'supervisor' && v === 'shops') { const sy = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight); if (sy > 0) bad.push('1280x720 업체 승인 세로 넘침 ' + sy); } }, errs);
    assert.deepStrictEqual(bad, [], '\n' + bad.join('\n')); assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('PASS test_tokens');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
