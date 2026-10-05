/* admin.js (v6) — admin.html(커뮤니티관리자)과 supervisor.html(슈퍼바이저) 둘이 이 스크립트 하나를
 * 공유한다. 두 역할은 성격이 다르다(user-account-role-model-spec.md 1.3/4.5/7장) — 커뮤니티관리자는
 * 배정된 Group 범위 안에서 일상적인 운영(승인·모니터링·대리처리)을 담당하는 "고객관리자"에 가깝고,
 * 슈퍼바이저는 전체 플랫폼에 대한 최종 권한(그룹 카탈로그 생성, 스코프 제한 없는 전체 조회/대리처리)을
 * 갖는 시스템 관리자다. 로그인 화면에 로드되기 전 각 HTML이 `window.ADMIN_MODE`를 'community' 또는
 * 'super'로 지정해두면, 이 스크립트가 그 값에 맞는 계정만 로그인을 허용하고 문구를 맞춘다 — 나머지
 * 로직(스코프 필터링, 탭 구성 등)은 두 화면이 동일하게 공유한다. */
const ADMIN_MODE = window.ADMIN_MODE || 'community';

let careSelectedId = sessionStorage.getItem('v6_admin_care_sel') || null;
let loggedInAdminId = sessionStorage.getItem('v6_admin_id') || null;
let adminTab = sessionStorage.getItem('v6_admin_tab') || 'home';

let showNewCareForm = false;
// 신차케어 목록 필터: all | dispute(이의 중재). 이의 중재 메뉴가 쓴다.
const careFilter = () => { try { return sessionStorage.getItem('v6_admin_care_filter') || 'all'; } catch (e) { return 'all'; } };
const setCareFilter = (f) => { try { sessionStorage.setItem('v6_admin_care_filter', f); } catch (e) { /* 무시 */ } };
// 화면용 상태 이름: 이의 중이면 보완/중재로 구분해서 보여 준다
const CARE_STATUS_KO = { requested: '견적 대기', quoted: '고객 확인 대기', confirmed: '확정' };
function careStatusLabel(c) { return (c.status === '고객검수대기' && c.disputed) ? (c.escalated ? '운영자 중재 중' : `보완 중 (이의 ${c.disputeRounds || 1}회)`) : (CARE_STATUS_KO[c.status] || c.status); }
const careDisputed = (c) => !!(c.disputed && c.status === '고객검수대기');

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function selectCareOrder(id) { careSelectedId = id; showNewCareForm = false; sessionStorage.setItem('v6_admin_care_sel', id); render(); }
function setAdminTab(tab) { if (/case=/.test(window.location.hash || '')) { try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* 무시 */ } } adminTab = tab; sessionStorage.setItem('v6_admin_tab', tab); render(); }

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}
// 관리자는 셀프 온보딩 대상이 아니다(user-account-role-model-spec.md 1.6절) — 슈퍼바이저가 미리 계정을
// 만들어둔다는 전제라, 다른 역할처럼 "신규 등록하기"가 없다. 대신 등록된 슈퍼바이저/커뮤니티관리자
// 전화번호로 로그인한다.
function renderLogin() {
  const modeLabel = ADMIN_MODE === 'super' ? '슈퍼바이저' : '커뮤니티관리자';
  const wrap = el(`<div class="ap-wrap ap-one">
    <section class="ap-card"><h2>${modeLabel} 로그인</h2>
      <p class="ap-sub">등록된 ${modeLabel} 연락처로 로그인합니다.</p>
      <label for="login-phone" class="ap-label">전화번호</label>
      <input id="login-phone" type="tel" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel">
      <label for="login-pw" class="ap-label">비밀번호</label>
      <input id="login-pw" type="password" placeholder="비밀번호" autocomplete="current-password">
      <div class="hint ap-pwhint">시연 버전에서는 비밀번호를 확인하지 않아요. 서비스 정책이 정해지면 여기서 확인합니다.</div>
      <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
      <button class="btn btn-primary ap-go" id="login-submit">로그인</button>
    </section>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  { const pf = new URLSearchParams(location.search).get('prefill'); if (pf) { phoneEl.value = loginPhoneFormat(pf); wrap.querySelector('#login-pw').value = 'demo1234'; submitBtn.focus(); } } // 런처에서 번호·비밀번호를 채워 열기(확인 버튼은 직접 누른다, 데모 전용)
  submitBtn.addEventListener('click', () => {
    const admin = Store.getAdminByPhone(phoneEl.value);
    if (!admin || admin.adminScope !== ADMIN_MODE) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(admin.id);
  });
  return wrap;
}

// 대화 열람 동의: 관리자가 보낸 요청의 진행 상황(대기 건수 칩) + 상태가 바뀌면 알림(토스트). 목 단계는 Store를 직접 본다.
const _consentSeen = {};
function consentChipPaint() {
  const chip = document.getElementById('adm-consent-chip'); if (!chip || typeof Store === 'undefined' || !Store.getChatConsents) return;
  const all = (Store.load().chatConsents || []).filter(c => !c.exception);
  const pend = all.filter(c => Store._consentState(c) === 'pending').length;
  chip.hidden = !pend; chip.textContent = '열람 동의 대기 ' + pend + '건';
}
function consentWatch() {
  if (typeof Store === 'undefined' || !Store.load || !loggedInAdminId) return;
  const label = (id) => { const o = Store.getCareOrder && Store.getCareOrder(id); return o ? (o.carModel || '차량') + ' ' + o.id : id; };
  (Store.load().chatConsents || []).filter(c => !c.exception).forEach(c => {
    const st = Store._consentState(c), prev = _consentSeen[c.id]; _consentSeen[c.id] = st;
    if (!prev || prev === st) return;
    const msg = st === 'granted' ? '두 분 모두 열람에 동의했어요' : st === 'denied' ? '열람 동의가 거부됐어요' : st === 'expired' ? '열람 동의 요청의 기한이 지났어요' : null;
    if (msg && window.VLP && VLP.ui && VLP.ui.toast) VLP.ui.toast(msg + ' · ' + label(c.chatId));
  });
  consentChipPaint();
}
setInterval(consentWatch, 2000);
// ===================== 홈 (관리자 시작 화면: 지금 처리할 것) =====================
const HOME_CTX = 'v6_admin_home_ctx';
function homeCtx() { try { return JSON.parse(sessionStorage.getItem(HOME_CTX) || 'null'); } catch (e) { return null; } }
function setHomeCtx(v) { try { if (v) sessionStorage.setItem(HOME_CTX, JSON.stringify(v)); else sessionStorage.removeItem(HOME_CTX); } catch (e) { /* 무시 */ } }
let _delSummary = { at: 0, ok: false, exceptions: [], stale: [] }, _delBusy = false;
let _delP = null;
function refreshDelSummary() {
  if (_delP) return _delP;
  if (!(window.VLP && VLP.adminConsole && VLP.adminConsole.summary)) return Promise.resolve();
  _delP = (async () => {
    try { const s = await VLP.adminConsole.summary(); _delSummary = { at: Date.now(), ok: true, exceptions: s.exceptions, stale: s.stale }; } catch (e) { /* 다음에 다시 */ } finally { _delP = null; }
  })();
  return _delP;
}
// 홈의 '처리 필요' 줄: 급한 순서는 설정(adminHomeOrder). 담당 범위(커뮤니티관리자)는 careList·업체 목록이 이미 걸러져 있다.
function homeRows(admin, careList) {
  const label = (c) => [c.carModel || '차량', c.customer && c.customer.name].filter(Boolean).join(' · ');
  const care = (f) => careList.filter(f).map(c => ({ kind: 'care', id: c.id, label: label(c) }));
  const shops = Store.getShops().filter(s => s.verificationStatus === 'pending' && shopInAdminScope(s, admin)).map(s => ({ kind: 'shop', id: s.id, label: s.name }));
  const consent = (Store.load().chatConsents || []).filter(c => !c.exception && Store._consentState(c) === 'pending').map(c => { const o = Store.getCareOrder && Store.getCareOrder(c.chatId); return { kind: o ? 'care' : 'delivery', id: c.chatId, label: o ? label(o) : c.chatId }; });
  const R = {
    escalated: { title: '운영자 중재 필요 (신차 케어)', urgent: true, items: care(c => careDisputed(c) && c.escalated), zero: '중재가 필요한 건이 없어요' },
    exception: { title: '지연·예외 (신차 인도)', urgent: true, items: _delSummary.exceptions.map(r => ({ kind: 'delivery', id: r.id, label: r.label })), zero: '지연·예외 건이 없어요', loading: !_delSummary.ok },
    stale: { title: '수집 지연', urgent: true, items: _delSummary.stale.map(r => ({ kind: 'delivery', id: r.id, label: r.label })), zero: '지연된 건이 없어요', loading: !_delSummary.ok },
    dispute: { title: '품질 이의 · 시공사 보완 대기', urgent: true, items: care(c => careDisputed(c) && !c.escalated), zero: '보완 대기 건이 없어요' },
    consent: { title: '대화 열람 동의 대기', items: consent, zero: '응답을 기다리는 요청이 없어요' },
    shops: { title: '업체 승인 대기', items: shops, zero: '승인 대기 업체가 없어요' },
  };
  const order = (window.VLP && VLP.config && VLP.config.get('adminHomeOrder')) || Object.keys(R);
  return order.filter(k => R[k]).map(k => Object.assign({ key: k }, R[k]));
}
const homeTotal = (rows) => rows.reduce((n, r) => n + r.items.length, 0);
function openHomeItem(row, item) {
  setHomeCtx({ key: row.key, kind: item.kind, id: item.id, ids: row.items.map(i => i.id), title: row.title });
  if (item.kind === 'care') {
    setCareFilter(row.key === 'escalated' ? 'escalated' : row.key === 'dispute' ? 'dispute' : 'all');
    adminTab = 'care'; sessionStorage.setItem('v6_admin_tab', 'care'); selectCareOrder(item.id);
  } else if (item.kind === 'delivery') {
    try { sessionStorage.setItem('vlp_adm_filter', row.key === 'stale' ? 'stale' : row.key === 'exception' ? 'exception' : 'all'); } catch (e) { /* 무시 */ }
    adminTab = 'delivery'; sessionStorage.setItem('v6_admin_tab', 'delivery'); render(); VLP.caseView.route.set(item.id);
  } else { setHomeCtx(null); setAdminTab('shops'); }
}
function renderHomeTab(admin, careList) {
  const w = el(`<div class="vlp-adm-home"><div class="vlp-home-sum"><b></b><span class="hint">급한 순서대로 · 눌러서 바로 처리</span></div><div class="vlp-home-rows"></div><div class="vlp-cd vlp-home-recent"><h4>최근 관리자 처리</h4><div class="vlp-an-list"></div></div></div>`);
  const sum = w.querySelector('.vlp-home-sum b'), box = w.querySelector('.vlp-home-rows'), rec = w.querySelector('.vlp-home-recent .vlp-an-list');
  const stamp = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  function paint() {
    if (!document.body.contains(w) && w._painted) return; w._painted = true;
    const rows = homeRows(admin, careList); sum.textContent = '오늘 처리할 건 ' + homeTotal(rows); box.innerHTML = '';
    rows.forEach((r) => {
      const n = r.items.length, b = el('<button type="button" class="vlp-home-row"><span class="hn"></span><span class="ht"><b></b><small></small></span><span class="go" aria-hidden="true">›</span></button>');
      b.dataset.home = r.key; b.querySelector('.hn').textContent = r.loading && !n ? '…' : String(n); b.querySelector('b').textContent = r.title;
      b.querySelector('small').textContent = n ? r.items[0].label + (n > 1 ? ' 외 ' + (n - 1) + '건' : '') : (r.loading ? '불러오는 중…' : r.zero);
      if (!n) { b.disabled = true; b.classList.add('z'); b.querySelector('.go').hidden = true; } else if (r.urgent) b.classList.add('u');
      b.addEventListener('click', () => openHomeItem(r, r.items[0])); box.appendChild(b);
    });
    paintHomeDot(rows);
    rec.innerHTML = ''; const acts = Store.getRecentAdminActions ? Store.getRecentAdminActions(5) : [];
    if (!acts.length) rec.appendChild(el('<div class="hint vlp-an-empty">아직 관리자 처리 기록이 없어요.</div>'));
    acts.forEach((a) => { const e = el('<div class="vlp-an-row"><div class="vlp-an-meta hint"></div><div class="vlp-an-text"></div></div>'); e.querySelector('.vlp-an-meta').textContent = stamp(a.at) + ' · ' + a.by; e.querySelector('.vlp-an-text').textContent = a.text + ' (' + a.caseId + ')'; rec.appendChild(e); });
  }
  paint(); refreshDelSummary().then(() => { if (document.body.contains(w)) paint(); });
  return w;
}
function paintHomeDot(rows) {
  const dot = document.querySelector('.vlp-adm-nav-btn[data-menu=home] .vlp-adm-dot'); if (!dot) return;
  const n = homeTotal(rows); dot.hidden = !n; dot.textContent = n ? '●' + n : '';
}
// 홈에서 연 건의 상세 맨 위 "← 홈으로" 막대 / 처리 후 안내 (홈을 거치지 않고 연 건에는 나오지 않는다)
window.VLP = window.VLP || {};
VLP.adminHome = {
  crumb(root, id) {
    const ctx = homeCtx(); if (!ctx || ctx.id !== id || !root) return;
    const k = ctx.ids.indexOf(id) + 1, bar = el('<div class="vlp-home-crumb" role="note"><span></span><button type="button" class="btn btn-sm">← 홈으로</button></div>');
    bar.querySelector('span').textContent = '🏠 홈에서 열었어요 · ' + ctx.title + ' ' + ctx.ids.length + '건 중 ' + (k || 1) + '번째';
    bar.querySelector('button').addEventListener('click', () => { setHomeCtx(null); setAdminTab('home'); });
    root.insertBefore(bar, root.firstChild);
  },
};
function homeDoneBanner(admin, careList) {
  const ctx = homeCtx(); if (!ctx || ctx.kind !== 'care') return null;
  if (careSelectedId && careSelectedId !== ctx.id) { setHomeCtx(null); return null; }
  const rows = homeRows(admin, careList), row = rows.find(r => r.key === ctx.key);
  if (!row || row.items.some(i => i.id === ctx.id)) return null; // 아직 처리 필요
  const left = homeTotal(rows), next = rows.find(r => r.items.length && r.urgent) || rows.find(r => r.items.length);
  const b = el('<div class="vlp-home-done" role="status"><span></span><span class="vlp-home-acts"></span></div>');
  b.querySelector('span').textContent = '✓ 처리했어요. 처리 필요가 ' + left + '건 남았어요.';
  const acts = b.querySelector('.vlp-home-acts');
  if (next) { const nb = el('<button type="button" class="btn btn-sm btn-primary">다음 급한 건 보기</button>'); nb.addEventListener('click', () => openHomeItem(next, next.items[0])); acts.appendChild(nb); }
  const hb = el('<button type="button" class="btn btn-sm">홈으로</button>'); hb.addEventListener('click', () => { setHomeCtx(null); setAdminTab('home'); }); acts.appendChild(hb);
  return b;
}
setInterval(() => { if (loggedInAdminId && Date.now() - _delSummary.at > 15000) refreshDelSummary().then(() => { try { const ad = Store.getAdmin(loggedInAdminId); if (ad) paintHomeDot(homeRows(ad, Store.getCareOrders().filter(c => careOrderInAdminScope(c, ad)))); } catch (e) { /* 무시 */ } }); }, 5000);

function tryLogin(id, tab) { loggedInAdminId = id; sessionStorage.setItem('v6_admin_id', id); adminTab = tab || 'home'; sessionStorage.setItem('v6_admin_tab', adminTab); setHomeCtx(null); render(); }
function logout() { loggedInAdminId = null; sessionStorage.removeItem('v6_admin_id'); render(); }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInAdminId) {
    if (VLP.rolebar) VLP.rolebar.set({ role: 'admin', roleLabel: ADMIN_MODE === 'super' ? '슈퍼바이저' : '커뮤니티관리자', name: '', sync: true, note: window.ADMIN_ROLE_NOTE || '' });
    root.appendChild(renderLogin());
    return;
  }
  const admin = Store.getAdmin(loggedInAdminId);
  const isSuper = admin.adminScope === 'super';
  // 커뮤니티관리자는 배정된 Group에 속한 카마스터/시공업체가 처리하는 건만 본다(1.3절) — 슈퍼바이저는 전체.
  const careList = Store.getCareOrders().filter(c => careOrderInAdminScope(c, admin));
  const pendingShopCount = Store.getShops().filter(s => s.verificationStatus === 'pending' && shopInAdminScope(s, admin)).length;
  const scopeLabel = isSuper ? '슈퍼바이저 · 전체 권한' : `커뮤니티관리자 · 담당 그룹: ${(admin.assignedGroupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '없음'}`;
  if (VLP.rolebar) VLP.rolebar.set({ role: 'admin', roleLabel: isSuper ? '슈퍼바이저' : '커뮤니티관리자', name: `${admin.name} (${scopeLabel.replace(/^[^·]*· /, '')})`, sync: true, note: window.ADMIN_ROLE_NOTE || '' });

  let effectiveTab = adminTab;
  if (effectiveTab === 'home' && /case=/.test(window.location.hash || '')) effectiveTab = 'delivery'; // 건 주소(#case=…)로 열면 건 목록으로
  const tabRenderers = { home: () => renderHomeTab(admin, careList), care: () => renderCareTab(careList), users: () => VLP.adminUsers.render(admin, isSuper ? renderGroupCatalogSection() : null), shops: () => renderShopApprovalTab(admin) };
  {
    // 운영 관제 콘솔(구성안 5.4): 왼쪽 메뉴 + 건 목록 + 상세 + 우측 대화 감독
    const filt = (() => { try { return sessionStorage.getItem('vlp_adm_filter') || 'all'; } catch (e) { return 'all'; } })();
    const shell = el(`<div class="vlp-adm"><nav class="vlp-adm-nav" aria-label="관리 메뉴"></nav><div class="vlp-adm-main"></div></div>`);
    const nav = shell.querySelector('.vlp-adm-nav');
    const NAV_ICO = { home: '🏠', cases: '📋', exceptions: '⚠️', care: '🔧', dispute: '⚖️', users: '👥', shops: '🏢', logout: '↩︎' };
    const addNav = (id, label, on, run, extra) => { const b = el('<button type="button" class="vlp-adm-nav-btn"><span class="vlp-adm-ico" aria-hidden="true"></span><span class="vlp-adm-lbl"></span></button>'); b.dataset.menu = id; b.querySelector('.vlp-adm-ico').textContent = NAV_ICO[id] || ''; b.querySelector('.vlp-adm-lbl').textContent = label; b.setAttribute('aria-label', label.replace(/\s*\(\d+\)$/, '')); b.title = label; if (on) b.setAttribute('aria-current', 'page'); b.addEventListener('click', run); if (extra) b.appendChild(extra); nav.appendChild(b); return b; };
    const setFilter = (f) => { try { sessionStorage.setItem('vlp_adm_filter', f); } catch (e) { /* 무시 */ } };
    addNav('home', '홈', effectiveTab === 'home', () => { setHomeCtx(null); setAdminTab('home'); }, el('<span class="vlp-adm-dot" hidden></span>'));
    addNav('cases', '건 목록', effectiveTab === 'delivery' && filt !== 'exception', () => { setFilter('all'); setAdminTab('delivery'); });
    const exq = addNav('exceptions', '예외 큐', effectiveTab === 'delivery' && filt === 'exception', () => { setFilter('exception'); setAdminTab('delivery'); }, el('<span class="vlp-adm-dot" hidden></span>'));
    const paintExDot = (n) => { const dot = exq.querySelector('.vlp-adm-dot'); if (!dot) return; if (dot.hidden !== !n) dot.hidden = !n; const t = n ? '●' + n : ''; if (dot.textContent !== t) dot.textContent = t; };
    window.addEventListener('vlp-adm-counts', (e) => { if (!document.body.contains(exq)) return; paintExDot(e.detail.exception); });
    if (_delSummary.ok) paintExDot(_delSummary.exceptions.length); // 메뉴를 바꿔 메뉴줄을 다시 만들어도 직전에 알던 개수를 바로 보인다(다른 메뉴의 숫자와 같게)
    if (!_delSummary.ok || Date.now() - _delSummary.at > 5000) refreshDelSummary().then(() => { if (document.body.contains(exq)) paintExDot(_delSummary.exceptions.length); });
    const disputeN = careList.filter(careDisputed).length;
    addNav('care', '신차 케어 서비스', effectiveTab === 'care' && careFilter() !== 'dispute', () => { setCareFilter('all'); setAdminTab('care'); });
    addNav('dispute', '이의 중재', effectiveTab === 'care' && careFilter() === 'dispute', () => { setCareFilter('dispute'); setAdminTab('care'); }, el(`<span class="vlp-adm-dot"${disputeN ? '' : ' hidden'}>${disputeN ? '●' + disputeN : ''}</span>`));
    addNav('users', isSuper ? '사용자/그룹' : '사용자', effectiveTab === 'users', () => setAdminTab('users'));
    addNav('shops', `업체 승인${pendingShopCount ? ` (${pendingShopCount})` : ''}`, effectiveTab === 'shops', () => setAdminTab('shops'));
    { const chip = el('<span class="vlp-adm-chip" id="adm-consent-chip" hidden></span>'); nav.appendChild(chip); consentChipPaint(); }
    addNav('logout', '로그아웃', false, () => logout());
    // 폰(<768px): [홈] + [현재 메뉴 ▾] 드롭다운. 나머지 메뉴는 목록으로(아이콘+글자+건수 점), CSS가 폰에서만 보인다.
    {
      const more = el('<button type="button" class="vlp-adm-more" aria-haspopup="menu" aria-expanded="false"><span class="vlp-adm-ico" aria-hidden="true">☰</span><span class="vlp-adm-lbl"></span><span class="vlp-adm-dot" hidden></span><i aria-hidden="true">▾</i></button>');
      const panel = el('<div class="vlp-adm-panel" role="menu" aria-label="관리 메뉴 목록" hidden></div>');
      const btns = () => [...nav.querySelectorAll('.vlp-adm-nav-btn')], cur = () => btns().find(b => b.getAttribute('aria-current') === 'page');
      const dotN = (b) => { const d = b.querySelector('.vlp-adm-dot'); return d && !d.hidden ? (parseInt((d.textContent || '').replace(/\D/g, ''), 10) || 1) : 0; };
      const setT = (e, v) => { if (e.textContent !== v) e.textContent = v; };
      const paintMore = () => { const c = cur(), isHome = !c || c.dataset.menu === 'home'; setT(more.querySelector('.vlp-adm-ico'), isHome ? '☰' : (c.querySelector('.vlp-adm-ico') || {}).textContent || '☰'); setT(more.querySelector('.vlp-adm-lbl'), isHome ? '메뉴' : (c.getAttribute('aria-label') || c.title));
        const n = btns().filter(b => b.dataset.menu !== 'home' && b !== c).reduce((a, b) => a + dotN(b), 0), d = more.querySelector('.vlp-adm-dot'); if (d.hidden !== !n) d.hidden = !n; setT(d, n ? '●' + n : ''); };
      const close = () => { panel.hidden = true; more.setAttribute('aria-expanded', 'false'); };
      const openP = () => { panel.innerHTML = ''; btns().filter(b => b.dataset.menu !== 'home').forEach((b) => { const mi = el('<button type="button" role="menuitem" class="vlp-adm-mi"><span class="vlp-adm-ico" aria-hidden="true"></span><span class="mt"></span><span class="vlp-adm-dot" hidden></span></button>'); mi.dataset.menu = b.dataset.menu; mi.querySelector('.vlp-adm-ico').textContent = (b.querySelector('.vlp-adm-ico') || {}).textContent || ''; mi.querySelector('.mt').textContent = b.getAttribute('aria-label') || b.title; const n = dotN(b), d = mi.querySelector('.vlp-adm-dot'); if (n) { d.hidden = false; d.textContent = '●' + n; } if (b.getAttribute('aria-current') === 'page') mi.setAttribute('aria-current', 'page'); if (b.dataset.menu === 'logout') mi.classList.add('sep'); mi.addEventListener('click', () => { close(); b.click(); }); panel.appendChild(mi); }); panel.hidden = false; more.setAttribute('aria-expanded', 'true'); const f = panel.querySelector('.vlp-adm-mi'); if (f) f.focus(); };
      more.addEventListener('click', () => { if (panel.hidden) openP(); else close(); });
      panel.addEventListener('keydown', (e) => { const items = [...panel.querySelectorAll('.vlp-adm-mi')], i = items.indexOf(document.activeElement); if (e.key === 'Escape') { close(); more.focus(); } else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); } });
      document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !more.contains(e.target)) close(); });
      nav.appendChild(more); nav.appendChild(panel); paintMore();
      try { new MutationObserver(() => { if (document.body.contains(nav)) paintMore(); }).observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-current'] }); } catch (e) { /* 무시 */ }
    }
    // 태블릿·PC(≥768px): 들어가는 만큼만 보이고, 넘치는 메뉴는 로그아웃 앞 [⋯ n]에 묶는다(가로 스크롤 막대 없음). 선택한 메뉴는 항상 보인다.
    {
      const ovf = el('<button type="button" class="vlp-adm-ovf" aria-haspopup="menu" aria-expanded="false" hidden><span class="vlp-adm-ico" aria-hidden="true">⋯</span><span class="vlp-adm-ovn"></span><span class="vlp-adm-dot" hidden></span></button>');
      const pan = el('<div class="vlp-adm-ovp" role="menu" aria-label="더 많은 메뉴" hidden></div>');
      const logoutB = nav.querySelector('.vlp-adm-nav-btn[data-menu=logout]'); nav.insertBefore(ovf, logoutB); nav.appendChild(pan);
      const wideMq = window.matchMedia ? window.matchMedia('(min-width: 768px)') : { matches: true };
      const items = () => [...nav.querySelectorAll('.vlp-adm-nav-btn')].filter(b => b.dataset.menu !== 'logout');
      const dotN = (b) => { const d = b.querySelector('.vlp-adm-dot'); return d && !d.hidden ? (parseInt((d.textContent || '').replace(/\D/g, ''), 10) || 1) : 0; };
      const setT = (e, v) => { if (e.textContent !== v) e.textContent = v; };
      const closeP = () => { if (!pan.hidden) pan.hidden = true; ovf.setAttribute('aria-expanded', 'false'); };
      let hiddenList = [], raf = 0;
      const fit = () => {
        raf = 0; if (!document.body.contains(nav)) return;
        const all = items(); all.forEach(b => b.classList.remove('ovf-hide'));
        if (!wideMq.matches) { ovf.hidden = true; nav.classList.remove('has-ovf'); hiddenList = []; closeP(); return; }
        ovf.hidden = true; nav.classList.remove('has-ovf');
        const room = nav.clientWidth;
        if (nav.scrollWidth <= room + 1) { hiddenList = []; closeP(); return; }
        ovf.hidden = false; nav.classList.add('has-ovf'); setT(ovf.querySelector('.vlp-adm-ovn'), String(all.length));
        const cs = getComputedStyle(nav), gap = parseFloat(cs.columnGap || cs.gap) || 4, padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
        const fixed = [...nav.children].filter(c => !all.includes(c) && c !== pan && !c.hidden && getComputedStyle(c).display !== 'none').reduce((a, c) => a + c.offsetWidth + gap, 0);
        let avail = room - padX - fixed; const cur = all.find(b => b.getAttribute('aria-current') === 'page'), keep = new Set();
        if (cur) { keep.add(cur); avail -= cur.offsetWidth + gap; }
        for (const b of all) { if (keep.has(b)) continue; if (avail - (b.offsetWidth + gap) >= 0) { keep.add(b); avail -= b.offsetWidth + gap; } else break; }
        hiddenList = all.filter(b => !keep.has(b)); hiddenList.forEach(b => b.classList.add('ovf-hide'));
        const n = hiddenList.length, sum = hiddenList.reduce((a, b) => a + dotN(b), 0), d = ovf.querySelector('.vlp-adm-dot');
        setT(ovf.querySelector('.vlp-adm-ovn'), String(n)); if (d.hidden !== !sum) d.hidden = !sum; setT(d, sum ? '●' + sum : '');
        ovf.setAttribute('aria-label', '더 많은 메뉴 ' + n + '개' + (sum ? ', 알림 ' + sum + '건' : ''));
        if (!n) { ovf.hidden = true; nav.classList.remove('has-ovf'); }
      };
      const sched = () => { if (!raf) raf = requestAnimationFrame(fit); };
      // 패널은 fixed 로 띄운다: 상단 메뉴줄의 overflow(clip)·쌓임 문맥에 잘리거나 가려지지 않게(아이패드 사파리에서 포커스만 가고 메뉴가 안 보이던 문제 대응)
      const placeP = () => { if (pan.hidden) return; const r = ovf.getBoundingClientRect(); pan.style.top = Math.round(r.bottom + 4) + 'px'; pan.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px'; pan.style.left = 'auto'; };
      const openP = () => {
        pan.innerHTML = '';
        hiddenList.forEach((b) => { const mi = el('<button type="button" role="menuitem" class="vlp-adm-mi"><span class="vlp-adm-ico" aria-hidden="true"></span><span class="mt"></span><span class="vlp-adm-dot" hidden></span></button>'); mi.dataset.menu = b.dataset.menu; mi.querySelector('.vlp-adm-ico').textContent = (b.querySelector('.vlp-adm-ico') || {}).textContent || ''; mi.querySelector('.mt').textContent = b.getAttribute('aria-label') || b.title || (b.querySelector('.vlp-adm-lbl') || {}).textContent || ''; const n = dotN(b); if (n) { const dd = mi.querySelector('.vlp-adm-dot'); dd.hidden = false; dd.textContent = '●' + n; } mi.addEventListener('click', () => { closeP(); b.click(); }); pan.appendChild(mi); });
        pan.hidden = false; placeP(); ovf.setAttribute('aria-expanded', 'true'); const f = pan.querySelector('.vlp-adm-mi'); if (f) f.focus({ preventScroll: true });
      };
      ovf.addEventListener('click', () => { if (pan.hidden) openP(); else closeP(); });
      pan.addEventListener('keydown', (e) => { const its = [...pan.querySelectorAll('.vlp-adm-mi')], i = its.indexOf(document.activeElement); if (e.key === 'Escape') { closeP(); ovf.focus(); } else if (e.key === 'ArrowDown') { e.preventDefault(); (its[i + 1] || its[0]).focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (its[i - 1] || its[its.length - 1]).focus(); } });
      document.addEventListener('click', (e) => { if (!pan.hidden && !pan.contains(e.target) && !ovf.contains(e.target)) closeP(); });
      window.addEventListener('resize', () => { sched(); placeP(); }); window.addEventListener('scroll', placeP, { passive: true });
      try { new ResizeObserver(sched).observe(nav); } catch (e) { /* 무시 */ }
      try { new MutationObserver(sched).observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-current'] }); } catch (e) { /* 무시 */ }
      shell.__fitNav = fit; // 화면에 붙인 직후 바로 한 번 맞춘다(첫 그림에 메뉴가 전부 보였다 줄어드는 깜박임 방지)
      requestAnimationFrame(() => requestAnimationFrame(fit)); try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(sched); } catch (e) { /* 무시 */ }
    }
    const main = shell.querySelector('.vlp-adm-main');
    { const bn = effectiveTab === 'care' ? homeDoneBanner(admin, careList) : null; if (bn) main.appendChild(bn); }
    if (tabRenderers[effectiveTab]) main.appendChild(tabRenderers[effectiveTab]());
    else {
      main.appendChild(VLP.adminConsole.render());
    }
    root.appendChild(shell); try { if (shell.__fitNav) shell.__fitNav(); } catch (e) { /* 무시 */ }
    paintHomeDot(homeRows(admin, careList)); refreshDelSummary().then(() => { try { paintHomeDot(homeRows(admin, careList)); } catch (e) { /* 무시 */ } });
  }
}

// ===================== 통합 사용자 탭 (user-account-role-model-spec.md 1.1/1.3/3장) =====================
// 전화번호를 공통 식별자로 삼아 역할 속성(roleAttributes)이 쌓이는 것을 보여준다 — "한 사람 = 하나의
// 계정 + 여러 역할 속성" 원칙과, 카마스터가 개인 차량을 구매하는 식의 겸임(상호주의) 사례를 확인하는
// 화면이다. 그룹(Group) 카탈로그 관리도 여기 함께 둔다 — 그룹 생성은 슈퍼바이저만 가능하다는 원칙에
// 따라(1.3절), 슈퍼바이저·커뮤니티관리자가 아직 분리되지 않은 이 데모에서는 관리자 계정이 슈퍼바이저를
// 겸한다. Shop 독립 레지스트리·실명 비노출 등 나머지 계정 모델 요소는 이번 범위 밖이다.
const ROLE_ATTR_LABELS = { customer: '구매자', karmaster: '카마스터', shop: '시공업체' };
const GROUP_TYPE_LABELS = { region: '지역', community: '커뮤니티', industry: '산업군' };
function renderGroupCatalogSection() {
  const box = el(`<div class="vlp-cd vlp-grp-new">
    <h4>새 그룹 만들기</h4>
    <div class="btn-row" style="margin-top:8px;">
      <input id="grp-name" type="text" placeholder="그룹명 (예: 대전)" style="flex:2;" autocomplete="off" aria-label="그룹명">
      <select id="grp-type" style="flex:1;" aria-label="그룹 유형">
        <option value="region">지역</option>
        <option value="community">커뮤니티</option>
        <option value="industry">산업군</option>
      </select>
      <button class="btn btn-sm" id="grp-create">그룹 생성</button>
    </div>
  </div>`);
  box.querySelector('#grp-create').addEventListener('click', () => {
    const nameEl = box.querySelector('#grp-name');
    if (!nameEl.value.trim()) return;
    Store.createGroup({ name: nameEl.value.trim(), type: box.querySelector('#grp-type').value }, 'admin-supervisor');
    render();
  });
  return box;
}

// ===================== 업체 승인 탭 (user-account-role-model-spec.md 4.3절) =====================
// 신규 등록된 업체(verificationStatus:'pending')를 사업자등록증 이미지로 육안 확인 후 승인/반려한다.
// 이 데모에서는 슈퍼바이저/커뮤니티관리자가 아직 분리되지 않아 관리자 계정이 커뮤니티관리자를 겸한다.
function renderShopApprovalTab(admin) {
  const shops = Store.getShops().filter(s => shopInAdminScope(s, admin));
  const pending = shops.filter(s => s.verificationStatus === 'pending');
  const processed = shops.filter(s => s.verificationStatus !== 'pending');
  const wrap = el(`<div class="vlp-shops"></div>`);
  wrap.appendChild(el(`<div class="vlp-pane-head"><h2>업체 승인</h2></div>`));
  const scopeNote = admin.adminScope === 'community' ? ' 담당 그룹에 속한 업체만 보입니다.' : '';
  wrap.appendChild(el(`<div class="hint" style="margin-bottom:var(--t-gap-bottom);">신규 업체 등록 요청을 사업자등록증 이미지로 육안 확인한 뒤 승인/반려합니다. 승인 전에는 고객 화면에 노출되지 않습니다.${scopeNote}</div>`));
  if (pending.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">🏢</div>승인 대기 중인 업체가 없습니다.</div>`));
  } else {
    const grid = el(`<div class="vlp-shop-grid"></div>`); wrap.appendChild(grid);
    pending.forEach(s => {
      const groupNames = (s.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-';
      const card = el(`<div class="admin-controls">
        <h4>${s.name} <span class="badge wait">승인 대기</span></h4>
        <div class="summary-line"><span>대표 전화번호</span><span>${s.phone}</span></div>
        <div class="summary-line"><span>사업자등록번호</span><span>${s.businessRegistrationNumber}</span></div>
        <div class="summary-line"><span>대표자성명</span><span>${s.businessRepresentativeName}</span></div>
        <div class="summary-line"><span>개업일자</span><span>${s.businessStartDate}</span></div>
        <div class="summary-line"><span>소속 그룹</span><span>${groupNames}</span></div>
        ${s.businessRegistrationDocUrl ? `<img src="${s.businessRegistrationDocUrl}" style="max-width:200px;border-radius:8px;border:1px solid #ddd;margin-top:8px;">` : '<div class="hint">사업자등록증 이미지 없음</div>'}
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="shop-approve-${s.id}">승인</button>
          <button class="btn btn-danger btn-sm" id="shop-reject-${s.id}">반려</button>
        </div>
      </div>`);
      card.querySelector(`#shop-approve-${s.id}`).addEventListener('click', () => { Store.approveShop(s.id); render(); });
      card.querySelector(`#shop-reject-${s.id}`).addEventListener('click', () => { Store.rejectShop(s.id); render(); });
      grid.appendChild(card);
    });
  }
  if (processed.length) {
    wrap.appendChild(el(`<h3 style="margin-top:var(--k-sec-mt);">전체 업체 현황</h3>`));
    const table = el(`<table><tr><th>업체명</th><th>상태</th><th>소속 그룹</th></tr></table>`);
    processed.forEach(s => {
      const ok = !s.verificationStatus || s.verificationStatus === 'approved';
      const statusLabel = ok ? '승인됨' : '반려됨';
      const groupNames = (s.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-';
      table.appendChild(elRow(`<tr><td>${s.name}</td><td><span class="badge ${ok ? 'done' : 'warn'}">${statusLabel}</span></td><td>${groupNames}</td></tr>`));
    });
    wrap.appendChild(table);
  }
  return wrap;
}

// ===================== 신차 케어 서비스 탭 (신차인도서비스와 완전히 독립된 최상위 목록) =====================
const CARE_FILTERS = [['all', '전체', () => true], ['quote', '견적 대기', c => c.status === 'requested'], ['confirm', '고객확인 대기', c => c.status === 'quoted'],
  ['active', '진행중 시공', c => SHOP_DISPLAY_STAGES.some(s => s.code === c.status)], ['wait', '확인 대기', c => ['고객검수대기', '수령대기'].includes(c.status)],
  ['dispute', '품질 이의', c => careDisputed(c)], ['escalated', '운영자 중재 필요', c => careDisputed(c) && c.escalated], ['done', '완료', c => c.status === '수령확인' && c.shopRated]];
function renderCareTab(careList) {
  const head = () => el(`<div class="vlp-pane-head"><h2>${careFilter() === 'dispute' ? '이의 중재' : '신차 케어 서비스'}</h2>
    <button class="btn btn-primary" style="width:auto;padding:10px 18px;" onclick="toggleNewCareForm()">${showNewCareForm ? '← 목록으로' : '+ 대리 신청'}</button>
  </div>`);
  if (showNewCareForm) { const w = el(`<div></div>`); w.appendChild(head()); w.appendChild(renderNewCareForm()); return w; }
  if (careList.length === 0) { const w = el(`<div></div>`); w.appendChild(head()); w.appendChild(el(`<div class="empty-state"><div class="big">🛠️</div>아직 신청된 신차 케어 서비스가 없습니다.</div>`)); return w; }

  // 건 목록과 같은 틀: 윗줄(제목+필터 칩) · 목록(카드 행) · 상세. 목록이 길면 목록만 스크롤(vlp-boot.js 칸 모드).
  const wide = window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
  const wrap = el(`<div class="vlp-app vlp-app-admin lay-top" data-tab="care"><div class="vlp-app-strip"></div><div class="vlp-app-list" id="admin-care-list"></div><div class="vlp-app-detail" id="admin-care-detail"></div></div>`);
    try { wrap.classList.toggle('list-closed', !!(window.VLP && VLP.caseView && VLP.caseView.listClosed && VLP.caseView.listClosed())); } catch (e) { /* 무시 */ } // 접힘을 첫 그림부터 적용(나중에 적용하면 목록이 한 번 보였다 사라져 깜박임)
  const strip = wrap.querySelector('.vlp-app-strip'), listBox = wrap.querySelector('#admin-care-list'), detailBox = wrap.querySelector('#admin-care-detail');
  const top = wide ? strip : listBox; strip.hidden = !wide;
  top.appendChild(head());
  const fk = careFilter(), cur = CARE_FILTERS.find(f => f[0] === fk) || CARE_FILTERS[0];
  const chips = el(`<div class="vlp-chip-row" role="group" aria-label="상태 필터"></div>`); top.appendChild(chips);
  CARE_FILTERS.forEach(([id, label, test]) => {
    const n = careList.filter(test).length, b = el(`<button type="button" class="vlp-chip"></button>`);
    b.dataset.filter = id; b.appendChild(document.createElement('span')).textContent = label; b.appendChild(document.createTextNode(' ')); b.appendChild(document.createElement('b')).textContent = String(n);
    if (!n && id !== 'all') b.classList.add('zero'); b.setAttribute('aria-pressed', id === cur[0] ? 'true' : 'false');
    b.addEventListener('click', () => { setCareFilter(id); render(); }); chips.appendChild(b);
  });
  // 운영자 중재가 필요한 건 → 시공사 보완 대기 → 나머지 순
  const rank = c => (careDisputed(c) && c.escalated) ? 0 : careDisputed(c) ? 1 : 2;
  const shown = careList.filter(cur[2]).map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c);
  // 선택한 건이 이 목록에 없으면 상세에 남기지 않는다. 넓은 화면은 맨 위 건을 연다.
  if (careSelectedId && !shown.some(c => c.id === careSelectedId)) careSelectedId = null;
  if (!careSelectedId && wide && shown.length) careSelectedId = shown[0].id;
  if (careSelectedId) sessionStorage.setItem('v6_admin_care_sel', careSelectedId); else sessionStorage.removeItem('v6_admin_care_sel');
  if (!shown.length) listBox.appendChild(el(`<div class="hint">${cur[0] === 'dispute' ? '이의가 접수된 건이 없습니다.' : '해당하는 신청이 없어요.'}</div>`));
  const rows = el(`<div class="vlp-rows"></div>`); listBox.appendChild(rows);
  shown.forEach(c => {
    const shop = Store.getShop(c.shopId), on = c.id === careSelectedId;
    const r = el(`<button type="button" class="vlp-case-row${careDisputed(c) ? ' urgent' : ''}${on ? ' on' : ''}"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-row-badge"></span></span><span class="hint vlp-row-sub"></span><span class="vlp-row-prog"></span></button>`);
    r.dataset.careId = c.id; if (on) r.setAttribute('aria-current', 'true');
    r.querySelector('.vlp-row-title').textContent = c.carModel || '차종 미입력';
    r.querySelector('.vlp-row-badge').innerHTML = `<span class="badge ${careDisputed(c) ? 'wait' : amBadgeClass(c.status)}">${careStatusLabel(c)}</span>`;
    r.querySelector('.vlp-row-sub').textContent = [c.id, c.customer.name, shop ? shop.name : ''].filter(Boolean).join(' · ');
    r.querySelector('.vlp-row-prog').textContent = careDisputed(c) ? (c.escalated ? '운영자 중재 필요' : `시공사 보완 대기 · 이의 ${c.disputeRounds || 1}회`) : (c.package && c.package.name) || '';
    r.addEventListener('click', () => selectCareOrder(c.id)); rows.appendChild(r);
  });
  const current = careSelectedId ? Store.getCareOrder(careSelectedId) : null;
  wrap.classList.toggle('has-case', !!current && wide); // 폰은 목록 아래에 상세가 이어진다(돌아가기 버튼이 없어 목록을 숨기지 않음)
  detailBox.appendChild(current ? renderCareDetail(current) : el(`<div class="vlp-empty-detail hint">왼쪽에서 신청 건을 선택해 주세요.</div>`));
  return wrap;
}
function toggleNewCareForm() { showNewCareForm = !showNewCareForm; render(); }

// 신차 케어 서비스는 "내 차량"(=신차인도서비스 예약) 중 하나를 골라 시작한다 — 관리자는 전체
// 예약 중에서 대신 고를 수 있다.
let newCareDraft = { reservationId: null };
function renderNewCareForm() {
  const d = newCareDraft;
  const cars = Store.getReservations();
  const carCards = cars.map(r => `<div class="km-card ${d.reservationId === r.id ? 'sel' : ''}" onclick="selectDraftCar('${r.id}')"><div class="name">${r.carModel || '차종 미정'}</div><div class="rating">${r.id} · ${r.customer.name}</div></div>`).join('');
  const shop = Store.getApprovedShops()[0];
  const wrap = el(`<div style="max-width:560px;">
    <h3>신차 케어 서비스 대리 신청</h3>
    <label>대상 차량 (신차인도서비스 예약)</label>
    <div class="km-grid">${carCards || '<div class="hint">등록된 차량(신차인도서비스 예약)이 없습니다.</div>'}</div>
    <button class="btn btn-primary btn-auto" id="a-care-submit" style="margin-top:14px;" ${!d.reservationId ? 'disabled' : ''}>대리 신청 (${shop.name}, 스탠다드, 온라인 즉시견적)</button>
  </div>`);
  wrap.querySelector('#a-care-submit').addEventListener('click', () => {
    const order = Store.requestCareOrder({ reservationId: d.reservationId, shopId: shop.id, mode: 'online', packageId: PACKAGES[1].id, optionIds: [], customRequest: '' });
    newCareDraft = { reservationId: null };
    showNewCareForm = false;
    selectCareOrder(order.id);
  });
  return wrap;
}
function selectDraftCar(id) { newCareDraft.reservationId = id; render(); }

// 운영자가 중재·확인할 때 필요한 값: 입고 경로·주행거리·수령 방식·청구(견적+추가)·포인트·이의 회차
function careInfoHTML(c) {
  const cfgv = (k) => (window.VLP && VLP.config ? VLP.config.get(k) : null);
  const route = ((cfgv('careIntakeRoutes') || []).find(r => r.code === c.intakeRoute) || {}).label || (c.intakeRoute || '입고 전');
  const mode = ((cfgv('careReceiveModes') || []).find(m => m.code === (c.receiveMode || cfgv('careDefaultReceiveMode'))) || {}).label || '-';
  const extra = c.chargedPrice != null && c.quotedPrice != null ? Math.max(0, c.chargedPrice - c.quotedPrice) : null;
  const charge = c.quotedPrice == null ? '견적 전' : (c.chargedPrice == null ? `견적 ${fmtMoney(c.quotedPrice)} · 청구 전` : `견적 ${fmtMoney(c.quotedPrice)} + 추가 ${fmtMoney(extra)}${c.chargeNote ? ' (' + c.chargeNote + ')' : ''}`);
  const rows = [['입고 경로', route], ['주행거리', c.mileage != null ? Number(c.mileage).toLocaleString('ko-KR') + ' km' : '-'], ['사전 촬영', (c.intakePhotos || []).length ? (c.intakePhotos.length + '장') : '-'], ['수령 방식', mode], ['청구', charge], ['포인트 사용', c.pointsUsed ? fmtMoney(c.pointsUsed).replace('원', 'P') : '-']];
  if (careDisputed(c)) rows.push(['이의', `${c.disputeRounds || 1}회째 · ${c.disputeReason || '(사유 없음)'}`]);
  return `<div class="admin-controls" style="margin-bottom:14px;">${rows.map(([k, v]) => `<div class="summary-line"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
}
function renderCareDetail(c) {
  const shop = Store.getShop(c.shopId), V = window.VLP, U = V.ui;
  const disputed = careDisputed(c);
  const badgeHTML = `<span class="badge ${disputed ? 'wait' : amBadgeClass(c.status)}">${careStatusLabel(c)}</span>`;
  const nextText = disputed ? (c.escalated ? '이의 한도를 넘어 운영자 중재가 필요합니다. 아래에서 중재를 처리해 주세요.' : '시공사가 보완 중입니다. 운영자 조치는 필요하지 않습니다.') : `${c.customer.name} 고객 · ${shop ? shop.name : '시공사 미정'}`;
  // 탭은 고객·시공사 케어 상세와 같은 결: 개요 · 진행 · 이력 (운영자는 처리할 일이 있는 진행 탭을 먼저 연다)
  const photosCard = (title, list) => {
    const box = el(`<div class="vlp-cd"><h4></h4><div class="care-photos"></div></div>`); box.querySelector('h4').textContent = title + ' ' + list.length + '장';
    list.forEach((p) => { const f = el('<figure class="care-photo"><img alt=""><figcaption class="hint"></figcaption></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = (p.label || title) + ' 사진'; f.querySelector('figcaption').textContent = p.label || ''; box.querySelector('.care-photos').appendChild(f); });
    return box;
  };
  const fill = (box, rows) => { rows.filter((r) => r && r[1] != null && r[1] !== '').forEach(([k, v]) => { const d = el(`<div class="summary-line"><span></span><span></span></div>`); d.children[0].textContent = k; d.children[1].textContent = v; box.appendChild(d); }); return box; };
  const card = (title, rows) => { const b = el(`<div class="vlp-cd"><h4></h4></div>`); b.querySelector('h4').textContent = title; return fill(b, rows); };
  const dt = (t) => { if (!t) return ''; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const overview = () => {
    const w = el(`<div class="vlp-ov"></div>`);
    const cfgv = (k) => (V.config ? V.config.get(k) : null);
    const modeL = ((cfgv('careReceiveModes') || []).find((m) => m.code === (c.receiveMode || cfgv('careDefaultReceiveMode'))) || {}).label || '-';
    w.appendChild(card('계약 요약', [['서비스 계약번호', c.id], ['차종', c.carModel || '-'], ['신청일', dt(c.createdAt)], ['신청 방식', c.mode === 'online' ? '온라인 즉시견적' : (c.mode ? '방문 협의' : '')], ['현재 상태', careStatusLabel(c)], ['대상 차량 예약', c.reservationId]]));
    w.appendChild(card('고객', [['이름', c.customer && c.customer.name], ['연락처', c.customer && c.customer.phone ? (U.formatPhone ? U.formatPhone(c.customer.phone) : c.customer.phone) : '']]));
    w.appendChild(card('시공사', [['업체명', shop ? shop.name : '-'], ['주소', shop && shop.address], ['연락처', shop && shop.phone ? (U.formatPhone ? U.formatPhone(shop.phone) : shop.phone) : ''], ['인증 상태', shop && shop.verificationStatus ? ({ approved: '승인됨', verified: '승인됨', pending: '승인 대기', rejected: '반려' }[shop.verificationStatus] || shop.verificationStatus) : '']]));
    if (shop && (shop.address || shop.name)) {
      const lc = el(`<div class="vlp-cd"><h4>시공사 위치</h4><p></p></div>`), p = lc.querySelector('p');
      p.textContent = [shop.name, shop.address, shop.phone].filter(Boolean).join(' · ') + ' ';
      if (shop.address) { const a = el('<a class="vlp-sum-link" target="_blank" rel="noopener noreferrer">길찾기 ›</a>'); a.href = String(cfgv('navLinkTemplate') || '').replace('{q}', encodeURIComponent(shop.address || shop.name)); p.appendChild(a); }
      w.appendChild(lc);
    }
    w.appendChild(card('서비스 내용', [['패키지', c.package ? c.package.name + ' · ' + fmtMoney(c.package.price) : '-'], ['추가 옵션', (c.options || []).length ? c.options.map((x) => x.name + ' ' + fmtMoney(x.price)).join(', ') : '없음'], ['견적가', c.quotedPrice != null ? fmtMoney(c.quotedPrice) : '견적 전'], ['수령 방식', modeL], ['포인트 사용', c.pointsUsed ? fmtMoney(c.pointsUsed).replace('원', 'P') : '']]));
    if (c.customRequest) w.appendChild(el(`<div class="vlp-cd"><h4>고객 요청사항</h4><p></p></div>`)).querySelector('p').textContent = c.customRequest;
    const pc = c.priceMatch === true ? '정찰제 확인: 견적과 청구가 일치했어요' : (c.priceMatch === false ? '정찰제 확인: 추가금 제보가 접수됐어요' : '견적 = 청구 여부는 완료 후 확인합니다');
    w.appendChild(el(`<div class="vlp-cd"><h4>정찰제</h4><p></p></div>`)).querySelector('p').textContent = pc;
    return w;
  };
  const progress = () => {
    const w = el(`<div class="vlp-ov"></div>`);
    const IDX = { REQUESTED: -1, QUOTED: -1, CONFIRMED: -1, RECEIVED: 0, WORKING: 1, INSPECTING: 2, CUSTOMER_INSPECT: 2, REWORK: 2, ESCALATED: 2, RELEASED: 3, READY_TO_RECEIVE: 4, PRICE_CHECK: 5, DISPUTED: 5, RATE: 5, DONE: 5 };
    const ph = V.careApi.phaseOf(c), i = IDX[ph] == null ? -1 : IDX[ph];
    const st = (k) => (i >= 5 || k < i ? 'done' : (k === i ? 'cur' : 'todo'));
    const logT = (re) => { const l = (c.log || []).find((x) => re.test(x.msg)); return l ? dt(l.t).slice(5) : ''; };
    const nodes = [{ s: st(0), t: '입고 확인', sub: [logT(/^입고/), c.intakeRoute ? '' : ''].filter(Boolean).join(' · ') }, { s: st(1), t: i === 1 ? '작업 중' : '작업', sub: (c.photos || []).length ? '현장 사진 ' + c.photos.length : '' }, { s: st(2), t: '검수 요청', sub: ph === 'REWORK' ? '보완 중' : (ph === 'ESCALATED' ? '운영자 중재 중' : '') }, { s: st(3), t: '출차', sub: logT(/출차/) }, { s: st(4), t: '수령 확인', sub: logT(/수령 확인/) }];
    const box = el(`<div class="vlp-cd"><h4>진행</h4></div>`); box.appendChild(V.delivery.stepper(nodes, '신차케어 진행 순서')); w.appendChild(box);
    w.appendChild(el(careInfoHTML(c).replace('class="admin-controls" style="margin-bottom:14px;"', 'class="vlp-cd"').replace('<div class="summary-line">', '<h4>입고·청구</h4><div class="summary-line">')));
    if ((c.intakePhotos || []).length) w.appendChild(photosCard('사전 촬영', c.intakePhotos));
    if ((c.photos || []).length) w.appendChild(photosCard('현장 사진', c.photos));
    return w;
  };
  // 운영 탭: 관리자 전용 — 이의·중재 현황, 대리 처리
  const ops = () => {
    const w = el(`<div class="vlp-ov"></div>`);
    const dc = el(`<div class="vlp-cd"><h4>이의·중재 현황</h4></div>`);
    const rows = disputed ? [['상태', c.escalated ? '운영자 중재 필요' : '시공사 보완 중'], ['이의 회차', (c.disputeRounds || 1) + '회째'], ['사유', c.disputeReason || '(사유 없음)']] : [['상태', c.priceMatch === false ? '정찰제 불일치 제보 접수' : '이의 없음']];
    fill(dc, rows); w.appendChild(dc);
    const act = el(`<div id="care-action-slot"></div>`); act.appendChild(renderCareAction(c)); w.appendChild(act);
    w.appendChild(V.caseView.adminNotesCard(c.id)); w.appendChild(V.caseView.adminLogCard(c.id));
    return w;
  };
  const history = () => el(`<div class="vlp-cd"><h4>전체 처리 이력 (${(c.log || []).length}건)</h4><div>${renderHistoryLogHTML(c)}</div></div>`);
  const root = V.caseView.detail({ role: 'admin', contract: { contractId: c.id, vehicleModel: (c.carModel || '차종 미입력') }, idx: 0, stateHTML: badgeHTML, next: nextText, progress: '', graphHTML: '', aside: c.id,
    tabs: [{ id: 'overview', label: '개요', render: overview }, { id: 'progress', label: '진행', render: progress }, { id: 'ops', label: '운영', render: ops }, { id: 'history', label: '이력', render: history }], defaultTab: disputed ? 'ops' : 'progress', noGuide: true,
    onChat: (btn) => V.chat.open(c.id, { role: 'admin', readOnly: true, api: V.careApi.admin, summary: (c.carModel || '차량') + ' · ' + c.id + ' · 읽기 전용', opener: btn }) });
  root.classList.add('vlp-care-case'); if (disputed) root.classList.add('is-urgent');
  VLP.adminHome.crumb(root, c.id);
  const ch = root.querySelector('.vlp-case-chat'); if (ch) ch.id = 'care-chat-open';
  const stp = root.querySelector('.vlp-case-stp'); if (stp) stp.hidden = true; // 배송 5단계 설명은 케어에 해당 없음
  return root;
}

function renderCareAction(c) {
  const box = el(`<div class="admin-controls"><h4>관리자 대리 처리 (신속 진행용)</h4><div id="care-action-inner"></div></div>`);
  const inner = box.querySelector('#care-action-inner');
  // 대리 처리 버튼을 누르면(실제 동작보다 먼저) 관리자 처리 기록에 남긴다
  box.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && !b.disabled && box.contains(b)) Store.logAdminAction(c.id, 'proxy', '대리 처리 · ' + b.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)); }, true);

  if (c.transit && c.transit.active) {
    const tp = transitProgress(c);
    const box2 = el(`<div><div class="hint">목적지: ${tp.destination} · 다음 위치까지 약 ${tp.remainSec}초</div>
      ${renderDeliveryStepperHTML(c)}
      <button class="btn btn-sm" style="margin-top:8px;">즉시 도착 처리</button></div>`);
    box2.querySelector('button').addEventListener('click', () => { Store.forceArrive(c.id); render(); });
    inner.appendChild(box2);
    return box;
  }

  if (c.status === 'requested') {
    const suggested = Store.aftermarketSuggestedPrice(c);
    const btn = el(`<button class="btn btn-primary btn-sm">견적 대리 회신 (${fmtMoney(suggested)})</button>`);
    btn.addEventListener('click', () => { Store.respondCareQuote(c.id, suggested); render(); });
    inner.appendChild(btn);
  } else if (c.status === 'quoted') {
    const btn = el(`<button class="btn btn-primary btn-sm">고객 견적 확인 대리 처리</button>`);
    btn.addEventListener('click', () => { Store.confirmCareQuote(c.id, 0); render(); });
    inner.appendChild(btn);
  } else if (c.status === 'confirmed') {
    const btn = el(`<button class="btn btn-primary btn-sm">입고 대리 확인</button>`);
    btn.addEventListener('click', () => { Store.confirmCareDropoff(c.id); render(); });
    inner.appendChild(btn);
  } else if (SHOP_STAGES.some(s => s.code === c.status)) {
    const idx = SHOP_STAGES.findIndex(s => s.code === c.status);
    const flowBox = el(`<div class="status-flow"></div>`);
    SHOP_STAGES.forEach((s, i) => {
      const btn = el(`<button class="${s.code === c.status ? 'current' : ''}" ${i !== idx + 1 ? 'disabled' : ''}>${s.short}</button>`);
      btn.addEventListener('click', () => { Store.setCareShopStage(c.id, s.code); render(); });
      flowBox.appendChild(btn);
    });
    inner.appendChild(flowBox);
    if (c.status === '최종검수') {
      const priceBtn = el(`<button class="btn btn-sm" style="margin-top:8px;">청구액 = 견적가로 대리 입력 (${fmtMoney(c.quotedPrice)})</button>`);
      priceBtn.addEventListener('click', () => { Store.setCareCharged(c.id, 0, ''); render(); });
      inner.appendChild(priceBtn);
      const reqBtn = el(`<button class="btn btn-sm" style="margin-top:8px;">고객 검수 요청 대리 발송</button>`);
      reqBtn.addEventListener('click', () => { Store.requestCareInspection(c.id); render(); });
      inner.appendChild(reqBtn);
    }
    inner.insertAdjacentHTML('beforeend', `<div style="margin-top:14px;">${renderShopTimelineHTML(c)}</div>`);
  } else if (c.status === '고객검수대기') {
    const box2 = el(`<div>
      <div class="hint" style="margin-bottom:8px;">출차 전 고객 검수 확인이 필요합니다 (오너 단독).</div>
      <span class="badge ${c.ownerConfirmed ? 'done' : 'wait'}">${c.ownerConfirmed ? '완료' : '대기'}</span>
      ${c.disputed ? `<div class="msg-box" style="border-left-color:#c22;margin:8px 0;">⚠ 이의제기(${c.disputeRounds || 1}회째): ${c.disputeReason}<br>${c.escalated ? '<b>이의 가능 횟수를 넘어 운영자 중재가 필요합니다.</b> 고객·시공사와 협의한 뒤 처리하세요.<br><button class="btn btn-sm" id="a-resolve-dispute" style="margin-top:6px;">중재 완료 · 고객 재검수로 되돌리기</button>' : '시공사가 보완한 뒤 재검수를 요청할 때까지 기다리는 중입니다. (운영자 조치 불필요)'}</div>` : ''}
      <div class="btn-row" style="margin-top:8px;">${!c.ownerConfirmed ? `<button class="btn btn-sm" id="a-owner-inspect">오너 검수 대리 확인</button>` : ''}</div>
      ${renderShopTimelineHTML(c)}
    </div>`);
    const ob = box2.querySelector('#a-owner-inspect'); if (ob) ob.addEventListener('click', () => { Store.ownerConfirmCare(c.id); render(); });
    const rd = box2.querySelector('#a-resolve-dispute'); if (rd) rd.addEventListener('click', () => { Store.resolveCareDispute(c.id); render(); });
    inner.appendChild(box2);
  } else if (c.status === '출차완료') {
    const box2 = el(`<div>${renderShopTimelineHTML(c)}<button class="btn btn-primary btn-sm" style="margin-top:8px;">2차 배송(오너) 대리 시작</button></div>`);
    box2.querySelector('button').addEventListener('click', () => { Store.startCareSecondLeg(c.id); render(); });
    inner.appendChild(box2);
  } else if (c.status === '수령대기') {
    const btn = el(`<button class="btn btn-sm">오너 수령 대리 확인</button>`);
    btn.addEventListener('click', () => { Store.ownerConfirmCare(c.id); render(); });
    inner.appendChild(btn);
  } else if (c.status === '수령확인') {
    if (c.priceMatch === null || c.priceMatch === undefined) {
      const b = el(`<button class="btn btn-sm">정찰제 일치 대리 확인</button>`);
      b.addEventListener('click', () => { Store.answerCarePriceCheck(c.id, true); render(); });
      inner.appendChild(b);
    } else if (c.disputed) {
      inner.appendChild(el(`<div class="hint">정찰제 불일치가 접수된 건입니다.</div>`));
    } else if (!c.shopRated) {
      const b = el(`<button class="btn btn-sm">시공사 평가 대리 제출 (포인트 자동 적립)</button>`);
      b.addEventListener('click', () => {
        const scores = {}; RATING_DIMS_SHOP.forEach(d => scores[d.id] = 5);
        Store.submitRating('shop', c.shopId, c.id, scores, '');
        render();
      });
      inner.appendChild(b);
    } else {
      inner.appendChild(el(`<div class="hint">정찰제 확인·평가·포인트 적립까지 완료된 건입니다.</div>`));
    }
  } else {
    inner.appendChild(el(`<div class="hint">이 건은 대기중입니다.</div>`));
  }
  return box;
}

Store.onChange(() => { render(); });
render();
