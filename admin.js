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
let adminTab = sessionStorage.getItem('v6_admin_tab') || 'delivery';

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
function setAdminTab(tab) { adminTab = tab; sessionStorage.setItem('v6_admin_tab', tab); render(); }

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
function tryLogin(id) { loggedInAdminId = id; sessionStorage.setItem('v6_admin_id', id); render(); }
function logout() { loggedInAdminId = null; sessionStorage.removeItem('v6_admin_id'); render(); }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInAdminId) {
    document.getElementById('header-right').textContent = '';
    root.appendChild(renderLogin());
    return;
  }
  const admin = Store.getAdmin(loggedInAdminId);
  const isSuper = admin.adminScope === 'super';
  // 커뮤니티관리자는 배정된 Group에 속한 카마스터/시공업체가 처리하는 건만 본다(1.3절) — 슈퍼바이저는 전체.
  const careList = Store.getCareOrders().filter(c => careOrderInAdminScope(c, admin));
  const pendingShopCount = Store.getShops().filter(s => s.verificationStatus === 'pending' && shopInAdminScope(s, admin)).length;
  const scopeLabel = isSuper ? '슈퍼바이저 · 전체 권한' : `커뮤니티관리자 · 담당 그룹: ${(admin.assignedGroupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '없음'}`;
  document.getElementById('header-right').textContent = `${admin.name} (${scopeLabel}) · 신차 케어 ${careList.length}건`;

  const effectiveTab = (!isSuper && adminTab === 'users') ? 'delivery' : adminTab;
  const tabRenderers = { care: () => renderCareTab(careList), users: renderUsersTab, shops: () => renderShopApprovalTab(admin) };
  {
    // 운영 관제 콘솔(구성안 5.4): 왼쪽 메뉴 + 건 목록 + 상세 + 우측 대화 감독
    const filt = (() => { try { return sessionStorage.getItem('vlp_adm_filter') || 'all'; } catch (e) { return 'all'; } })();
    const shell = el(`<div class="vlp-adm"><nav class="vlp-adm-nav" aria-label="관리 메뉴"></nav><div class="vlp-adm-main"></div></div>`);
    const nav = shell.querySelector('.vlp-adm-nav');
    const addNav = (id, label, on, run, extra) => { const b = el('<button type="button" class="vlp-adm-nav-btn"></button>'); b.dataset.menu = id; b.textContent = label; if (on) b.setAttribute('aria-current', 'page'); b.addEventListener('click', run); if (extra) b.appendChild(extra); nav.appendChild(b); return b; };
    const setFilter = (f) => { try { sessionStorage.setItem('vlp_adm_filter', f); } catch (e) { /* 무시 */ } };
    addNav('cases', '건 목록', effectiveTab === 'delivery' && filt !== 'exception', () => { setFilter('all'); setAdminTab('delivery'); });
    const exq = addNav('exceptions', '예외 큐', effectiveTab === 'delivery' && filt === 'exception', () => { setFilter('exception'); setAdminTab('delivery'); }, el('<span class="vlp-adm-dot" hidden></span>'));
    window.addEventListener('vlp-adm-counts', (e) => { const dot = exq.querySelector('.vlp-adm-dot'); if (!dot || !document.body.contains(exq)) return; const n = e.detail.exception; dot.hidden = !n; dot.textContent = n ? '●' + n : ''; });
    const disputeN = careList.filter(careDisputed).length;
    addNav('care', '신차 케어 서비스', effectiveTab === 'care' && careFilter() !== 'dispute', () => { setCareFilter('all'); setAdminTab('care'); });
    addNav('dispute', '이의 중재', effectiveTab === 'care' && careFilter() === 'dispute', () => { setCareFilter('dispute'); setAdminTab('care'); }, el(`<span class="vlp-adm-dot"${disputeN ? '' : ' hidden'}>${disputeN ? '●' + disputeN : ''}</span>`));
    if (isSuper) addNav('users', '통합 사용자', effectiveTab === 'users', () => setAdminTab('users'));
    addNav('shops', `업체 승인${pendingShopCount ? ` (${pendingShopCount})` : ''}`, effectiveTab === 'shops', () => setAdminTab('shops'));
    addNav('logout', '로그아웃', false, () => logout());
    const main = shell.querySelector('.vlp-adm-main');
    if (tabRenderers[effectiveTab]) main.appendChild(tabRenderers[effectiveTab]());
    else {
      main.appendChild(VLP.adminConsole.render());
    }
    root.appendChild(shell);
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
  const groups = Store.getGroups();
  const box = el(`<div class="admin-controls" style="margin-bottom:18px;">
    <h4>그룹(커뮤니티) 카탈로그</h4>
    <div class="hint" style="margin-bottom:8px;">그룹 생성은 슈퍼바이저만 할 수 있습니다 — 이 데모에서는 관리자 계정이 슈퍼바이저를 겸합니다.</div>
    <div style="margin-bottom:10px;">${groups.map(g => `<span class="tag">${g.name} · ${GROUP_TYPE_LABELS[g.type] || g.type}</span>`).join('') || '<span class="hint">등록된 그룹이 없습니다.</span>'}</div>
    <div class="btn-row" style="margin-top:0;">
      <input id="grp-name" type="text" placeholder="그룹명 (예: 대전)" style="flex:2;" autocomplete="off">
      <select id="grp-type" style="flex:1;">
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
function renderUsersTab() {
  const users = Store.getUsers();
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="vlp-pane-head"><h2>사용자</h2></div>`));
  wrap.appendChild(renderGroupCatalogSection());
  wrap.appendChild(el(`<div class="hint" style="margin-bottom:14px;">전화번호가 공통 식별자입니다 — 같은 번호로 여러 역할에 로그인하거나 계약을 등록하면 한 사용자 아래 역할 속성이 함께 쌓입니다("한 사람 = 하나의 계정 + 여러 역할 속성" 원칙, user-account-role-model-spec.md 1.1절).</div>`));
  if (users.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">👤</div>아직 식별된 사용자가 없습니다. 고객이 계약을 등록하거나 카마스터/시공업체가 로그인하면 여기 나타납니다.</div>`));
    return wrap;
  }
  const table = el(`<table><tr><th>이름</th><th>전화번호</th><th>보유 역할</th><th>겸임 여부</th></tr></table>`);
  users.forEach(u => {
    const roles = (u.roleAttributes || []).map(ra => ROLE_ATTR_LABELS[ra.role] || ra.role);
    const tr = elRow(`<tr><td>${u.name || '-'}</td><td>${u.phone}</td><td>${roles.map(r => `<span class="tag">${r}</span>`).join('') || '-'}</td><td>${roles.length > 1 ? '<span class="badge done">겸임중</span>' : '-'}</td></tr>`);
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

// ===================== 업체 승인 탭 (user-account-role-model-spec.md 4.3절) =====================
// 신규 등록된 업체(verificationStatus:'pending')를 사업자등록증 이미지로 육안 확인 후 승인/반려한다.
// 이 데모에서는 슈퍼바이저/커뮤니티관리자가 아직 분리되지 않아 관리자 계정이 커뮤니티관리자를 겸한다.
function renderShopApprovalTab(admin) {
  const shops = Store.getShops().filter(s => shopInAdminScope(s, admin));
  const pending = shops.filter(s => s.verificationStatus === 'pending');
  const processed = shops.filter(s => s.verificationStatus !== 'pending');
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="vlp-pane-head"><h2>업체 승인</h2></div>`));
  const scopeNote = admin.adminScope === 'community' ? ' 담당 그룹에 속한 업체만 보입니다.' : '';
  wrap.appendChild(el(`<div class="hint" style="margin-bottom:14px;">신규 업체 등록 요청을 사업자등록증 이미지로 육안 확인한 뒤 승인/반려합니다. 승인 전에는 고객 화면에 노출되지 않습니다.${scopeNote}</div>`));
  if (pending.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">🏢</div>승인 대기 중인 업체가 없습니다.</div>`));
  } else {
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
      wrap.appendChild(card);
    });
  }
  if (processed.length) {
    wrap.appendChild(el(`<h3 style="margin-top:20px;">전체 업체 현황</h3>`));
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
function renderCareTab(careList) {
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="vlp-pane-head"><h2>신차 케어 서비스</h2>
    <button class="btn btn-primary" style="width:auto;padding:10px 18px;" onclick="toggleNewCareForm()">${showNewCareForm ? '← 목록으로' : '+ 대리 신청'}</button>
  </div>`));

  const kpiWrap = el(`<div class="kpi-row"></div>`);
  const quoteWaiting = careList.filter(c => c.status === 'requested').length;
  const confirmWaitingCustomer = careList.filter(c => c.status === 'quoted').length;
  const active = careList.filter(c => SHOP_DISPLAY_STAGES.some(s => s.code === c.status)).length;
  const confirmWaiting = careList.filter(c => ['고객검수대기', '수령대기'].includes(c.status)).length;
  const disputes = careList.filter(careDisputed).length;
  const escalatedN = careList.filter(c => careDisputed(c) && c.escalated).length;
  const done = careList.filter(c => c.status === '수령확인' && c.shopRated).length;
  [[careList.length, '전체 신청'], [quoteWaiting, '견적 대기'], [confirmWaitingCustomer, '고객확인 대기'], [active, '진행중 시공'], [confirmWaiting, '확인 대기'], [disputes, '품질 이의(보완·중재)'], [escalatedN, '운영자 중재 필요'], [done, '완료']].forEach(([v, k]) => {
    kpiWrap.appendChild(el(`<div class="kpi-box"><div class="v">${v}</div><div class="k">${k}</div></div>`));
  });
  wrap.appendChild(kpiWrap);

  if (showNewCareForm) { wrap.appendChild(renderNewCareForm()); return wrap; }

  if (careList.length === 0) {
    wrap.appendChild(el(`<div class="empty-state"><div class="big">🛠️</div>아직 신청된 신차 케어 서비스가 없습니다.</div>`));
    return wrap;
  }

  const split = el(`<div class="split"><div class="side" id="admin-care-list"></div><div class="main" id="admin-care-detail"></div></div>`);
  wrap.appendChild(split);

  const listBox = split.querySelector('#admin-care-list');
  listBox.appendChild(el(`<h3>전체 신청 목록</h3>`));
  const onlyDispute = careFilter() === 'dispute';
  // 이의 중재 메뉴: 운영자 중재가 필요한 건을 위로, 그 다음 시공사 보완 대기 건
  const shown = onlyDispute ? careList.filter(careDisputed).sort((a, b) => (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0)) : careList;
  if (onlyDispute) { listBox.querySelector('h3').textContent = '이의 중재 대상'; if (!shown.length) listBox.appendChild(el(`<div class="hint">이의가 접수된 건이 없습니다.</div>`)); }
  const table = el(`<table><tr><th>ID</th><th>고객</th><th>상태</th></tr></table>`);
  shown.forEach(c => {
    const tr = elRow(`<tr class="clickable ${c.id === careSelectedId ? 'active-row' : ''}"><td>${c.id}</td><td>${c.customer.name}</td><td><span class="badge ${careDisputed(c) ? 'wait' : amBadgeClass(c.status)}">${careStatusLabel(c)}</span></td></tr>`);
    tr.addEventListener('click', () => selectCareOrder(c.id));
    table.appendChild(tr);
  });
  listBox.appendChild(table);

  const detailBox = split.querySelector('#admin-care-detail');
  const current = careSelectedId ? Store.getCareOrder(careSelectedId) : null;
  detailBox.appendChild(current ? renderCareDetail(current) : el(`<div class="empty-state">왼쪽 목록에서 신청 건을 선택해 주세요.</div>`));
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
  const shop = Store.getShop(c.shopId);
  const wrap = el(`<div>
    <h3>${c.id} · ${c.customer.name}</h3>
    <table style="margin-bottom:18px;">
      <tr><th>차종</th><th>시공사</th><th>상태</th></tr>
      <tr><td>${c.carModel || '-'}</td><td>${shop ? shop.name : '-'}</td><td><span class="badge ${careDisputed(c) ? 'wait' : amBadgeClass(c.status)}">${careStatusLabel(c)}</span></td></tr>
    </table>
    ${careInfoHTML(c)}
    ${c.customRequest ? `<div class="msg-box" style="margin-bottom:14px;"><b>요청사항</b><br>${c.customRequest}</div>` : ''}
    <div id="care-action-slot"></div>
    <details class="admin-controls">
      <summary style="cursor:pointer;font-weight:800;font-size:13px;">전체 처리 이력 보기 (${(c.log || []).length}건)</summary>
      <div style="margin-top:10px;">${renderHistoryLogHTML(c)}</div>
    </details>
  </div>`);
  wrap.querySelector('#care-action-slot').appendChild(renderCareAction(c));
  // 이의 중재 때 근거가 되는 대화(읽기 전용, 사유를 남긴 뒤에만 본문이 보인다)
  const cb = el(`<div class="admin-controls"><h4>고객·시공사 대화</h4><div class="hint" style="margin-bottom:8px;">${(c.messages || []).length}건 · 읽기 전용입니다. 열람 사유를 남기면 본문이 보이고, 열람 기록이 남습니다.</div><button type="button" class="btn btn-sm" id="care-chat-open">대화 보기</button></div>`);
  cb.querySelector('#care-chat-open').addEventListener('click', (e) => VLP.chat.open(c.id, { role: 'admin', readOnly: true, api: VLP.careApi.admin, summary: (c.carModel || '차량') + ' · ' + c.id + ' · 읽기 전용', opener: e.currentTarget }));
  wrap.querySelector('#care-action-slot').parentElement.insertBefore(cb, wrap.querySelector('#care-action-slot').nextSibling);
  return wrap;
}

function renderCareAction(c) {
  const box = el(`<div class="admin-controls"><h4>관리자 대리 처리 (신속 진행용)</h4><div id="care-action-inner"></div></div>`);
  const inner = box.querySelector('#care-action-inner');

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
