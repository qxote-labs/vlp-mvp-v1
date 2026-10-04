// 관리자 전체 사용자: 한 목록 · 정렬(표시·방향 안내) · 검색줄+구분 선택+적용 조건 · 상세는 요청할 때만 · 자동 열기 스위치 · 범위
const { chromium } = require('playwright');
const assert = require('assert');
const { loginAs } = require('./_login');
const BASE = 'http://localhost:8000';
async function open(b, role, who, vp) {
  const p = await (await b.newContext({ viewport: vp || { width: 1440, height: 900 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
  await loginAs(p, role, who, '');
  if (p.viewportSize().width < 768) { await p.click('.vlp-adm-more'); await p.click('.vlp-adm-mi[data-menu=users]'); } else await p.click('.vlp-adm-nav-btn[data-menu=users]'); await p.waitForSelector('.vlp-usr-row'); p.errs = errs; return p;
}
const names = (p) => p.locator('.vlp-usr-row td:nth-child(1)').allInnerTexts();
(async () => {
  const b = await chromium.launch();
  try {
    const p = await open(b, 'supervisor', 'admin_super');
    const total = await p.locator('.vlp-usr-row').count(); assert.ok(total >= 10, '전체 사용자가 한 목록에: ' + total);
    const roles = (await p.locator('.vlp-usr-row td:nth-child(3)').allInnerTexts()).join(' ');
    for (const r of ['구매자', '카마스터', '시공업체', '슈퍼바이저', '커뮤니티관리자']) assert.ok(roles.includes(r), '역할 ' + r);
    assert.strictEqual(await p.locator('.vlp-usr-filters').count(), 0, '열마다 검색칸 줄은 없음');
    console.log('✔ 구매자·카마스터·시공업체·관리자가 한 목록 (' + total + '명), 열별 검색 줄 없음');
    // 정렬: 표시와 안내
    const icons = await p.locator('th[data-col] i').allInnerTexts(); assert.ok(icons.filter(x => x === '⇅').length === 5 && icons.includes('▼'), '정렬 가능 표시 ⇅ 항상 노출, 현재 열만 ▼: ' + icons);
    assert.ok(/정렬: 가입일 · 최신순/.test(await p.locator('.vlp-usr-sortinfo').innerText()), '현재 정렬 안내 글');
    await p.click('th[data-col=name] .vlp-usr-sort'); let a = await names(p);
    assert.deepStrictEqual(a, [...a].sort((x, y) => x.localeCompare(y, 'ko')), '이름 오름차순'); assert.ok(/이름 · 가나다순/.test(await p.locator('.vlp-usr-sortinfo').innerText()));
    await p.click('th[data-col=name] .vlp-usr-sort'); a = await names(p); assert.deepStrictEqual(a, [...a].sort((x, y) => y.localeCompare(x, 'ko')), '이름 내림차순');
    await p.click('th[data-col=cases] .vlp-usr-sort'); const cs = (await p.locator('.vlp-usr-row td:nth-child(5)').allInnerTexts()).map(t => parseInt(t) || 0);
    assert.deepStrictEqual(cs, [...cs].sort((x, y) => y - x), '연결 건 많은 순');
    console.log('✔ 정렬: ⇅ 표시·현재 정렬 안내·오름/내림');
    // 검색줄 + 범위 + 구분 선택 + 적용 조건 표시
    await p.fill('.vlp-usr-q', '카마스터'); assert.ok((await names(p)).length >= 1 && (await names(p)).every(n => n.includes('카마스터')), '전체 범위 검색');
    await p.selectOption('.vlp-usr-scope', 'phone'); assert.strictEqual(await p.locator('.vlp-usr-row').count(), 0, '전화 범위에서는 이름 글자가 안 걸림');
    assert.ok(/전화 검색: 카마스터/.test(await p.locator('.vlp-usr-chips').innerText()), '적용 중인 조건 표시');
    await p.click('.vlp-usr-tag'); assert.strictEqual(await p.locator('.vlp-usr-row').count(), total, '조건 칩을 눌러 지움');
    await p.selectOption('.vlp-usr-chip[data-f=role]', '시공업체'); const rr = await p.locator('.vlp-usr-row td:nth-child(3)').allInnerTexts(); assert.ok(rr.length && rr.every(t => t.includes('시공업체')), '역할 선택');
    await p.selectOption('.vlp-usr-chip[data-f=group]', '울산'); await p.selectOption('.vlp-usr-chip[data-f=role]', ''); await p.selectOption('.vlp-usr-chip[data-f=cases]', 'has');
    assert.ok(/그룹: 울산/.test(await p.locator('.vlp-usr-chips').innerText()) && /연결 건: 있음/.test(await p.locator('.vlp-usr-chips').innerText()));
    await p.click('.vlp-usr-reset'); assert.strictEqual(await p.locator('.vlp-usr-row').count(), total, '모두 지우기');
    await p.selectOption('.vlp-usr-scope', 'phone'); await p.fill('.vlp-usr-q', '77771000'); assert.strictEqual(await p.locator('.vlp-usr-row').count(), 1, '전화번호는 하이픈 없이도 검색');
    await p.fill('.vlp-usr-q', 'zzzz없는사람'); assert.ok(/조건에 맞는 사용자가 없어요/.test(await p.locator('.vlp-usr-table').innerText()));
    await p.fill('.vlp-usr-q', ''); await p.selectOption('.vlp-usr-scope', 'all');
    console.log('✔ 검색줄(범위 선택)·구분 선택·적용 조건 칩·모두 지우기');
    // 화면 높이에 맞춘 칸
    assert.ok(await p.locator('.vlp-usr-detail').isHidden(), '상세 칸은 요청 전에는 없다');
    const fit = await p.evaluate(() => { const s = document.querySelector('.vlp-usr-scroll'); return { page: document.documentElement.scrollHeight - innerHeight, sc: s.scrollHeight - s.clientHeight }; });
    assert.ok(fit.page <= 2, '페이지 자체는 스크롤 없음 ' + fit.page); assert.ok(fit.sc > 0, '목록만 안에서 스크롤 ' + fit.sc);
    // 한 번 클릭 = 선택만, 더블클릭·[상세 ›]·Enter = 상세
    const row = p.locator('.vlp-usr-row', { hasText: '김민준' });
    await row.click(); assert.ok(await p.locator('.vlp-usr-detail').isHidden(), '한 번 클릭은 상세를 열지 않음'); assert.strictEqual(await row.getAttribute('aria-selected'), 'true');
    await row.dblclick(); await p.waitForSelector('.vlp-usr-ov'); assert.ok(/010-7777-1000/.test(await p.locator('.vlp-usr-ov').innerText()), '더블클릭으로 상세');
    await p.keyboard.press('Escape'); assert.ok(await p.locator('.vlp-usr-detail').isHidden(), 'Esc로 닫기');
    await row.locator('.vlp-usr-open').click(); await p.waitForSelector('.vlp-usr-ov'); await p.locator('.vlp-usr-close').click(); assert.ok(await p.locator('.vlp-usr-detail').isHidden(), '[상세 ›] 버튼 / 닫기');
    await row.focus(); await p.keyboard.press('Enter'); await p.waitForSelector('.vlp-usr-ov'); await p.locator('.vlp-usr-close').click();
    console.log('✔ 한 번 클릭=선택만 · 더블클릭/[상세 ›]/Enter=상세 · Esc 닫기 · 목록만 스크롤');
    // 자동 열기 스위치
    await p.locator('.vlp-usr-auto').click(); await row.click(); await p.waitForSelector('.vlp-usr-ov'); assert.ok(await p.locator('.vlp-usr-ov').isVisible(), '스위치를 켜면 한 번 클릭으로 상세');
    await p.locator('.vlp-usr-auto').click(); assert.ok(await p.locator('.vlp-usr-detail').isHidden(), '끄면 상세 닫힘');
    // 메모
    await row.dblclick(); await p.waitForSelector('.vlp-usr-ov');
    await p.fill('.vlp-usr-detail .vlp-admin-notes textarea', '전화 상담 완료'); await p.click('.vlp-usr-detail .vlp-an-add');
    await p.waitForFunction(() => /전화 상담 완료/.test(document.querySelector('.vlp-usr-detail .vlp-admin-notes .vlp-an-list').innerText));
    assert.ok(/운영 메모 작성/.test(await p.locator('.vlp-usr-detail .vlp-admin-log').innerText()));
    console.log('✔ 상세 칸 자동 열기 스위치 · 개요·연결된 건·운영 메모·처리 기록');
    // 그룹 관리: 화면 맨 위 탭으로 항상 보임
    assert.ok(/그룹 관리 \d+개/.test(await p.locator('.vlp-usr-tab[data-view=groups]').innerText()), '그룹 관리 탭 제목이 처음부터 보임');
    assert.ok(await p.locator('.vlp-usr-tab[data-view=groups]').isVisible());
    await p.click('.vlp-usr-tab[data-view=groups]'); await p.waitForSelector('#grp-name'); assert.ok(await p.locator('.vlp-usr-uview').isHidden());
    assert.ok(/울산/.test(await p.locator('.vlp-usr-gview').innerText()) && /카마스터/.test(await p.locator('.vlp-usr-gview').innerText()), '그룹별 소속 수');
    const before = await p.locator('.vlp-usr-gview tbody tr').count(); await p.fill('#grp-name', '대전'); await p.click('#grp-create');
    await p.waitForFunction((n) => document.querySelectorAll('.vlp-usr-gview tbody tr').length === n + 1, before); assert.ok(await p.locator('.vlp-usr-gview').isVisible(), '생성 후에도 그룹 탭 유지');
    await p.click('.vlp-usr-tab[data-view=users]'); assert.ok(await p.locator('.vlp-usr-row').first().isVisible());
    // 폰
    { const ph = await open(b, 'supervisor', 'admin_super', { width: 390, height: 800 }); assert.ok(await ph.locator('.vlp-usr-sortsel').isVisible(), '폰: 정렬 선택칸');
      await ph.selectOption('.vlp-usr-sortsel select', 'name'); assert.strictEqual(await ph.locator('th[data-col=name]').getAttribute('aria-sort'), 'ascending');
      await ph.locator('.vlp-usr-row').first().locator('.vlp-usr-open').click(); await ph.waitForSelector('.vlp-usr-ov');
      assert.ok(await ph.locator('.vlp-usr-list').isHidden(), '폰: 상세가 목록을 대신함'); await ph.locator('.vlp-usr-close').click(); assert.ok(await ph.locator('.vlp-usr-list').isVisible(), '폰: ← 목록으로'); }
    console.log('✔ 폰: 정렬 선택칸 · 목록↔상세 전환');
    // 커뮤니티관리자
    const c = await open(b, 'admin', 'admin_ulsan'); const cn = await c.locator('.vlp-usr-row').count();
    assert.ok(cn <= total, '커뮤니티관리자는 범위 이하'); const ct = await c.locator('.vlp-usr-table').innerText();
    assert.ok(!ct.includes('슈퍼바이저') && ct.includes('커뮤니티관리자'), '다른 관리자는 숨김, 본인만'); assert.strictEqual(await c.locator('.vlp-usr-tab').count(), 0, '그룹 관리 탭은 슈퍼바이저만');
    assert.deepStrictEqual([...p.errs, ...c.errs], []); console.log('✔ 커뮤니티관리자: 담당 범위만, 그룹 관리 없음\nPASS test_admin_users');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
