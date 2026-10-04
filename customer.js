/* customer.js — 카마스터와의 상담은 앱 밖(오프라인 개별 연락)에서 이뤄지지만, 계약 처리는 반드시 고객이
 * 시작한다. 고객이 이미 체결한 계약의 내용(차량정보·계약일자·카마스터 연락처·본인 정보)을 직접 입력해
 * 등록하면, 카마스터가 그 내용을 검토·승인한다 — 카마스터가 고객 정보를 임의로 입력하는 절차는 없다.
 * 출고 후 시공은 신차인도서비스 계약 안의 단순 옵션(시공예정 여부)일 뿐이고, 신차 케어 서비스는 그
 * 옵션과는 완전히 무관하게 "내 차량"(=신차인도서비스로 등록한 예약) 중 하나를 골라 언제든 독립적으로
 * 시작하는 별개 서비스다. */
var loggedInCustomer = !!sessionStorage.getItem('v6_customer_logged');
var loggedInName = sessionStorage.getItem('v6_customer_name') || '';
var loggedInPhone = sessionStorage.getItem('v6_customer_phone') || '';
// 데모 바로가기: customer.html?demoName=홍길동&demoPhone=010-1111-0001 로 열면 로그인 상태로 시작한다(데모 전용, demo.html이 사용).
(function () {
  const q = new URLSearchParams(location.search), n = q.get('demoName'), ph = q.get('demoPhone');
  if (n && ph) { sessionStorage.setItem('v6_customer_logged', '1'); sessionStorage.setItem('v6_customer_name', n); sessionStorage.setItem('v6_customer_phone', ph); sessionStorage.setItem('v6_view', 'history'); loggedInCustomer = true; loggedInName = n; loggedInPhone = ph; }
})();
let view = sessionStorage.getItem('v6_view') || 'history';
let kmSortDim = 'overall';



function persistNav() {
  sessionStorage.setItem('v6_view', view);
}
function goto(v) {
  if (view === 'contract_done' && v !== 'contract_done' && window.VLP && VLP.customerScreens) VLP.customerScreens.clearRegistration();
  view = v; persistNav(); render();
}

function vlpCtx() {
  return { name: loggedInName, phone: loggedInPhone, goRegister: () => goto('contract_new'), goKarmasters: () => goto('karmasters'), goCare: () => goto('care'), back: () => goto('history'), done: () => goto('contract_done'), finish: () => goto('history'), logout: () => logoutCustomer() };
}
function renderContractNew() { return VLP.customerScreens.renderRegister(vlpCtx()); }
function renderContractDone() { return VLP.customerScreens.renderDone(vlpCtx()); }

let _rendering = false;
function render() {
  if (_rendering) return;
  _rendering = true;
  try { _renderInner(); } finally { _rendering = false; }
}

function _renderInner() {
  const root = document.getElementById('body-root');
  const focused = document.activeElement;
  let restore = null;
  if (focused && root.contains(focused) && focused.id && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) {
    restore = { id: focused.id, value: focused.value, selStart: typeof focused.selectionStart === 'number' ? focused.selectionStart : null, selEnd: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null };
  }
  root.innerHTML = '';
  if (loggedInCustomer) VLP.ui.setCustomerSession(loggedInName, loggedInPhone);
  if (!loggedInCustomer) {
    VLP.rolebar.set({ role: 'customer', name: '', phone: '', action: null });
    root.appendChild(renderLoginMock());
    return;
  }
  const map = { karmasters: renderKarmasterSearch, contract_new: renderContractNew, contract_done: renderContractDone, history: renderHistory };
  // 로그아웃은 '내 정보' 안에 한 곳만 둔다(D-42). 위쪽 막대에는 맥락 문구가 없다.
  VLP.rolebar.set({ role: 'customer', name: loggedInName, phone: loggedInPhone, action: null });
  // 새 모델에서는 서비스 선택 화면 없이 곧바로 앱(홈)으로 들어간다. 구성안 4.2의 홈에 신차케어·카마스터 찾기 바로가기가 있다.
  root.appendChild((map[view] || renderHistory)());
  if (restore) {
    const restored = document.getElementById(restore.id);
    if (restored) {
      restored.value = restore.value;
      restored.focus();
      if (restore.selStart !== null && restored.setSelectionRange) { try { restored.setSelectionRange(restore.selStart, restore.selEnd); } catch (e) {} }
    }
  }
}

// ===================== 로그인 (데모 화면 예시) =====================
function renderLoginMock() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">구매자 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">실제 서비스에서는 본인인증을 거쳐 로그인합니다. 데모에서는 아래 정보로 바로 진행되며, 입력한 이름·연락처는 계약내역 등록 시 자동으로 채워집니다.</div>
    <input id="login-name" type="text" placeholder="이름 (홍길동)" value="${loggedInName}" style="margin-bottom:10px;" autocomplete="off">
    <input id="login-phone" type="tel" placeholder="010-1234-5678" value="${loggedInPhone}" style="margin-bottom:10px;" autocomplete="off">
    <input type="password" placeholder="비밀번호 (추후 지원 예정)" disabled style="margin-bottom:14px;">
    <button class="btn btn-primary" style="width:100%;" id="login-submit" disabled>로그인</button>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:12px;color:#595959;">데모 계정으로 빠른 로그인 (비밀번호 불필요)</label>
      <select id="quick-login-customer" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getDemoCustomers().map(c => `<option value="${c.phone}" data-name="${c.name}">${c.name} · ${c.note}</option>`).join('')}
      </select>
      <div class="hint" style="margin-top:4px;">이미 계약 이력이 있는 기가입 고객으로, 매 단계를 처음부터 밟지 않고도 바로 이어지는 화면을 확인할 수 있습니다. 신규 가입 테스트는 위 입력창에 새 이름·연락처를 직접 적으면 됩니다.</div>
    </div>
  </div>`);
  const nameEl = wrap.querySelector('#login-name'), phoneEl = wrap.querySelector('#login-phone'), submitBtn = wrap.querySelector('#login-submit');
  // 이름·연락처가 빈 채로도 "로그인"이 눌려 신원 없는 상태로 넘어가던 걸 막는다 — 데모 계정
  // 드롭다운이 이미 "빈 값 없이 곧바로 들어가는" 지름길을 담당하므로, 직접 입력 경로는 실제로 값이
  // 채워졌을 때만 눌리게 한다.
  function validateLogin() { submitBtn.disabled = !(nameEl.value.trim().length >= 2 && /^010-?\d{3,4}-?\d{4}$/.test(phoneEl.value)); }
  nameEl.addEventListener('input', validateLogin);
  phoneEl.addEventListener('input', () => { phoneEl.value = formatPhoneDigits(phoneEl.value); validateLogin(); });
  validateLogin();
  submitBtn.addEventListener('click', tryCustomerLogin);
  wrap.querySelector('#quick-login-customer').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    nameEl.value = opt.dataset.name;
    phoneEl.value = opt.value;
    validateLogin();
    tryCustomerLogin();
  });
  return wrap;
}
function formatPhoneDigits(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}
function tryCustomerLogin() {
  const name = (document.getElementById('login-name').value || '').trim();
  const phone = formatPhoneDigits(document.getElementById('login-phone').value);
  if (name.length < 2 || !/^010-?\d{3,4}-?\d{4}$/.test(phone)) return; // 버튼이 비활성 상태에서도 직접 호출될 일(데모 드롭다운)이 있어 한 번 더 막아둔다
  loggedInCustomer = true;
  loggedInName = name;
  loggedInPhone = phone;
  sessionStorage.setItem('v6_customer_logged', '1');
  sessionStorage.setItem('v6_customer_name', name);
  sessionStorage.setItem('v6_customer_phone', phone);
  render();
}

// 다른 4개 역할엔 다 있는 "로그아웃"이 구매자만 빠져 있어서, 세션스토리지를 직접 지우지 않는 한
// 다른 데모 계정으로 바꿀 방법이 없었다 — 화면 우측 상단에 항상 노출되는 로그아웃 버튼을 추가한다.
// 다음 로그인에 이전 세션의 흔적(어느 화면·어느 예약을 보고 있었는지 등)이 새지 않도록 내비게이션
// 상태도 전부 초기화한다.
function logoutCustomer() {
  VLP.customerScreens.clearRegistration();
  VLP.api.session.clear();
  VLP.pwa.clearApiCache();
  loggedInCustomer = false;
  loggedInName = '';
  loggedInPhone = '';
  view = 'history';
  sessionStorage.removeItem('v6_customer_logged');
  sessionStorage.removeItem('v6_customer_name');
  sessionStorage.removeItem('v6_customer_phone');
  sessionStorage.removeItem('v6_view');
  sessionStorage.removeItem('v6_active'); sessionStorage.removeItem('v6_care_active'); // 이전 버전이 남긴 키 정리
  render();
}

// ===================== 카마스터 검색 (평점 기반, 순수 정보 제공용 — 여기서 바로 연결하지 않는다) =====================
// 탐색 화면에 "요청 시작" 버튼을 두면 예전 온라인 예약 흐름과 사실상 같아진다는 지적을 반영해,
// 이 화면은 리서치(누구에게 연락할지 고르기)용으로만 남기고, 실제 계약 요청은 별도 화면에서
// 고객이 "이미 상담한 카마스터의 연락처"를 직접 입력하는 것으로 시작한다.
function renderKarmasterSearch() {
  const dims = RATING_DIMS_KARMASTER;
  let list = Store.getKarmasters().map(k => ({ k, rt: Store.getRatingsFor('karmaster', k.id) }));
  if (kmSortDim === 'overall') {
    list.sort((a, b) => (b.rt.overall !== null ? b.rt.overall : b.k.rating) - (a.rt.overall !== null ? a.rt.overall : a.k.rating));
  } else {
    list.sort((a, b) => (b.rt.avgByDim[kmSortDim] !== null ? b.rt.avgByDim[kmSortDim] : -1) - (a.rt.avgByDim[kmSortDim] !== null ? a.rt.avgByDim[kmSortDim] : -1));
  }
  const cards = list.map(({ k, rt }) => `
    <div class="km-card" style="cursor:default;">
      <div class="name">${karmasterDisplayName(k)}</div>
      <div class="rating">${fmtStars(rt.overall !== null ? rt.overall : k.rating)} · ${rt.count > 0 ? `앱 내 평가 ${rt.count}건` : `초기 평점 ${k.reviews}건`}</div>
      <div class="region">${(k.groupIds || []).map(gid => { const g = Store.getGroup(gid); return g ? g.name : gid; }).join(', ') || '-'}</div>
      <div style="margin-bottom:8px;">${k.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      <ul class="pkg-items">${dims.map(d => `<li>${d.label}: ${rt.avgByDim[d.id] !== null ? rt.avgByDim[d.id].toFixed(1) : '-'}</li>`).join('')}</ul>
      <div class="addr-box" style="margin-top:10px;">연락처: <b>${k.phone}</b><br>전화나 문자로 직접 연락해 상담 일정을 잡아주세요.</div>
    </div>`).join('');
  const sortOpts = [['overall', '종합 평점순']].concat(dims.map(d => [d.id, `${d.label}순`]));

  // 아직 가입하지 않은 카마스터도, 다른 고객이 계약을 등록하며 그 전화번호를 남긴 순간부터 평판
  // 레코드가 쌓인다(UnclaimedKarmasterProfile, 4.2절) — 전화번호는 마스킹해서 보여준다.
  const unclaimed = Store.getUnclaimedKarmasters();
  const unclaimedCards = unclaimed.map(u => `
    <div class="km-card" style="cursor:default;">
      <div class="name">${Store.maskPhone(u.phone)}</div>
      <div class="rating">${u.reviews > 0 ? fmtStars(u.rating) + ` · 초기 평점 ${u.reviews}건` : '아직 평가 없음'}</div>
      <div class="region">미가입 카마스터</div>
      <div class="addr-box" style="margin-top:10px;">아직 앱에 가입하지 않은 카마스터입니다. 이미 상담·계약을 진행 중이라면 그 연락처로 계속 소통해 주세요.</div>
    </div>`).join('');

  const wrap = el(`<div>
    <h2>카마스터 찾기</h2>
    <div class="sub">리서치 전용 화면입니다. 상담·시승·계약은 오프라인(전화·문자)으로 직접 진행하고, 계약이 끝나면 "계약내역 등록하기"에서 그 내용을 직접 등록해 주세요.</div>
    <label>정렬 기준</label>
    <select id="km-sort" style="max-width:220px;">${sortOpts.map(([v, l]) => `<option value="${v}" ${kmSortDim === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="km-grid" style="margin-top:16px;flex-wrap:wrap;">${cards}</div>
    ${unclaimed.length > 0 ? `<h3 style="margin-top:24px;">미가입 카마스터 (평판만 확인 가능)</h3><div class="km-grid" style="margin-top:8px;flex-wrap:wrap;">${unclaimedCards}</div>` : ''}
    <div class="btn-row" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="goto('history')">← 처음으로</button>
    </div>
  </div>`);
  wrap.querySelector('#km-sort').addEventListener('change', (e) => { kmSortDim = e.target.value; render(); });
  return wrap;
}

 // id -> dataURL (제출 전까지만 유지, 제출 후 비움)

// ===================== 내 계약 확인 / 이력 (신차인도서비스) =====================
// 이 화면은 이미 로그인(loggedInCustomer)해야만 들어올 수 있어 loggedInPhone이 항상 있다 — 그래서
// 로그인 연락처로 곧장 본인 계약만 보여준다. 예전엔 "다른 연락처로 조회하기"로 남의 번호도 찾아볼 수
// 있었는데, 이 앱엔 "누가 그 계약을 등록했는지"를 확인할 방법이 없다(customer.phone 자체가 그 계약의
// 유일한 신원 확인 수단이라, 등록자와 임의의 제3자를 구분 못 한다) — 그래서 아무 번호나 입력하면 나와
// 무관한 사람의 이름·차종·배송지가 그대로 노출되는 개인정보 문제가 있어 뺐다. 가족 등 대리조회가 정말
// 필요해지면, 그건 당사자 본인의 확인(컨펌) 절차를 먼저 갖춘 뒤에 다시 붙여야 한다.
function renderHistory() { return VLP.customerScreens.renderHome(vlpCtx()); }

Store.onChange(() => { render(); });
Object.defineProperty(window, 'view', { get: () => view });
render();
