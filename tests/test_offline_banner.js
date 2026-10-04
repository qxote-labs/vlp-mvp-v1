// 오프라인 배너: 오프라인 안내 + 업로드 대기 건수 + 연결되면 자동 전송
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const errs = [];
  try {
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await loginAs(page, 'customer', 1); await page.waitForSelector('#vlp-rolebar');
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#vlp-rolebar.is-alert .rb-status');
    assert.match(await page.innerText('#vlp-rolebar .rb-status'), /오프라인/);
    assert.doesNotMatch(await page.innerText('#vlp-rolebar .rb-status'), /업로드 대기/);
    assert.ok(!(await page.$('#vlp-offline-banner:not([hidden])')), '역할 줄이 있으면 고정 배너는 뜨지 않는다');
    console.log('✔ 오프라인 배너(대기 건 없음)');
    await page.evaluate(async () => { VLP.api.media.init = async () => { const e = new Error('offline'); e.network = true; throw e; }; /* 오프라인이면 올리지 못하고 대기 상태로 남는다 */ VLP.api.session.set({ userId: 'u-t', role: 'customer', phone: '010-1111-0001', name: '홍길동', token: 'tok-t' }); const q = VLP.uploadQueue.shared(); await q.enqueue({ deliveryId: 'dlv-x', purpose: 'REQUIRED_SHOT', slot: '앞', blob: new Blob(['x'], { type: 'image/jpeg' }), contentType: 'image/jpeg' }); });
    // 오프라인에서는 올리기가 막혀 대기 상태로 남는다(네트워크 오류를 흉내) — 대기 건수 문구를 한 번에 잡는다
    const h = await page.waitForFunction(() => { const e = document.querySelector('#vlp-rolebar .rb-status'); if (!e) return false; const t = e.getAttribute('title') || ''; return /업로드 대기 \d+건 · 연결되면 자동 전송/.test(t) && /업로드 대기 \d+건/.test(e.textContent) ? t : false; }, null, { timeout: 8000, polling: 50 });
    console.log('✔ 업로드 대기 N건 · 연결되면 자동 전송:', (await h.jsonValue()).trim());
    // 연결이 돌아오면 줄이 원래대로
    await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('#vlp-rolebar.is-alert'), null, { timeout: 8000 });
    console.log('✔ 연결 복구 시 상태 줄 원복');
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 오프라인 배너 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
