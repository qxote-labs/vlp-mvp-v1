// 시공업체 계정마다 화면이 다르다: 케어 건은 업체별, 대리 인수는 연결된 업체(A)만
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const seen = {};
    for (const id of ['a', 'b', 'c']) {
      const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
      await loginAs(p, 'shop', id); await p.click('.vlp-nav-btn[data-tab=clients]');
      await p.waitForSelector('.sc-queues', { timeout: 10000 }); await p.waitForTimeout(1200);
      seen[id] = await p.evaluate(() => document.querySelector('#body-root').innerText.replace(/\s+/g, ' '));
    }
    // 시드(store.js CARE_DEMO_GUIDE)와 대리 인수 1건(A의 입고 대기 큐)을 기준으로 업체별 건수가 갈린다.
    // A: 케어 7건 + 인도 건(대리 인수 위임·인도 종결 포함) 5건 = 12 (견적 1·입고 대기 4(인도 건)·작업 3·검수 1·이의 2·출차·완료 1(인도 종결))
    assert.ok(/전체 12/.test(seen.a) && /견적 요청 1/.test(seen.a) && /입고 대기 4/.test(seen.a) && /작업 중 3/.test(seen.a) && /검수 대기 1/.test(seen.a) && /이의 대응 2/.test(seen.a) && /20-202601-9001/.test(seen.a) && /SS-/.test(seen.a), seen.a.slice(0, 120));
    // B: 견적 요청 2 + 출차·완료(수령 확인 이후) 4 = 6, 대리 인수 없음
    assert.ok(/전체 6/.test(seen.b) && /견적 요청 2/.test(seen.b) && /출차·완료 4/.test(seen.b) && /20-202601-9002/.test(seen.b) && !/20-202601-9001/.test(seen.b) && !/SS-/.test(seen.b), seen.b.slice(0, 120));
    // C: 입고 대기 2·작업 2·출차·완료 3 = 7
    assert.ok(/전체 7/.test(seen.c) && /입고 대기 2/.test(seen.c) && /작업 중 2/.test(seen.c) && /출차·완료 3/.test(seen.c) && /20-202601-9003/.test(seen.c) && !/20-202601-9002/.test(seen.c) && !/SS-/.test(seen.c), seen.c.slice(0, 120));
    console.log('✔ 업체별 화면 분리: A 8건·B 6건·C 7건(시드 사례 기준)');
    assert.deepStrictEqual(errs, []); console.log('PASS test_shop_accounts');
  } catch (e) { console.error('FAIL', e.message, errs); process.exitCode = 1; } finally { await b.close(); }
})();
