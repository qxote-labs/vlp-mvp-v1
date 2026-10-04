/* shop.js (v6) — 신차 케어 서비스는 신차인도서비스와 완전히 독립된 최상위 계약(Store.getCareOrders())이다.
 * 시공사는 온라인으로 들어온 견적 요청에 가격을 회신하는 것부터 시작해서, 차량이 입고되면 스스로
 * "입고 확인"을 누르고(그 차가 신차인도서비스 배송에 얹혀 왔든 고객이 나중에 직접 몰고 왔든 상관하지
 * 않는다), 기존 시공 흐름(입고완료→작업중→최종검수→고객검수→출차→2차배송)을 그대로 이어간다.
 * 카마스터는 이 흐름에 전혀 관여하지 않으므로 고객 검수는 오너 단독 확인으로 진행된다. */
let loggedInShopId = sessionStorage.getItem('v6_shop_id') || null;
let showRegister = false;

let _rendering = false;
function render() { if (_rendering) return; _rendering = true; try { _renderInner(); } finally { _rendering = false; } }

function _renderInner() {
  const root = document.getElementById('body-root');
  root.innerHTML = '';
  if (!loggedInShopId) {
    VLP.rolebar.set({ role: 'shop', name: '', phone: '', action: null });
    root.appendChild(showRegister ? renderRegister() : renderLogin());
    return;
  }
  const shop = Store.getShop(loggedInShopId);
  VLP.rolebar.set({ role: 'shop', name: shop.name, phone: shop.phone, action: null }); // 로그아웃은 대시보드 안 버튼(D-42)
  if (shop.verificationStatus === 'pending') { root.appendChild(renderPendingApproval(shop)); return; }
  if (shop.verificationStatus === 'rejected') { root.appendChild(renderRejected(shop)); return; }
  root.appendChild(renderDashboard(shop));
}

function loginPhoneFormat(raw) {
  const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length > 7) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  if (digits.length > 3) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits;
}

// 실제 서비스와 동일하게 사업자 연락처 입력으로 로그인하는 화면을 기본으로 두고, 테스트 시 번거로움을
// 줄이기 위해 평소엔 접혀 있는 "빠른 로그인" 드롭다운만 아래에 덧붙인다.
function renderLogin() {
  const wrap = el(`<div style="max-width:400px;margin:60px auto;text-align:center;">
    <h2 style="font-size:22px;">시공업체 로그인</h2>
    <div class="sub" style="margin-bottom:20px;">등록된 사업자 연락처로 로그인합니다.</div>
    <input id="login-phone" type="tel" placeholder="010-1234-5678" style="margin-bottom:8px;" autocomplete="off">
    <input type="password" placeholder="비밀번호 (추후 지원 예정)" disabled style="margin-bottom:8px;">
    <div class="hint" id="login-hint" style="margin-bottom:10px;min-height:16px;"></div>
    <button class="btn btn-primary" style="width:100%;" id="login-submit">로그인</button>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-outline" style="width:auto;padding:10px 18px;" onclick="toggleRegister()">아직 계정이 없으신가요? 신규 업체 등록하기</button>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;text-align:left;">
      <label style="font-size:12px;color:#595959;">데모 계정으로 빠른 로그인</label>
      <select id="quick-login" style="margin-top:6px;">
        <option value="">계정 선택…</option>
        ${Store.getShops().map(s => `<option value="${s.id}">${s.name} · ${s.phone}</option>`).join('')}
      </select>
    </div>
  </div>`);
  const phoneEl = wrap.querySelector('#login-phone'), hintEl = wrap.querySelector('#login-hint'), submitBtn = wrap.querySelector('#login-submit');
  phoneEl.addEventListener('input', () => { phoneEl.value = loginPhoneFormat(phoneEl.value); hintEl.textContent = ''; });
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  submitBtn.addEventListener('click', () => {
    const shop = Store.getShopByPhone(phoneEl.value);
    if (!shop) { hintEl.textContent = '등록되지 않은 연락처입니다. 번호를 다시 확인해 주세요.'; return; }
    tryLogin(shop.id);
  });
  wrap.querySelector('#quick-login').addEventListener('change', (e) => { if (e.target.value) tryLogin(e.target.value); });
  return wrap;
}
function tryLogin(id) {
  loggedInShopId = id; sessionStorage.setItem('v6_shop_id', id);
  const shop = Store.getShop(id);
  if (shop) Store.touchUserRole(shop.phone, shop.name, 'shop'); // 통합 User에 shop 역할 속성 부착(상호주의 원칙, 겸임 시연용)
  render();
}
function logout() { loggedInShopId = null; sessionStorage.removeItem('v6_shop_id'); render(); }
function toggleRegister() { showRegister = !showRegister; registerDraft = { name: '', phone: '', businessRegistrationNumber: '', businessRepresentativeName: '', businessStartDate: '', businessRegistrationDocUrl: '', groupIds: [] }; render(); }

// ===================== 신규 업체 등록 (user-account-role-model-spec.md 4.3절) =====================
// 사업자등록번호+대표자성명+개업일자를 "진위확인 API"에 넘겨(이 데모에서는 형식·필수값 검증으로
// 시뮬레이션) 통과해야 등록되며, 등록 직후에는 verificationStatus:'pending'이라 고객에게 보이지 않는다
// — 커뮤니티관리자(이 데모에서는 관리자가 겸함)가 승인해야 비로소 노출된다.
let registerDraft = { name: '', phone: '', businessRegistrationNumber: '', businessRepresentativeName: '', businessStartDate: '', businessRegistrationDocUrl: '', groupIds: [] };
function renderRegister() {
  const d = registerDraft;
  const groups = Store.getGroups();
  const wrap = el(`<div style="max-width:480px;">
    <h2>신규 업체 등록</h2>
    <div class="sub">사업자등록번호 등 기본 정보를 입력하면 저장 시점에 진위확인을 거칩니다(데모에서는 형식·필수값만 확인). 통과 후에는 커뮤니티관리자 승인이 있어야 고객에게 노출됩니다.</div>
    <label>업체명</label>
    <input id="rg-name" type="text" placeholder="예: 울산 D샵" autocomplete="off">
    <label>대표 전화번호</label>
    <input id="rg-phone" type="tel" placeholder="010-0000-0000" autocomplete="off">
    <label>사업자등록번호 (숫자 10자리)</label>
    <input id="rg-bn" type="text" placeholder="예: 1234567890" autocomplete="off">
    <label>대표자성명</label>
    <input id="rg-repname" type="text" placeholder="홍길동" autocomplete="off">
    <label>개업일자</label>
    <input id="rg-start" type="date" autocomplete="off">
    <label>사업자등록증 이미지</label>
    <div id="rg-doc-preview" style="margin-bottom:6px;"></div>
    <div class="btn-row" style="margin-top:0;">
      <button class="btn btn-sm" id="rg-doc-sample">샘플 이미지 추가</button>
      <label class="btn btn-sm" style="cursor:pointer;">파일 선택 업로드<input type="file" id="rg-doc-file" accept="image/*" style="display:none;"></label>
    </div>
    <label style="margin-top:10px;">소속 그룹 (복수 선택 가능, 승인 불필요)</label>
    <div>${groups.map(g => `<label style="display:inline-flex;align-items:center;gap:4px;margin:0 12px 6px 0;font-weight:400;font-size:12.5px;"><input type="checkbox" id="rg-grp-${g.groupId}">${g.name}</label>`).join('') || '<div class="hint">등록된 그룹이 없습니다.</div>'}</div>
    <button class="btn btn-primary btn-auto" id="rg-submit" style="margin-top:14px;">등록하기</button>
    <div class="hint" id="rg-hint" style="margin-top:8px;"></div>
    <button class="btn btn-outline btn-auto" style="margin-top:8px;" onclick="toggleRegister()">← 로그인 화면으로</button>
  </div>`);
  const nameEl = wrap.querySelector('#rg-name'), phoneEl = wrap.querySelector('#rg-phone'), bnEl = wrap.querySelector('#rg-bn');
  const repnameEl = wrap.querySelector('#rg-repname'), startEl = wrap.querySelector('#rg-start');
  const docPreview = wrap.querySelector('#rg-doc-preview'), hintEl = wrap.querySelector('#rg-hint');
  nameEl.value = d.name; phoneEl.value = d.phone; bnEl.value = d.businessRegistrationNumber; repnameEl.value = d.businessRepresentativeName; startEl.value = d.businessStartDate;
  function refreshDocPreview() {
    docPreview.innerHTML = d.businessRegistrationDocUrl ? `<img src="${d.businessRegistrationDocUrl}" style="max-width:160px;border-radius:8px;border:1px solid #ddd;">` : '<div class="hint">아직 첨부된 이미지가 없습니다.</div>';
  }
  refreshDocPreview();
  nameEl.addEventListener('input', () => { d.name = nameEl.value; });
  phoneEl.addEventListener('input', () => { d.phone = loginPhoneFormat(phoneEl.value); phoneEl.value = d.phone; });
  bnEl.addEventListener('input', () => { d.businessRegistrationNumber = bnEl.value; });
  repnameEl.addEventListener('input', () => { d.businessRepresentativeName = repnameEl.value; });
  startEl.addEventListener('change', () => { d.businessStartDate = startEl.value; });
  wrap.querySelector('#rg-doc-sample').addEventListener('click', () => { d.businessRegistrationDocUrl = generateSamplePhoto(0, '사업자등록증(샘플)'); refreshDocPreview(); });
  wrap.querySelector('#rg-doc-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => { d.businessRegistrationDocUrl = reader.result; refreshDocPreview(); };
    reader.readAsDataURL(file);
  });
  groups.forEach(g => {
    wrap.querySelector(`#rg-grp-${g.groupId}`).addEventListener('change', (e) => {
      if (e.target.checked) { if (!d.groupIds.includes(g.groupId)) d.groupIds.push(g.groupId); }
      else d.groupIds = d.groupIds.filter(id => id !== g.groupId);
    });
  });
  wrap.querySelector('#rg-submit').addEventListener('click', () => {
    const result = Store.registerShop({
      name: d.name.trim(), phone: d.phone, businessRegistrationNumber: d.businessRegistrationNumber,
      businessRepresentativeName: d.businessRepresentativeName, businessStartDate: d.businessStartDate,
      businessRegistrationDocUrl: d.businessRegistrationDocUrl, groupIds: d.groupIds,
    });
    if (result.error) { hintEl.textContent = result.message; return; }
    showRegister = false;
    tryLogin(result.shop.id);
  });
  return wrap;
}
function renderPendingApproval(shop) {
  return el(`<div style="max-width:480px;margin:60px auto;text-align:center;">
    <div class="big" style="font-size:40px;">⏳</div>
    <h2>승인 대기 중</h2>
    <div class="sub">${shop.name}의 사업자등록 정보를 커뮤니티관리자가 확인하고 있습니다. 승인되면 고객 화면에 노출되고 정상적으로 견적 요청을 받을 수 있습니다.</div>
    <button class="btn btn-outline btn-auto" style="margin-top:14px;" onclick="logout()">로그아웃</button>
  </div>`);
}
function renderRejected(shop) {
  return el(`<div style="max-width:480px;margin:60px auto;text-align:center;">
    <div class="big" style="font-size:40px;">🚫</div>
    <h2>승인 반려됨</h2>
    <div class="sub">${shop.name}의 등록 신청이 반려되었습니다. 문의사항은 고객센터로 연락해 주세요.</div>
    <button class="btn btn-outline btn-auto" style="margin-top:14px;" onclick="logout()">로그아웃</button>
  </div>`);
}

function renderDashboard(shop) {
  // 시공사 화면은 shop-care.js(구성안 5.3)가 맡는다. 구형 v6 대시보드(견적·입고·작업·청구 카드)는 2026-10-03 정리했다.
  return VLP.shopCare.render(shop, { onLogout: logout });
}

Store.onChange(() => {
  // 새 화면은 자체 갱신(입력 중인 값을 지우지 않게 시트·입력 칸이 열려 있으면 건너뜀)
  const app = document.querySelector('.vlp-app-shop');
  if (app && app.__refresh) { app.__refresh(); return; }
  render();
});

render();
