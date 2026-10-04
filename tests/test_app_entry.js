// 통합 진입(app.html): 전화번호 하나로 역할 화면으로 이어지고, 마지막 역할을 기억하며, 처음 보는 번호는 고객으로 시작한다.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 760 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const fresh = async (path) => { await p.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('vlp_last_role'); }); await p.goto(BASE + '/' + path); };
    const typeLogin = async (phone) => { await p.fill('#app-phone', phone); await p.click('#app-go'); };

    // 1) 매니페스트: 통합 앱 하나
    await p.goto(BASE + '/app.html?nosw=1');
    const href = await p.getAttribute('link[rel=manifest]', 'href'); assert.strictEqual(href, 'manifest-app.webmanifest');
    const man = await p.evaluate(async () => (await fetch('manifest-app.webmanifest')).json());
    assert.ok(/^app\.html/.test(man.start_url) && man.shortcuts.length === 3, '통합 매니페스트');
    console.log('✔ 통합 매니페스트: start_url', man.start_url, '· 바로가기 3개');

    // 2) 겸임(박대표): 기본은 고객, ?role=shop이면 시공사
    await fresh('app.html?nosw=1'); await p.waitForSelector('#app-phone'); await typeLogin('010-3333-4402');
    await p.waitForSelector('.ap-rolebtn'); assert.strictEqual(await p.locator('.ap-rolebtn').count(), 2, '겸임이면 역할 선택 화면이 나온다');
    assert.ok(/고객/.test(await p.locator('.ap-rolebtn').first().innerText()) && /시공사/.test(await p.locator('.ap-rolebtn').nth(1).innerText()));
    await p.click('.ap-rolebtn[data-role=customer]');
    await p.waitForURL(/customer\.html/); await p.waitForSelector('#vlp-rolebar .rb-switch');
    assert.match(await p.innerText('#vlp-rolebar'), /고객 · 박대표/); console.log('✔ 겸임: 역할 선택 화면 → 고객, 전환 메뉴 있음');
    // 비밀번호 칸·사용 방법 링크(시연에서는 검증 안 함)
    await fresh('app.html?nosw=1'); await p.waitForSelector('#app-pw'); assert.strictEqual(await p.getAttribute('#app-pw', 'type'), 'password');
    assert.strictEqual(await p.getAttribute('.ap-manual:not(.ap-reg)', 'href'), 'manual.html'); console.log('✔ 로그인: 비밀번호 칸·사용 방법 링크');
    await fresh('app.html?nosw=1&role=shop'); await typeLogin('010-3333-4402');
    await p.waitForURL(/shop\.html/); await p.waitForSelector('.vlp-app-shop .vlp-nav-btn'); assert.match(await p.innerText('#vlp-rolebar'), /시공사 · 울산 B샵/); console.log('✔ ?role=shop 우선');

    // 3) 마지막 역할 기억 + 세션이 있으면 로그인 없이 이동
    await p.goto(BASE + '/app.html?nosw=1'); await p.waitForURL(/shop\.html/); console.log('✔ 세션 유지 시 로그인 없이 마지막 역할(시공사)로');
    await p.goto(BASE + '/app.html?nosw=1&login=1'); await p.waitForSelector('#app-phone'); console.log('✔ ?login=1이면 로그인 화면');

    // 4) 단일 역할: 시공사 A샵, 카마스터 k1
    await fresh('app.html?nosw=1'); await typeLogin('010-3333-4401'); await p.waitForURL(/shop\.html/); await p.waitForSelector('.vlp-app-shop .vlp-nav-btn');
    assert.match(await p.innerText('#vlp-rolebar'), /시공사 · 울산 A샵/); assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0);
    await fresh('app.html?nosw=1'); await typeLogin('010-2222-3301'); await p.waitForURL(/karmaster\.html/); await p.waitForSelector('.vlp-app');
    assert.match(await p.innerText('#vlp-rolebar'), /카마스터 · 김도현/); console.log('✔ 시공사·카마스터 단일 역할 진입');

    // 5) 처음 보는 번호: 이름을 받고 고객으로 시작
    await fresh('app.html?nosw=1'); await p.waitForSelector('#app-phone');
    await p.fill('#app-phone', '010-5555-0001'); await p.click('#app-go');
    await p.waitForSelector('#app-name:visible'); assert.ok(await p.isDisabled('#app-go'), '이름 없이는 계속 불가');
    await p.fill('#app-name', '신규고객'); await p.click('#app-go');
    await p.waitForURL(/customer\.html/); await p.waitForSelector('.vlp-app'); assert.match(await p.innerText('#vlp-rolebar'), /고객 · 신규고객/);
    assert.strictEqual(await p.locator('#vlp-rolebar .rb-switch').count(), 0);
    console.log('✔ 처음 보는 번호: 이름 입력 후 고객으로 시작');

    // 5b) 처음 보는 번호에는 고객/카마스터 선택 안내, 미가입 카마스터 입구(항상 보임)
    await fresh('app.html?nosw=1'); await p.waitForSelector('#app-phone');
    assert.ok(await p.isVisible('#app-claim'), '조회번호 입구는 처음부터 보인다');
    await p.fill('#app-phone', '010-9999-0009'); await p.click('#app-go');
    await p.waitForSelector('#app-unknown:visible'); assert.match(await p.innerText('#app-unknown'), /카마스터라면/);
    await Promise.all([p.waitForURL(/karmaster\.html\?claim=1/), p.click('#app-claim')]);
    await p.waitForSelector('.vlp-claim'); assert.ok(await p.isVisible('#cl-token'), '조회번호 입력 화면');
    console.log('✔ 미가입 카마스터: 입구 버튼 → 조회번호 화면, 처음 보는 번호엔 선택 안내');
    // 5c) 고객이 보낸 안내 링크(app.html?claim=1)는 곧바로 조회번호 화면
    await fresh('app.html?nosw=1&claim=1'); await p.waitForURL(/karmaster\.html\?claim=1/); await p.waitForSelector('.vlp-claim');
    console.log('✔ 안내 링크 ?claim=1 → 조회번호 화면');
    // 5d) 푸시 주소는 통합 앱을 거쳐 해당 역할·해당 건으로 열린다 (겸임이 다른 역할로 로그인해 있어도)
    await fresh('app.html?nosw=1&role=shop'); await typeLogin('010-3333-4402'); await p.waitForURL(/shop\.html/); await p.waitForSelector('.vlp-app-shop .vlp-nav-btn');
    const url = await p.evaluate(() => VLP.pushLink.appUrl({ refType: 'contract', refId: 'c-1' }, 'customer'));
    assert.strictEqual(url, 'app.html?role=customer&open=contract%3Ac-1');
    assert.strictEqual(await p.evaluate(() => VLP.pushLink.appUrl({ refType: 'x', refId: '../a' }, 'zzz')), 'app.html?role=customer', '잘못된 값은 역할 첫 화면');
    await p.goto(BASE + '/' + url + '&nosw=1'); await p.waitForURL(/customer\.html\?open=contract%3Ac-1/); await p.waitForSelector('#vlp-rolebar');
    assert.match(await p.innerText('#vlp-rolebar'), /고객 · 박대표/);
    console.log('✔ 푸시 주소: 시공사로 로그인한 겸임 사용자도 고객 역할·해당 건으로 열림');

    // 6) 데모 빠른 로그인
    await fresh('app.html?nosw=1'); await p.waitForSelector('#app-quick', { state: 'attached' }); assert.ok(!(await p.isVisible('#app-quick')), '데모 목록은 접혀 있다'); await p.click('#app-demo summary'); await p.selectOption('#app-quick', '010-7777-1000');
    await p.waitForURL(/customer\.html/); console.log('✔ 데모 빠른 로그인');
    assert.deepStrictEqual(errs, []);
    console.log('\n--- 통합 진입 통과 ---');
  } catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
