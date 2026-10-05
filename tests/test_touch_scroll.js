// 터치 기기(아이패드 폭): 칸 모드를 쓰지 않아 내용이 창보다 길어도 페이지 스크롤로 끝까지 볼 수 있다 + 마우스 PC는 칸 모드 유지
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
async function open(b, ctxOpts) {
  const p = await (await b.newContext(ctxOpts)).newPage();
  await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
  await loginAs(p, 'customer', 1); await p.waitForSelector('.vlp-app'); await p.waitForTimeout(800);
  await p.click('.vlp-nav-btn[data-tab=cars]'); await p.waitForTimeout(1200); return p;
}
(async () => {
  const b = await chromium.launch();
  try {
    for (const [w, h] of [[820, 1180], [1180, 820], [1024, 768]]) {
      const p = await open(b, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const r = await p.evaluate(() => { const d = document.querySelector('.vlp-app-detail'), cs = d && getComputedStyle(d);
        return { coarse: matchMedia('(pointer: coarse)').matches, fit: document.querySelector('.vlp-app').classList.contains('fit-panes'), ov: cs && cs.overflowY, own: d ? d.scrollHeight - d.clientHeight : 0 }; });
      assert(r.coarse, w + ' 터치 에뮬레이션 안 됨'); assert(!r.fit, w + ' 터치 기기인데 칸 모드가 켜짐'); assert(r.own <= 1, w + ' 상세 칸 안쪽에 스크롤이 갇힘 ' + r.own);
      await p.context().close();
    }
    const p = await open(b, { viewport: { width: 1440, height: 900 } });
    assert(await p.evaluate(() => document.querySelector('.vlp-app').classList.contains('fit-panes')), '마우스 PC에서 칸 모드가 꺼짐');
    console.log('PASS test_touch_scroll');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
