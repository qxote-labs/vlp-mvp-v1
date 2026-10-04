// S2 PWA-13~17: 위치 B안(현재 위치 카드·시트·노선 개략도·주소 복사·길찾기), 보강 초안/게시 게이트, 지연 발생·해소,
// 타임라인 병합·출처 라벨, 관리자 수집 현황(stale 상단). 지도 라이브러리·외부 스크립트 없음.
const { chromium } = require('playwright');
const assert = require('assert');
const UI = require('./_ui');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }); const errs = [], reqs = [];
  const hook = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(n + ' console: ' + m.text()); }); p.on('request', r => reqs.push(r.url())); };
  const ok = (m) => console.log('✔ ' + m);
  try {
    const d = await ctx.newPage(); hook(d, 'demo');
    await d.goto(BASE + '/demo.html?nosw=1'); await d.click('#load');
    await d.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const custHref = BASE + '/' + await d.getAttribute('#l-cust', 'href') + '&nosw=1';
    const kmHref = BASE + '/' + await d.getAttribute('#l-km', 'href') + '&nosw=1';
    const c = await ctx.newPage(); hook(c, 'cust'); const k = await ctx.newPage(); hook(k, 'km');
    await c.goto(custHref); await c.waitForSelector('.vlp-nav-btn');
    const ids = await c.evaluate(async () => { const l = await VLP.api.contracts.list({}); const x = l.items.find(i => i.deliveryId); return { deliveryId: x.deliveryId, contractId: x.contractId }; });
    const A = (fn, arg) => c.evaluate(fn, arg);
    const openCust = async (tab) => { await c.reload(); await UI.custOpen(c, '아이오닉'); await UI.tab(c, tab || '위치'); return c.locator('.vlp-case'); };
    const openManage = async (k, sel) => { for (let i = 0; i < 6; i++) { await UI.primary(k); try { await k.waitForSelector(sel, { timeout: 2000 }); return; } catch (e) { await k.keyboard.press('Escape'); await k.waitForTimeout(500); } } throw new Error('시트에서 ' + sel + ' 없음'); };

    // 수집 전
    let card = await openCust();
    assert.ok(/수집이 시작되지 않/.test(await card.locator('.vlp-loc-card').textContent()));
    assert.ok((await card.locator('.vlp-dest-addr').textContent()).length > 3);
    ok('수집 전: 위치 카드에 "수집 전" 안내, 인수 장소 주소 표시');

    // 배차 → 탁송 중, 자동 관측
    await A((id) => { const a = VLP.api.adapter().admin; a.advance(id, 'SHIPPED'); a.advance(id, 'IN_TRANSIT'); a.observe(id, '경기 평택'); a.observe(id, '충북 청주'); a.observe(id, '경북 구미'); }, ids.deliveryId);
    card = await openCust();
    assert.ok(/경북 구미/.test(await card.locator('.vlp-loc-region').textContent()));
    assert.ok(/자동 수집/.test(await card.locator('.vlp-loc-meta').textContent()));
    const nodes = await card.locator('.vlp-route .vlp-stp-t').allTextContents();
    assert.deepStrictEqual(nodes.slice(0, 1).concat(nodes.slice(-1).map(() => 'END')), ['출발', 'END']);
    assert.deepStrictEqual(nodes.slice(0, 4), ['출발', '경기 평택', '충북 청주', '경북 구미'], nodes.join('|'));
    assert.strictEqual(await card.locator('.vlp-route .vlp-stp-i.cur .vlp-stp-t').textContent(), '경북 구미');
    ok('노선 개략도: 출발 → 평택 → 청주 → 구미(현재) → 도착지 · ' + nodes.join(' → '));

    // 시트: 출처·시각·갱신 이력
    await card.locator('.vlp-loc-card').click();
    await c.waitForSelector('.vlp-sheet[role=dialog]');
    const sheet = await c.locator('.vlp-sheet').textContent();
    assert.ok(/자동 수집/.test(sheet) && /관측 시각/.test(sheet) && /갱신 이력/.test(sheet) && /경기 평택/.test(sheet), '시트 내용 부족');
    assert.ok(await c.locator('.vlp-sheet .vlp-hist li').count() >= 3);
    await c.keyboard.press('Escape'); assert.strictEqual(await c.locator('.vlp-sheet').count(), 0);
    ok('위치 시트: 출처·관측 시각·마지막 수집·갱신 이력 3건, Esc로 닫힘');

    // 주소 복사 + 길찾기 링크, 지도 라이브러리 없음
    const addr = (await card.locator('.vlp-dest-addr').textContent()).trim();
    await card.locator('.vlp-copy-addr').click();
    assert.strictEqual(await c.evaluate(() => navigator.clipboard.readText()), addr);
    const href = await card.locator('.vlp-nav-link').getAttribute('href');
    assert.ok(href.includes(encodeURIComponent(addr)) && (await card.locator('.vlp-nav-link').getAttribute('target')) === '_blank');
    assert.ok(!reqs.some(u => /map|leaflet|kakao|naver|google/i.test(new URL(u).hostname + new URL(u).pathname) && !u.startsWith(BASE)), '외부 지도 로드: ' + reqs.filter(u => !u.startsWith(BASE)).join(','));
    assert.strictEqual(await c.evaluate(() => [...document.scripts].filter(s => s.src && !s.src.startsWith(location.origin)).length), 0);
    ok('주소 복사 동작, 길찾기는 외부 링크(새 창), 외부 지도 스크립트 로드 0건');

    // 수집 지연(STALE) 표시
    await A(() => VLP.api.adapter().admin.skipTime(40 * 60000));
    card = await openCust();
    assert.strictEqual(await card.locator('.vlp-loc-card').getAttribute('data-collection'), 'STALE');
    assert.ok(/실제와 다를 수/.test(await card.locator('.vlp-loc-card').textContent()));
    ok('40분 경과: 위치 카드가 STALE 안내(실제와 다를 수 있음)로 바뀜');

    // ---- 카마스터: 보강 초안 → 고객에게 안 보임 → 게시 → 보임 ----
    await k.goto(kmHref); await UI.kmOpen(k, '아이오닉'); await UI.primary(k);
    const kcard = k.locator('.vlp-sheet');
    await kcard.locator('select[name=kind]').selectOption('LOCATION');
    await kcard.locator('input[name=text]').fill('대전 휴게소 경유 중');
    await kcard.locator('.vlp-aug-save').click();
    await k.waitForFunction(() => !document.querySelector('.vlp-sheet'));
    await openManage(k, '.vlp-draft');
    ok('카마스터: 위치 보강 초안 저장 → 초안 목록(게시 대기)');
    card = await openCust();
    assert.ok(!(await card.textContent()).includes('대전 휴게소'), '초안이 고객에게 보임');
    await UI.tab(c, '이력'); assert.ok(!(await card.textContent()).includes('대전 휴게소'), '초안이 고객 이력에 보임');
    ok('게시 전: 고객 화면에 초안 노출 0건');
    await k.locator('.vlp-sheet .vlp-aug-publish').first().click();
    await k.waitForFunction(() => !document.querySelector('.vlp-sheet'));
    card = await openCust();
    assert.ok((await card.textContent()).includes('대전 휴게소'));
    assert.ok(/카마스터 입력/.test(await card.locator('.vlp-loc-meta').textContent()));
    card = await openCust('이력'); assert.ok(/대전 휴게소/.test(await card.locator('.vlp-hl').textContent()));
    ok('게시 후: 고객 화면 타임라인·현재 위치에 노출, 출처 "카마스터 입력"');

    // 타임라인: AUTO + MANAGER 병합, 출처 라벨 둘 다, 같은 시각 정렬 안정
    const srcs = await card.locator('.vlp-hl .vlp-hl-src').allTextContents();
    assert.ok(srcs.includes('자동') && srcs.includes('카마스터'), srcs.join(','));
    assert.strictEqual(await card.locator('.vlp-hl-row[data-type=LOCATION]').count(), 0, '위치 수집 로그가 이력 탭에 보임');
    const stable = await A(() => { const t = '2026-01-01T00:00:00.000Z'; const items = [1, 2, 3, 4].map(i => ({ entryId: 'e' + i, observedAt: t, type: 'LOCATION' })); const a = VLP.delivery.sortEntries(items).map(e => e.entryId).join(); const b = VLP.delivery.sortEntries(items.slice()).map(e => e.entryId).join(); return a === b && a === 'e1,e2,e3,e4'; });
    assert.ok(stable, '같은 시각 정렬이 안정적이지 않음');
    ok('타임라인: 자동 수집 + 카마스터 입력 병합, 출처 라벨 2종, 같은 시각 정렬 안정');

    // ---- 지연 발생·해소 (UI) ----
    await k.reload(); await UI.kmOpen(k, '아이오닉'); await UI.primary(k);
    const kc2 = k.locator('.vlp-sheet');
    await kc2.locator('select[name=reason]').selectOption('weather');
    await kc2.locator('.vlp-exc-raise').click();
    await k.waitForFunction(() => !document.querySelector('.vlp-sheet'));
    await openManage(k, '.vlp-exc-resolve'); await k.keyboard.press('Escape');
    card = await openCust();
    assert.strictEqual((await card.locator('.vlp-state-chip').textContent()).replace(/^[^가-힣]+/, ''), '지연·예외');
    ok('지연 알리기(기상악화) → 고객 칩 "지연·예외"');
    await openManage(k, '.vlp-exc-resolve'); await k.locator('.vlp-sheet .vlp-exc-resolve').click(); await k.waitForFunction(() => !document.querySelector('.vlp-sheet'));
    card = await openCust();
    assert.strictEqual((await card.locator('.vlp-state-chip').textContent()).replace(/^[^가-힣]+/, ''), '탁송 중');
    ok('지연 해소 → 직전 상태 "탁송 중" 복귀');

    // ---- 관리자 수집 현황: stale 상단 ----
    await A(() => VLP.api.adapter().admin.skipTime(60 * 60000));
    const a = await ctx.newPage(); hook(a, 'admin');
    await a.goto(BASE + '/admin.html?nosw=1');
    await a.evaluate(() => { const ad = Store.getAdmins().find(x => x.adminScope === 'community'); window.tryLogin(ad.id, 'delivery'); });
    await a.waitForSelector('.vlp-app-admin .vlp-case-row', { timeout: 15000 });
    const first = await a.locator('.vlp-app-admin .vlp-case-row').first().getAttribute('data-collect');
    assert.strictEqual(first, 'STALE');
    assert.ok(/수집 지연/.test(await a.locator('.vlp-app-admin .vlp-case-row').first().textContent()));
    await a.locator('.vlp-app-admin .vlp-case-row').first().click(); await a.waitForSelector('.vlp-collect-card');
    assert.ok(/마지막 수집/.test(await a.locator('.vlp-collect-card').textContent()));
    assert.ok(await a.locator('.vlp-state-map').count() === 1);
    assert.deepStrictEqual(await a.locator('.vlp-app-admin .vlp-tabs [role=tab]').allInnerTexts(), ['개요', '위치', '시공', '운영', '이력'], '관리자 건 상세 탭 = 고객과 같은 개요·위치·시공·이력 + 관리자 전용 운영');
    assert.ok(await a.locator('.vlp-app-admin .vlp-tabs [role=tab]').nth(0).click().then(() => a.waitForSelector('.vlp-sum')).then(() => true), '개요에 계약 요약 카드');
    ok('관리자 콘솔: 수집 지연 건이 목록 맨 위, 요약 탭의 수집·알림 현황 카드에 마지막 수집 시각, 표시↔저장 상태 매핑');
    assert.ok(await a.evaluate(() => VLP.adminCollection.sortRows([{ deliveryId: 'a', collectionStatus: 'COLLECTING' }, { deliveryId: 'b', collectionStatus: 'STOPPED' }, { deliveryId: 'c', collectionStatus: 'STALE', staleMinutes: 5 }, { deliveryId: 'd', collectionStatus: 'STALE', staleMinutes: 90 }]).map(r => r.deliveryId).join('') === 'dcab'));
    ok('정렬 규칙: 지연 오래된 순 → 수집 중 → 종료');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  if (errs.length) { console.error('JS 오류:\n' + errs.join('\n')); process.exitCode = 1; }
  await b.close();
  if (!process.exitCode) console.log('\n--- S2 PWA-13~17 위치·타임라인·보강·지연·수집 현황 통과 ---');
})();
