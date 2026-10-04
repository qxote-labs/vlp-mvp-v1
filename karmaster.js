/* karmaster.js (v6.2) — 계약은 반드시 고객이 시작한다. 이미 오프라인에서 체결된 계약의 내용(차량정보·
 * 계약일자·고객정보)을 고객이 앱에 등록하면, 등록된 카마스터라면 별도 코드 확인 없이 담당 목록에서 그
 * 내용을 검토하고 승인하는 것으로 연결된다 — 화면에 뜬 내용이 실제 계약서와 맞는지 눈으로 확인하는 게
 * 검증 수단이다. 아직 미등록인 카마스터는 고객에게 직접 전달받은 조회번호로 찾아 가입과 동시에 승인한다.
 * 카마스터의 역할은 출고 요청과 배송 모니터링까지이며, 오너가 차량 수령을 확인하는 순간 끝난다 —
 * 출고 후 시공이 예정된 건이라도, 그 시공(신차 케어 서비스)은 고객·시공사 간 별개의 계약이라 카마스터는
 * 관여하지 않는다. */

let loggedInId = sessionStorage.getItem('v6_km_id') || null;

// 비가입자(미등록 카마스터) 흐름 상태 — 정식 로그인(loggedInId)과 완전히 별개다.
let unregisteredMode = null; // null | 'login' | 'recover'

let claimedPhone = sessionStorage.getItem('vlp_km_claimed') || null; // 조회번호로 계약을 연 미가입 카마스터(연락처만 보관, 번호는 보관하지 않음)
// 바로가기: karmaster.html?claim=1 (미가입 카마스터 조회번호 화면, 고객이 보낸 안내 링크) / 데모: ?demoKm=k1 (로그인), ?demoClaim=1
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('demoKm') && Store.getKarmaster(q.get('demoKm'))) { loggedInId = q.get('demoKm'); sessionStorage.setItem('v6_km_id', loggedInId); }
  else if (q.get('demoClaim') || q.get('claim')) { loggedInId = null; sessionStorage.removeItem('v6_km_id'); unregisteredMode = 'login'; }
})();

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function _renderInner() {
  const root = document.getElementById('body-root');
  // 실시간 검색/조회 입력은 매 글자마다 render()를 다시 호출하는데, 그때마다 DOM을 통째로 교체하면
  // 입력 중이던 필드가 포커스를 잃는다 — 재렌더링 전후로 포커스·커서 위치를 복원한다.
  const focused = document.activeElement;
  let restore = null;
  if (focused && root.contains(focused) && focused.id && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) {
    restore = { id: focused.id, value: focused.value, selStart: typeof focused.selectionStart === 'number' ? focused.selectionStart : null, selEnd: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null };
  }
  root.innerHTML = '';
  if (!loggedInId && claimedPhone) {
    VLP.rolebar.set({ role: 'karmaster', name: claimedPhone + ' (미가입)', phone: '', action: { label: '나가기', id: 'claimed-logout', onClick: exitClaimed } });
    root.appendChild(renderClaimedHome());
  } else if (!loggedInId) {
    VLP.rolebar.set({ role: 'karmaster', name: '', phone: '', action: null });
    if (unregisteredMode === 'login' || unregisteredMode === 'recover') {
      root.appendChild(VLP.karmasterScreens.renderClaim({ back: () => { unregisteredMode = null; render(); }, onClaimed: (phone, token) => { claimedPhone = phone; sessionStorage.setItem('vlp_km_claimed', phone); sessionStorage.setItem('vlp_km_session', token || ''); VLP.ui.setKarmasterSession(phone, '', token); unregisteredMode = null; render(); } }));
    } else root.appendChild(renderLogin());
  } else {
    const km = Store.getKarmaster(loggedInId);
    VLP.ui.syncMockRegistry(Store.getKarmasters());
    VLP.ui.setKarmasterSession(km.phone, km.name);
    VLP.rolebar.set({ role: 'karmaster', name: km.name.replace(/\s*카마스터$/, ''), phone: km.phone, action: null }); // 로그아웃은 '내 정보'에서(D-42)
    root.appendChild(renderDashboard(km));
  }
  if (restore) {
    const restored = document.getElementById(restore.id);
    if (restored) {
      restored.value = restore.value;
      restored.focus();
      if (restore.selStart !== null && restored.setSelectionRange) { try { restored.setSelectionRange(restore.selStart, restore.selEnd); } catch (e) {} }
    }
  }
}

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}

// 카마스터는 이 앱에서 유일하게 가입이 강제되지 않는 역할이라(user-account-role-model-spec.md), 전화
// 번호만 알면 누구나 남의 계정에 들어갈 수 있다는 보안 허점이 있었다. 온보딩 시점에 확인코드(조회번호로
// 쓰였던 그 값)를 그대로 로그인 비밀번호로 승격시켜, 이제부터는 전화번호+비밀번호 조합이 실제 인증
// 수단이 되게 했다. 테스트 편의를 위한 "빠른 로그인" 드롭다운은 지금처럼 비밀번호 없이 그대로 둔다 —
// 데모/테스트 전용 우회 경로라는 성격 자체가 바뀌지 않았고, 기존 Playwright 테스트들이 이 경로에 의존한다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">카마스터 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 연락처와 비밀번호로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <input id="login-pw" type="password" placeholder="비밀번호" style="margin-bottom:8px;" autocomplete="off">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleUnregisteredLogin()">비가입자이신가요? 계약 확인하기</button>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:12px;color:#595959;">데모 계정으로 빠른 로그인 (비밀번호 불필요)</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getKarmasters().map(k => `<option value="${k.id}">${k.name} · ${k.phone}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), pwEl = wrap.querySelector('#login-pw'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  { const q = new URLSearchParams(location.search), pf = q.get('prefill'); if (pf) { phoneEl.value = loginPhoneFormat(pf); pwEl.value = q.get('prefillPin') || ''; submitBtn.focus(); } } // 런처에서 번호·비밀번호를 채워 열기(로그인은 직접 누른다, 데모 전용)
  submitBtn.addEventListener('click', () => {
    const km = Store.getKarmasterByPhone(phoneEl.value);
    if (!km) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    if (!km.pin || km.pin !== pwEl.value) { hintEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }
    tryLogin(km.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function toggleUnregisteredLogin() { unregisteredMode = unregisteredMode === 'login' ? null : 'login'; render(); }

function tryLogin(id) {
  loggedInId = id; sessionStorage.setItem('v6_km_id', id);
  const km = Store.getKarmaster(id);
  if (km) Store.touchUserRole(km.phone, km.name, 'karmaster'); // 통합 User에 karmaster 역할 속성 부착(상호주의 원칙, 겸임 시연용)
  render();
}
function logout() { VLP.api.session.clear(); VLP.pwa.clearApiCache(); loggedInId = null; nicknameDraft = null; unregisteredMode = null; sessionStorage.removeItem('v6_km_id'); sessionStorage.removeItem('v6_km_sel'); render(); }
function exitClaimed() { claimedPhone = null; sessionStorage.removeItem('vlp_km_claimed'); sessionStorage.removeItem('vlp_km_session'); VLP.api.session.clear(); VLP.pwa.clearApiCache(); render(); }
function renderClaimedHome() {
  VLP.ui.setKarmasterSession(claimedPhone, '', sessionStorage.getItem('vlp_km_session') || '');
  const w = el(`<div><div class="sub">조회번호로 연 계약입니다. 가입하면 앞으로 계약이 자동으로 이 화면에 나타납니다.</div><div id="claimed-panel"></div></div>`);
  w.querySelector('#claimed-panel').appendChild(VLP.karmasterScreens.renderPanel({ phone: claimedPhone, name: '', keepSession: true, logout: () => exitClaimed(), onAuthLost: () => { exitClaimed(); unregisteredMode = 'login'; render(); } }));
  return w;
}

// ===================== 표시 이름 설정 (닉네임/실명) — user-account-role-model-spec.md 3장/4.2/5장 =====================
// 현대/기아 소속(brandAffiliationFor === 'hyundai_kia')이면 표시 방식 토글 자체를 숨기고 닉네임으로
// 강제한다 — 제조사 정책상 그 브랜드를 취급하는 카마스터의 실명이 고객 화면에 노출되면 안 되기 때문이다.
let nicknameDraft = null; // { value } — 카마스터가 바뀌면(로그아웃 등) null로 리셋해 이전 입력이 새지 않게 한다
function renderDisplayNameSettings(km) {
  if (nicknameDraft === null) nicknameDraft = { value: km.nickname || '' };
  const d = nicknameDraft;
  const forced = brandAffiliationFor(km.id) === 'hyundai_kia';
  const box = el(`<div class="admin-controls" style="margin-bottom:16px;">
    <h4>표시 이름 설정</h4>
    <div class="hint" style="margin-bottom:8px;">${forced
      ? '현대/기아 브랜드를 취급한 이력이 있어, 제조사 정책에 따라 고객 화면에는 실명 대신 닉네임만 표시됩니다(변경 불가).'
      : '고객 화면에 닉네임 또는 실명 중 무엇을 보여줄지 직접 선택할 수 있습니다.'}</div>
    <label>닉네임</label>
    <input id="km-nick-input" type="text" placeholder="닉네임을 입력하세요" autocomplete="off">
    <div class="hint" id="km-nick-status"></div>
    <div id="km-nick-suggestions"></div>
    <button class="btn btn-sm" id="km-nick-save" style="margin-top:8px;" disabled>닉네임 저장</button>
    ${!forced ? `
    <label style="margin-top:14px;">표시 방식</label>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm ${km.nameDisplayMode !== 'real_name' ? 'btn-primary' : ''}" id="km-dispmode-nickname">닉네임 표시</button>
      <button class="btn btn-sm ${km.nameDisplayMode === 'real_name' ? 'btn-primary' : ''}" id="km-dispmode-real">실명 표시</button>
    </div>` : ''}
    <div class="hint" style="margin-top:8px;">현재 고객 화면에 보이는 이름: <b>${karmasterDisplayName(km)}</b></div>
  </div>`);

  const nickInput = box.querySelector('#km-nick-input'), statusEl = box.querySelector('#km-nick-status');
  const suggBox = box.querySelector('#km-nick-suggestions'), saveBtn = box.querySelector('#km-nick-save');
  nickInput.value = d.value;
  let debounceTimer = null;
  function checkAvailability() {
    const val = nickInput.value.trim();
    suggBox.innerHTML = '';
    if (!val) { statusEl.textContent = ''; saveBtn.disabled = true; return; }
    if (val === (km.nickname || '')) { statusEl.textContent = '현재 사용 중인 닉네임입니다.'; saveBtn.disabled = true; return; }
    if (Store.isKarmasterNicknameTaken(val, km.id)) {
      statusEl.textContent = '이미 사용 중인 닉네임입니다.';
      saveBtn.disabled = true;
      let n = 2;
      const candidates = [];
      while (candidates.length < 3 && n < 50) {
        const cand = `${val}${n}`;
        if (!Store.isKarmasterNicknameTaken(cand, km.id)) candidates.push(cand);
        n++;
      }
      candidates.forEach(c => {
        const btn = el(`<button class="btn btn-sm" style="margin:4px 6px 0 0;">${c}</button>`);
        btn.addEventListener('click', () => { nickInput.value = c; d.value = c; checkAvailability(); });
        suggBox.appendChild(btn);
      });
    } else {
      statusEl.textContent = '사용 가능한 닉네임입니다.';
      saveBtn.disabled = false;
    }
  }
  nickInput.addEventListener('input', () => {
    d.value = nickInput.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAvailability, 300);
  });
  saveBtn.addEventListener('click', () => {
    Store.setKarmasterProfile(km.id, { nickname: nickInput.value.trim() });
    nicknameDraft = null;
    render();
  });
  if (!forced) {
    box.querySelector('#km-dispmode-nickname').addEventListener('click', () => { Store.setKarmasterProfile(km.id, { nameDisplayMode: 'nickname' }); render(); });
    box.querySelector('#km-dispmode-real').addEventListener('click', () => { Store.setKarmasterProfile(km.id, { nameDisplayMode: 'real_name' }); render(); });
  }
  return box;
}

function renderDashboard(km) {
  // 카마스터 앱은 새 계약 흐름 화면(karmaster-contracts.js)이 전부 맡는다. 로그아웃·표시 이름은 '내 정보' 탭에 있다.
  const wrap = el('<div></div>');
  const panel = el('<div class="vlp-panel-slot"></div>');
  panel.appendChild(VLP.karmasterScreens.renderPanel({ phone: km.phone, name: km.name, logout: () => logout(), meExtra: () => renderDisplayNameSettings(km) }));
  wrap.appendChild(panel);
  return wrap;
}

Store.onChange(() => { render(); });

// 전체 재렌더 없이 스텝 인디케이터/잔여시간만 0.3초마다 직접 갱신 (입력 폼에 영향 없음)
setInterval(() => {
  document.querySelectorAll('[data-rid]').forEach(card => {
    const id = card.getAttribute('data-rid');
    const r = Store.getReservation(id);
    if (!r || !r.transit || !r.transit.active) return;
    const tp = transitProgress(r);
    const remainEl = card.querySelector('.transit-remain');
    const stepSlot = card.querySelector('.dstepper-slot');
    if (remainEl) remainEl.textContent = `다음 위치까지 약 ${tp.remainSec}초 남음`;
    if (stepSlot) stepSlot.innerHTML = renderDeliveryStepperHTML(r);
  });
}, 300);

render();
