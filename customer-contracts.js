/* customer-contracts.js — 고객 화면의 새 계약 흐름 (S1: PWA-06 등록, PWA-09 확인·출고 요청, PWA-10 고객 쪽 READY 칩, PWA-11 펼침 카드).
 * 서버 호출은 전부 VLP.api(facade)로만 한다. 조회번호는 등록 응답을 받은 이 파일의 메모리에만 있고,
 * sessionStorage·localStorage·콘솔·알림 어디에도 남기지 않는다(새로고침하면 사라진다).
 */
(function (g) {
  'use strict';
  const V = g.VLP; const U = V.ui; const esc = U.esc;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  // 미가입 카마스터가 안내 문구의 링크로 바로 조회번호 화면에 들어오게 한다(통합 앱 진입에서 ?claim=1 처리)
  const claimLink = () => { try { return new URL('app.html?claim=1', location.href).href; } catch (e) { return 'app.html?claim=1'; } };
  let lastRegistration = null;       // {contractId, serviceContractNo, claimToken, carmasterMatched, name} — 메모리 전용
  const emptyDraft = () => ({ brand: '', manufacturerContractNo: '', vehicleModel: '', trim: '', color: '', contractDate: '', carmasterPhone: '', carmasterName: '', dealershipName: '', memo: '' });
  let draft = emptyDraft();
  let attemptKey = null;

  const S = V.customerScreens = {
    prefill(c) {
      const km = c.carmaster || {};
      draft = Object.assign(emptyDraft(), { manufacturerContractNo: c.manufacturerContractNo || '', vehicleModel: c.vehicleModel || '', trim: c.trim || '', color: c.color || '', contractDate: c.contractDate || '', carmasterPhone: km.phone || '', carmasterName: km.name || '', dealershipName: km.dealershipName || '' });
      attemptKey = null;
    },
    clearRegistration() { lastRegistration = null; },
    hasRegistration() { return !!lastRegistration; },
  };

  // ================= PWA-06: 등록 폼 =================
  S.renderRegister = function (ctx) {
    // 필수 3개: 제조사 계약번호, 차량 모델, 카마스터 연락처. 서비스 계약번호는 시스템이 부여하고 인도지는 출고 요청 때 입력한다(4.8).
    const wrap = el(`<div class="vlp-form" style="max-width:480px;">
      <h2>계약내역 등록</h2>
      <div class="sub">이미 체결한 계약의 내용을 입력해 주세요. 서비스 계약번호는 등록하면 자동으로 부여됩니다.</div>
      <div class="hint" id="vr-who"></div>
      <h3 style="margin-top:18px;">필수 항목</h3>
      <label for="rq-contract-no">제조사 계약번호 <span class="vlp-req">필수</span></label>
      <input id="rq-contract-no" type="text" autocomplete="off" placeholder="계약서에 적힌 실제 계약번호">
      <label for="rq-car">차량 모델 <span class="vlp-req">필수</span></label>
      <input id="rq-car" type="text" autocomplete="off" placeholder="예: 쏘렌토 하이브리드">
      <label for="rq-km-phone">카마스터 연락처 <span class="vlp-req">필수</span></label>
      <input id="rq-km-phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="010-1234-5678">
      <div class="hint">가입한 카마스터면 바로 승인 요청이 전달되고, 가입 전이면 조회번호가 발급됩니다.</div>
      <h3 style="margin-top:18px;">선택 항목</h3>
      <label for="rq-brand">제조사</label>
      <select id="rq-brand"><option value="">선택 안 함</option><option value="현대">현대</option><option value="기아">기아</option><option value="기타">기타</option></select>
      <label for="rq-trim">트림 / 옵션</label><input id="rq-trim" type="text" autocomplete="off">
      <label for="rq-color">색상</label><input id="rq-color" type="text" autocomplete="off">
      <label for="rq-date">계약일자</label><input id="rq-date" type="date" autocomplete="off">
      <label for="rq-km-name">카마스터 이름</label><input id="rq-km-name" type="text" autocomplete="off">
      <label for="rq-dealer">대리점</label><input id="rq-dealer" type="text" autocomplete="off">
      <label for="rq-memo">메모</label><textarea id="rq-memo" rows="2"></textarea>
      <button class="btn btn-primary btn-auto" id="rq-submit" type="button" style="margin-top:14px;" disabled>계약내역 등록하기</button>
      <div class="hint" id="rq-hint" role="status" style="margin-top:8px;"></div>
      <div id="rq-error" class="vlp-error" role="alert" hidden></div>
      <button class="btn btn-outline btn-auto" id="rq-back" type="button" style="margin-top:8px;">← 돌아가기</button>
    </div>`);
    const $ = (id) => wrap.querySelector(id);
    $('#vr-who').textContent = '등록자: ' + (ctx.name || '-') + ' · ' + (ctx.phone || '-');
    const map = { '#rq-contract-no': 'manufacturerContractNo', '#rq-car': 'vehicleModel', '#rq-km-phone': 'carmasterPhone', '#rq-brand': 'brand', '#rq-trim': 'trim', '#rq-color': 'color', '#rq-date': 'contractDate', '#rq-km-name': 'carmasterName', '#rq-dealer': 'dealershipName', '#rq-memo': 'memo' };
    Object.keys(map).forEach((sel) => {
      const input = $(sel); input.value = draft[map[sel]] || '';
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input', () => {
        draft[map[sel]] = sel === '#rq-km-phone' ? U.formatPhone(input.value) : input.value;
        if (sel === '#rq-km-phone' && input.value !== draft.carmasterPhone) input.value = draft.carmasterPhone;
        validate();
      });
    });
    const submit = $('#rq-submit'), hint = $('#rq-hint'), errBox = $('#rq-error');
    function missing() {
      const m = [];
      if (!draft.manufacturerContractNo.trim()) m.push('제조사 계약번호');
      if (draft.vehicleModel.trim().length < 2) m.push('차량 모델');
      if (!U.isPhone(draft.carmasterPhone)) m.push('카마스터 연락처(010-0000-0000)');
      return m;
    }
    function validate() { const m = missing(); submit.disabled = m.length > 0; hint.textContent = m.length ? '다음 항목을 확인해 주세요: ' + m.join(', ') : ''; }
    validate();
    $('#rq-back').addEventListener('click', () => ctx.back());
    submit.addEventListener('click', async () => {
      if (missing().length) return;
      submit.disabled = true; errBox.hidden = true;
      attemptKey = attemptKey || V.api.newIdempotencyKey();
      const body = {};
      Object.keys(draft).forEach((k) => { const val = String(draft[k] || '').trim(); if (val) body[k] = val; });
      try {
        const res = await V.api.contracts.create(body, { idempotencyKey: attemptKey });
        lastRegistration = { contractId: res.contractId, serviceContractNo: res.serviceContractNo, claimToken: res.claimToken || null, carmasterMatched: !!res.carmasterMatched, name: ctx.name, karmasterPhone: U.formatPhone(draft.carmasterPhone) };
        draft = emptyDraft(); attemptKey = null;
        ctx.done();
      } catch (e) {
        errBox.textContent = U.errorText(e); errBox.hidden = false; submit.disabled = false;
        if (e.status === 409 || e.status === 422) attemptKey = null; // 내용이 바뀔 수 있으니 새 요청으로 취급
      }
    });
    return wrap;
  };

  // ================= PWA-06: 등록 완료 (조회번호 1회 표시) =================
  S.renderDone = function (ctx) {
    const r = lastRegistration;
    if (!r) {
      // 새로고침·재진입: 조회번호는 다시 보여 주지 않는다.
      const w = el(`<div class="vlp-done" style="max-width:480px;"><h2>계약내역 등록</h2>
        <div class="msg-box" id="vd-gone">조회번호는 등록 직후 한 번만 표시되며 다시 볼 수 없습니다. 이미 안내문을 복사해 두셨다면 그대로 카마스터에게 전달해 주세요.</div>
        <button class="btn btn-primary btn-auto" id="vd-ok" type="button">내 계약 보기</button></div>`);
      w.querySelector('#vd-ok').addEventListener('click', () => ctx.finish());
      return w;
    }
    const notice = V.config.get('claimNoticeTemplate').replace('{customer}', r.name || '고객').replace('{karmasterPhone}', r.karmasterPhone || '').replace('{no}', r.serviceContractNo).replace('{token}', r.claimToken || '').replace('{hours}', V.config.get('claimTtlHours')).replace('{link}', claimLink());
    const w = el(`<div class="vlp-done" style="max-width:480px;"><h2>${r.reissued ? '조회번호를 다시 발급했습니다' : '등록이 완료되었습니다'}</h2>
      <div class="msg-box"><div class="hint" style="margin:0;">서비스 계약번호</div><div class="vlp-big" id="vd-no"></div></div>
      <div id="vd-token-box"></div>
      <button class="btn btn-primary btn-auto" id="vd-ok" type="button" style="margin-top:14px;">확인했습니다</button></div>`);
    w.querySelector('#vd-no').textContent = r.serviceContractNo;
    const box = w.querySelector('#vd-token-box');
    if (r.claimToken) {
      box.innerHTML = `<div class="addr-box"><b>카마스터에게 전달할 정보</b>
        <div class="summary-line"><span>카마스터 연락처 (필수 입력)</span><span class="vlp-mono" id="vd-kmphone"></span></div>
        <div class="hint" style="margin:0 0 6px;">조회번호 (이 화면에서 한 번만 보입니다)</div>
        <div class="vlp-big vlp-mono" id="vd-token"></div>
        <div class="hint">유효 ${esc(V.config.get('claimTtlHours'))}시간 · 1회용. 아직 가입하지 않은 카마스터에게 본인이 직접 전달해 주세요. 알림이나 기록에는 남지 않습니다.</div>
        <div class="btn-row">
          <button class="btn btn-sm" id="vd-copy" type="button">안내문 복사</button>
          <button class="btn btn-sm" id="vd-share" type="button">공유하기</button>
          <button class="btn btn-sm" id="vd-sms" type="button">시스템 문자 발송</button>
        </div><div class="hint" id="vd-sms-hint"></div><div class="hint" id="vd-act" role="status"></div></div>`;
      box.querySelector('#vd-token').textContent = r.claimToken;
      box.querySelector('#vd-kmphone').textContent = r.karmasterPhone || '-';
      box.querySelector('#vd-act').insertAdjacentHTML('beforebegin', '<details style="margin-top:8px;"><summary class="hint" style="cursor:pointer;">전달할 안내문 미리보기</summary><pre id="vd-notice" class="hint" style="white-space:pre-wrap;"></pre></details>');
      box.querySelector('#vd-notice').textContent = notice;
      const act = box.querySelector('#vd-act');
      box.querySelector('#vd-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(notice); act.textContent = '안내문을 복사했습니다.'; } catch (e) { act.textContent = '복사하지 못했습니다. 화면의 번호를 직접 전달해 주세요.'; }
      });
      const share = box.querySelector('#vd-share');
      if (!navigator.share) { share.disabled = true; share.title = '이 기기에서는 공유를 지원하지 않습니다'; }
      share.addEventListener('click', async () => { try { await navigator.share({ text: notice }); } catch (e) { /* 취소 */ } });
      // 채널 A(시스템 SMS): 정책 설정이 꺼져 있으면 비활성. 켜져도 발송 API가 openapi에 없어 아직 호출 대상이 없다(결정·발견사항).
      const sms = box.querySelector('#vd-sms'), smsHint = box.querySelector('#vd-sms-hint');
      const smsOn = !!V.config.get('systemSmsEnabled');
      sms.disabled = !smsOn;
      smsHint.textContent = smsOn ? '' : '시스템 문자 발송은 아직 사용할 수 없습니다. 복사/공유로 직접 전달해 주세요.';
      sms.addEventListener('click', () => { if (smsOn) act.textContent = '시스템 문자 발송 API가 아직 정의되지 않아 보내지 못했습니다.'; });
    } else {
      box.innerHTML = `<div class="msg-box" id="vd-matched">카마스터에게 승인 요청이 전달되었습니다. 가입했거나 이미 확인번호를 정한 카마스터라 조회번호는 필요하지 않습니다.<br>승인되면 내 계약에서 내용을 확인할 수 있어요.</div>`;
    }
    w.querySelector('#vd-ok').addEventListener('click', () => { lastRegistration = null; ctx.finish(); });
    return w;
  };

  // ================= 홈: 내 계약 목록 (PWA-11 펼침 카드 + PWA-09/10 액션) =================
  function stateChip(delivery) { return delivery ? U.stateChip(delivery.displayState) : ''; }
  function uiKey(ctx) { return 'vlp_ui_customer_' + U.digits(ctx.phone); }

  function releaseForm(c, ctx, done) {
    const sites = (V.config.get('deliverySites') || []).filter((s) => s.type === c.destinationType);
    const isAddr = c.destinationType === 'CUSTOM_ADDRESS';
    const f = el(`<form class="vlp-release" novalidate>
      <h4>출고 요청</h4>
      <div class="hint">인수 방식을 고르고 인수 장소를 알려 주세요.</div>
      <fieldset class="vlp-fs"><legend>인수 방식</legend>
        <label class="vlp-radio"><input type="radio" name="receiptMode" value="ON_SITE"> ${esc(U.RECEIPT_LABEL.ON_SITE)}</label>
        <label class="vlp-radio"><input type="radio" name="receiptMode" value="REMOTE_PROXY"> ${esc(U.RECEIPT_LABEL.REMOTE_PROXY)}</label>
      </fieldset>
      <div class="vlp-site"></div>
      <div class="vlp-proxy" hidden>
        <label class="vlp-radio"><input type="checkbox" name="proxyConsent"> 원격 승인과 시공사 대리 인수를 위임하는 데 동의합니다.</label>
        <div class="hint">대리 인수는 시공사가 있는 인도지에서만 가능합니다. 인수 후에도 사진을 확인하고 최종 승인할 수 있어요.</div>
      </div>
      <button type="submit" class="btn btn-primary btn-sm vlp-release-submit" disabled>출고 요청 보내기</button>
      <div class="vlp-error" role="alert" hidden></div>
    </form>`);
    const siteBox = f.querySelector('.vlp-site');
    if (isAddr) siteBox.innerHTML = '<label>인수 장소(주소)</label><input type="text" name="customAddress" autocomplete="off" placeholder="예: 울산광역시 남구 ...">';
    else siteBox.innerHTML = '<label>인도지</label><select name="deliverySiteId">' + '<option value="">선택해 주세요</option>' + sites.map((s) => '<option value="' + esc(s.siteId) + '" data-shop="' + (s.hasShop ? '1' : '0') + '">' + esc(s.name) + '</option>').join('') + '</select>' + (sites.length ? '' : '<div class="hint">선택 가능한 인도지가 없습니다. 카마스터에게 문의해 주세요.</div>');
    const remote = f.querySelector('input[value="REMOTE_PROXY"]');
    const mode = () => { const r = f.querySelector('input[name="receiptMode"]:checked'); return r ? r.value : ''; };
    const submit = f.querySelector('.vlp-release-submit'), errBox = f.querySelector('.vlp-error'), proxyBox = f.querySelector('.vlp-proxy');
    function hasShop() { const s = f.querySelector('select[name="deliverySiteId"]'); return !!(s && s.selectedOptions[0] && s.selectedOptions[0].dataset.shop === '1'); }
    function validate() {
      const m = mode();
      remote.disabled = isAddr || !hasShop();
      if (remote.disabled && m === 'REMOTE_PROXY') { remote.checked = false; }
      proxyBox.hidden = mode() !== 'REMOTE_PROXY';
      const where = isAddr ? f.querySelector('[name=customAddress]').value.trim() : f.querySelector('[name=deliverySiteId]').value;
      const consent = f.querySelector('[name=proxyConsent]').checked;
      submit.disabled = !(mode() && where && (mode() !== 'REMOTE_PROXY' || consent));
    }
    f.addEventListener('input', () => { f.dataset.dirty = '1'; validate(); });
    f.addEventListener('change', () => { f.dataset.dirty = '1'; validate(); });
    validate();
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); validate(); if (submit.disabled) return;
      submit.disabled = true; errBox.hidden = true;
      const body = { receiptMode: mode() };
      if (isAddr) body.customAddress = f.querySelector('[name=customAddress]').value.trim(); else body.deliverySiteId = f.querySelector('[name=deliverySiteId]').value;
      if (body.receiptMode === 'REMOTE_PROXY') body.proxyConsent = true;
      try { await V.api.contracts.releaseRequest(c.contractId, body); done('released'); }
      catch (e) {
        if (e.status === 409 && /이미 출고/.test(e.message || '')) { done('released'); return; }
        errBox.textContent = U.errorText(e); errBox.hidden = false; submit.disabled = false;
      }
    });
    return f;
  }

  // 조회번호를 잃었거나 만료됐을 때: 고객이 새 번호를 다시 발급한다(이전 번호는 즉시 쓸 수 없게 된다). 미가입 카마스터 건에서만 grantId가 내려온다.
  function reissueBox(c, ctx) {
    const box = el(`<div class="vlp-reissue"><div class="hint">카마스터에게 전달한 조회번호를 분실했거나 기한이 지났다면 새로 발급할 수 있어요. 이전 번호는 더 이상 쓸 수 없고, 새 번호는 발급 직후 한 번만 보입니다.</div>
      <button type="button" class="btn btn-sm vlp-reissue-open">조회번호 다시 발급</button>
      <div class="vlp-reissue-confirm" hidden><div class="hint" style="color:#b4362e;">다시 발급하면 이전 조회번호는 즉시 무효가 됩니다. 계속할까요?</div>
        <div class="btn-row"><button type="button" class="btn btn-primary btn-sm vlp-reissue-go">발급</button><button type="button" class="btn btn-sm vlp-reissue-cancel">취소</button></div></div>
      <div class="vlp-error" role="alert" hidden></div></div>`);
    const open = box.querySelector('.vlp-reissue-open'), conf = box.querySelector('.vlp-reissue-confirm'), err = box.querySelector('.vlp-error'), go = box.querySelector('.vlp-reissue-go');
    open.addEventListener('click', () => { conf.hidden = false; open.hidden = true; });
    box.querySelector('.vlp-reissue-cancel').addEventListener('click', () => { conf.hidden = true; open.hidden = false; });
    go.addEventListener('click', async () => {
      go.disabled = true; err.hidden = true;
      try {
        const res = await V.api.access.reissue(c.grantId);
        lastRegistration = { contractId: res.contractId, serviceContractNo: res.serviceContractNo, claimToken: res.claimToken || null, carmasterMatched: false, name: ctx.name, reissued: true, karmasterPhone: U.formatPhone((c.carmaster || {}).phone) };
        ctx.done();
      } catch (e) { err.textContent = U.errorText(e); err.hidden = false; go.disabled = false; }
    });
    return box;
  }

  function actionsFor(c, ctx, st, refresh, delivery) {
    const box = document.createElement('div'); box.className = 'vlp-actions';
    const setMem = (patch) => { const m = U.mem.get(uiKey(ctx)); m[c.contractId] = Object.assign(m[c.contractId] || {}, patch); U.mem.set(uiKey(ctx), m); refresh(true); };
    if (c.status === 'PENDING_APPROVAL') {
      box.innerHTML = '<div class="hint" data-role="pending">카마스터의 승인을 기다리고 있어요. ' + esc(U.remaining(c.expiresAt)) + '(미승인 시 자동 만료)</div>';
      if (c.grantId) box.appendChild(reissueBox(c, ctx));
    } else if (c.status === 'REJECTED' || c.status === 'EXPIRED') {
      box.innerHTML = '<div class="hint">' + (c.status === 'REJECTED' ? '카마스터가 이 계약을 승인하지 않았습니다.' : '승인 기한이 지나 만료되었습니다.') + ' 내용을 확인하고 다시 등록할 수 있어요.</div>';
      const b = el('<button type="button" class="btn btn-primary btn-sm vlp-reregister">내용 고쳐 다시 등록</button>');
      b.addEventListener('click', () => { S.prefill(c); ctx.goRegister(); });
      box.appendChild(b);
      if (c.grantId) box.appendChild(reissueBox(c, ctx));
    } else if (c.status === 'APPROVED' && c.deliveryId) {
      box.innerHTML = '<div class="hint">출고가 의뢰되었습니다. 배송이 진행되면 위치와 진행 기록이 위에 표시됩니다.</div>';
    } else if (c.status === 'APPROVED' && !st.confirmed) {
      box.innerHTML = '<div class="hint">카마스터가 승인했습니다. 위 내용이 계약서와 맞는지 확인해 주세요.</div>';
      const b = el('<button type="button" class="btn btn-primary btn-sm vlp-confirm">맞습니다, 확인했어요</button>');
      const err = el('<div class="vlp-error" role="alert" hidden></div>');
      b.addEventListener('click', async () => {
        b.disabled = true; err.hidden = true;
        try { await V.api.contracts.confirm(c.contractId); setMem({ confirmed: true }); }
        catch (e) { if (e.status === 409) { setMem({ confirmed: true }); return; } err.textContent = U.errorText(e); err.hidden = false; b.disabled = false; }
      });
      box.appendChild(b); box.appendChild(err);
    } else if (c.status === 'APPROVED' && !st.released) {
      box.appendChild(releaseForm(c, ctx, (k) => setMem({ confirmed: true, [k]: true })));
    } else if (c.status === 'APPROVED') {
      box.innerHTML = '<div class="hint" data-role="released">출고 요청을 보냈습니다. 카마스터가 출고를 의뢰하면 배송이 시작됩니다.</div>';
    }
    return box;
  }

  // ================= 홈 / 내 차량 / 메시지 / 내 정보 (화면 구성안 2.3·2.11, 하단 탭) + 건 상세(vlp-case) =================
  const careOn = () => V.config.get('careTab') !== false && !!(V.api && V.api.care && V.customerCare);
  const NAV_ALL = [['home', '🏠', '홈'], ['cars', '🚗', '내 차량'], ['care', '🧴', '신차케어'], ['msgs', '💬', '메시지'], ['me', '👤', '내 정보']];
  const navItems = () => NAV_ALL.filter((n) => n[0] !== 'care' || careOn());
  const wide = () => g.matchMedia && g.matchMedia('(min-width: 768px)').matches;
  const xl = () => g.matchMedia && g.matchMedia('(min-width: 1280px)').matches;
  /** PC(≥1280) 차량 전환 방식: chips(상단 칩) | menu(좌측 메뉴 '내 차량' 하위 목록) | rail(메뉴 옆 접고 펴는 얇은 열). ?sw= 또는 설정 customerCarSwitcher */
  const swMode = () => { let q = ''; try { q = new URLSearchParams(g.location.search).get('sw') || ''; } catch (e) { /* 무시 */ } return ['menu', 'rail', 'chips'].includes(q) ? q : (V.config.get('customerCarSwitcher') || 'chips'); };
  // 태블릿·PC 레이아웃: b(기본, 사용자 확정 10-03) 상단 메뉴 + 2대 이상일 때만 상태 칩 줄 / a 좌측 메뉴(+접이식 차량 목록) 시안 / old 이전 방식(?cl=old)
  const clq = () => { let q = ''; try { q = new URLSearchParams(g.location.search).get('cl') || ''; } catch (e) { /* 무시 */ } return q || V.config.get('customerLayout') || ''; };
  const wide768 = () => g.matchMedia && g.matchMedia('(min-width: 768px)').matches;
  const swNow = () => { const q = clq(); if (wide768() && q === 'a') return 'menu'; if (wide768() && q === 'b') return 'pill'; return xl() ? swMode() : 'chips'; };
  const memKey = (k) => 'vlp_cust_' + k;
  const memGet = (k) => { try { return sessionStorage.getItem(memKey(k)); } catch (e) { return null; } };
  const memSet = (k, v) => { try { sessionStorage.setItem(memKey(k), v); } catch (e) { /* 무시 */ } };

  S.renderHome = function (ctx) {
    const wrap = el('<div class="vlp-app vlp-app-customer"><div class="vlp-app-list"></div><div class="vlp-app-detail"></div><nav class="vlp-bottomnav" aria-label="주 메뉴"></nav></div>');
    const listPane = wrap.querySelector('.vlp-app-list'), detailPane = wrap.querySelector('.vlp-app-detail'), nav = wrap.querySelector('.vlp-bottomnav');
    let data = { items: [], deliveries: {}, tracking: {}, mem: {}, chat: {} }, lastSig = null, curDetail = null, loaded = false;
    let care = { items: [], cars: [], shops: [], catalog: null }, careSel = null, careNew = false;
    try { careSel = sessionStorage.getItem('vlp_cust_care') || null; } catch (e) { /* 무시 */ }
    const setCareSel = (id) => { careSel = id; try { if (id) sessionStorage.setItem('vlp_cust_care', id); else sessionStorage.removeItem('vlp_cust_care'); } catch (e) { /* 무시 */ } };
    const tabKey = 'vlp_cust_tab';
    const getTab = () => { try { return sessionStorage.getItem(tabKey) || 'home'; } catch (e) { return 'home'; } };
    const setTab = (t) => { try { sessionStorage.setItem(tabKey, t); } catch (e) { /* 무시 */ } route.clear(); paint(); };
    const route = V.caseView.route;
    let pendingOpen = null;

    // ---- 계약 한 건의 화면용 요약 ----
    function describe(c) {
      const d = data.deliveries[c.contractId], st = data.mem[c.contractId] || {};
      const released = !!(st.released);
      const idx = V.caseView.stepIdxOf(d, released);
      let next = '', primary = null, urgent = '';
      if (d) {
        const s = d.storageState;
        if (s === 'PLANNED' || s === 'SHIPPED') next = '다음: 탁송이 시작됩니다';
        else if (s === 'IN_TRANSIT') next = '다음: 도착하면 인수 확인을 요청드립니다';
        else if (s === 'ARRIVED') { next = '다음: 사진과 검수 결과를 확인하고 인수를 승인해 주세요'; primary = { label: '인수 확인 열기', title: '인수 확인', kind: 'handover' }; urgent = '인수 확인 필요'; }
        else if (s === 'DELIVERED') {
          let rated = []; try { rated = JSON.parse(g.localStorage.getItem('vlp_rated_' + d.deliveryId) || '[]'); } catch (e) { /* 무시 */ }
          const left = (d.ratingTargets || []).filter((t) => !rated.includes(t.targetType)).length;
          if (left) { next = '인도가 끝났어요. 평가를 남길 수 있어요'; primary = { label: '평가 남기기', title: '평가', kind: 'rating' }; } else next = '인도가 끝났어요. 평가해 주셔서 감사합니다';
        }
        if (d.displayState === 'EXCEPTION') urgent = urgent || '지연 안내';
      } else if (c.status === 'PENDING_APPROVAL') next = '다음: 카마스터가 승인하면 계약 내용을 확인해 주세요';
      else if (c.status === 'REJECTED' || c.status === 'EXPIRED') { next = '내용을 확인하고 다시 등록할 수 있어요'; urgent = '다시 등록 가능'; }
      else if (c.status === 'APPROVED' && !st.confirmed) { next = '다음: 계약 내용이 맞는지 확인해 주세요'; primary = { label: '계약 내용 확인', title: '계약 내용 확인', kind: 'form' }; urgent = '확인 필요'; }
      else if (c.status === 'APPROVED' && !st.released) { next = '다음: 인도지와 인수 방식을 정해 출고를 요청해 주세요'; primary = { label: '출고 요청', title: '출고 요청', kind: 'form' }; urgent = '출고 요청 필요'; }
      else if (c.status === 'APPROVED') next = '다음: 카마스터가 출고를 의뢰합니다';
      const badge = d ? stateChip(d) : '<span class="badge ' + (U.STATUS_BADGE[c.status] || 'info') + '">' + esc(U.STATUS_LABEL[c.status] || c.status) + '</span>';
      // 홈의 "지금 확인할 일" 카드 행동: 주요 행동이 있으면 그것, 배송 중이면 위치 확인
      let todo = primary ? { label: primary.label, open: true } : null;
      if (!todo && d && d.storageState === 'IN_TRANSIT') todo = { label: '위치 확인', tab: 'location' };
      return { d, st, idx, next, primary, urgent, badge, todo };
    }
    const refresh = (force) => load(force !== false);

    function openChat(c, btn) {
      V.chat.open(c.contractId, { role: 'customer', other: '카마스터', summary: (c.vehicleModel || '차량') + ' · ' + (c.serviceContractNo || '') + ' · 카마스터', opener: btn });
      (data.chat[c.contractId] || []).forEach((id) => { V.api.notifications.read(id).catch(() => null); });
      data.chat[c.contractId] = [];
    }

    // ---- 상세 ----
    function buildDetail(c) {
      const x = describe(c), d = x.d, tr = data.tracking[c.contractId];
      const tabs = [{ id: 'overview', label: '개요', render: () => {
        const w = el('<div class="vlp-ov"></div>');
        // 시트로 여는 행동이 없는 상태(대기·거절·만료·진행 중 안내)는 안내와 보조 기능(조회번호 재발급, 다시 등록)을 여기서 바로 보여 준다
        if (!x.primary) w.appendChild(V.caseView.card('지금 상태', actionsFor(c, ctx, x.st, refresh, d)));
        w.appendChild(V.caseView.summaryCard(c, 'customer', d, tr, { flags: x.st, customer: { name: ctx.name, phone: ctx.phone } }));
        const note = V.caseView.noteCard(tr, '카마스터 안내'); if (note) w.appendChild(note);
        const ev = V.caseView.recentEvents(tr); if (ev) w.appendChild(ev);
        const di = V.caseView.deliveryInfoCard(d, tr); if (di) w.appendChild(di);
        const cs = V.caseView.constructionCard(d, tr, false); if (cs) w.appendChild(cs);
        if (d && d.storageState === 'DELIVERED') {
          // 목업(.cd.in): 평가 전에는 강조(파란 테두리·연한 배경), 평가를 마치면 강조 없이 완료 문구만
          let rated = []; try { rated = JSON.parse(g.localStorage.getItem('vlp_rated_' + d.deliveryId) || '[]'); } catch (e) { /* 무시 */ }
          const left = (d.ratingTargets || []).filter((t) => !rated.includes(t.targetType)).length;
          const ev0 = V.caseView.card('평가', el('<div class="hint">' + (left ? '인도 완료 후 언제든 카마스터와 탁송을 평가할 수 있어요. 그 자리에서 하지 않아도 괜찮아요.' : '평가를 남겼어요. 감사합니다. 제출한 평가는 수정할 수 없어요.') + '</div>'));
          ev0.classList.add('vlp-eval-card'); if (left) ev0.classList.add('todo');
          { const eb = el('<button type="button" class="btn btn-sm vlp-eval-btn">' + (left ? '평가 남기기' : '내 평가 확인') + '</button>'); eb.addEventListener('click', () => V.handover.openRating(d, { onChange: () => refresh(true) }, eb)); ev0.appendChild(eb); }
          w.appendChild(ev0);
        }
        w.appendChild(V.caseView.chatPreview(c.contractId, (b) => openChat(c, b), { role: 'customer', other: '카마스터' }));
        return w;
      } }];
      tabs.push({ id: 'location', label: '위치', render: () => V.caseView.locationTab(d, tr) });
      tabs.push({ id: 'construction', label: '시공', render: () => V.caseView.constructionTab(d, tr, false) });
      tabs.push({ id: 'history', label: '이력', render: () => V.caseView.historyTab(d, tr, false, c) });
      const o = { role: 'customer', contract: c, delivery: d, idx: x.idx, stateHTML: x.badge, next: x.next, aside: (tr && tr.location && tr.location.latest) ? tr.location.latest.regionText : '', tabs,
        defaultTab: d && d.storageState === 'IN_TRANSIT' ? 'location' : 'overview', chatBadge: (data.chat[c.contractId] || []).length,
        onBack: route.clear, onChat: (b) => openChat(c, b) };
      if ((data.items || []).length > 1 && c.serviceContractNo) o.titleSuffix = c.serviceContractNo.slice(-4); // 차량 칩과 같은 표기(차종 · 계약번호 끝 4자리)
      // 도착(인수 확인 대기)은 처음 한 번 인수 확인 시트를 자동으로 연다(2.4). 홈 카드의 행동 버튼으로 들어왔을 때도 그 시트를 연다.
      if (x.primary) {
        const key = 'vlp_auto_' + (d ? d.deliveryId : c.contractId) + '_' + (d ? d.storageState : '');
        let seen = false; try { seen = !!sessionStorage.getItem(key); } catch (e) { /* 무시 */ }
        const viaCard = pendingOpen === c.contractId;
        if (viaCard || (d && d.storageState === 'ARRIVED' && !seen)) { o.autoOpen = true; try { sessionStorage.setItem(key, '1'); } catch (e) { /* 무시 */ } }
        pendingOpen = null;
      }
      if (x.primary && x.primary.kind === 'rating') o.primary = { label: x.primary.label, title: x.primary.title, direct: (btn) => V.handover.openRating(d, { onChange: () => refresh(true) }, btn) };
      else if (!x.primary && d && ['PLANNED', 'SHIPPED', 'IN_TRANSIT'].includes(d.storageState)) o.primary = { label: '카마스터에게 문의', title: '카마스터에게 문의', direct: (btn) => openChat(c, btn) };
      else if (x.primary) o.primary = { label: x.primary.label, title: x.primary.title, open: (h) => x.primary.kind === 'handover' ? V.handover.customerPanel(d, { onChange: () => refresh(true) }) : actionsFor(c, ctx, x.st, () => { if (h.close) h.close(); refresh(true); }, d) };
      return V.caseView.detail(o);
    }

    // ---- 목록 ----
    function rowFor(c, activeId) {
      const x = describe(c);
      return V.caseView.listRow({ contract: c, delivery: x.d, idx: x.idx, badgeHTML: x.badge, urgent: x.urgent, active: c.contractId === activeId, onOpen: (id) => route.set(id), sub: (c.carmaster && c.carmaster.name) || '' });
    }
    function head(title, withNew) {
      const h = el('<div class="vlp-pane-head"><h2></h2></div>'); h.querySelector('h2').textContent = title;
      if (withNew) { const b = el('<button class="btn btn-outline btn-sm" id="vh-new" type="button">+ 새 계약 등록</button>'); b.addEventListener('click', () => ctx.goRegister()); h.appendChild(b); }
      return h;
    }
    function paintList(activeId) {
      const tab = getTab(); listPane.innerHTML = ''; listPane.classList.toggle('vlp-home-pane', tab === 'home');
      const items = data.items;
      if (tab === 'home') {
        // 구성안 4.2: 인사 + 🔔 / 지금 확인할 일(카드 하나) / 진행 중 / 바로가기
        const hd = el('<div class="vlp-pane-head vlp-home-head"><h2></h2></div>');
        hd.querySelector('h2').textContent = ctx.name ? ctx.name + '님, 안녕하세요' : '안녕하세요';
        hd.appendChild(U.notificationsPanel({ role: 'customer', sheet: true, extra: () => V.chat.consentNotes(items.map((c) => ({ id: c.contractId, label: c.vehicleModel })), 'customer', (id) => { const x = document.querySelector('.vlp-sheet-close'); if (x) x.click(); route.set(id); }) }));
        listPane.appendChild(hd);
        const live = items.filter((c) => { const x = describe(c); return !(x.d && x.d.storageState === 'DELIVERED') && c.status !== 'REJECTED' && c.status !== 'EXPIRED'; });
        const withTodo = live.map((c) => ({ c, x: describe(c) })).filter(({ x }) => x.todo);
        withTodo.sort((p, q) => (q.x.urgent ? 1 : 0) - (p.x.urgent ? 1 : 0));
        // 신차케어 건도 홈에 보인다: 고객이 해야 할 단계는 "확인할 일"로, 나머지는 "진행 중"으로
        const CARE_TODO = { QUOTED: '견적 확인하기', CUSTOMER_INSPECT: '검수 결과 확인', READY_TO_RECEIVE: '수령 확인하기', PRICE_CHECK: '정찰제 확인하기', RATE: '평가 남기기', CONFIRMED: '입고 안내 보기' };
        const careLive = ((care && care.items) || []).filter((it) => it.phase !== 'DONE');
        const careTodo = careLive.filter((it) => CARE_TODO[it.phase]);
        const openCare = (id) => { careNew = false; setCareSel(id); setTab('care'); };
        const sum = el('<div class="vlp-home-sum"></div>');
        sum.textContent = (live.length || careLive.length) ? '진행 중 · 신차인도 ' + live.length + '건 · 신차케어 ' + careLive.length + '건' : '아직 진행 중인 건이 없어요';
        listPane.appendChild(sum);
        const nTodo = withTodo.length + careTodo.length;
        listPane.appendChild(el('<div class="vlp-section-title">지금 확인할 일' + (nTodo ? ' <span class="vlp-count">' + nTodo + '</span>' : '') + '</div>'));
        const cards = [];
        withTodo.forEach(({ c, x }) => {
          const card = el('<div class="vlp-todo-card"><div class="vlp-todo-top"><b class="vlp-todo-title"></b><span class="vlp-row-badge"></span></div><p class="vlp-todo-text"></p><button type="button" class="btn btn-primary vlp-todo-act"></button></div>');
          card.dataset.contractId = c.contractId; card.querySelector('.vlp-todo-title').textContent = c.vehicleModel || '차종 미입력';
          card.querySelector('.vlp-row-badge').innerHTML = x.badge;
          card.querySelector('.vlp-todo-text').textContent = x.d && x.d.storageState === 'IN_TRANSIT' && data.tracking[c.contractId] && data.tracking[c.contractId].location && data.tracking[c.contractId].location.latest ? '배송 중 · ' + data.tracking[c.contractId].location.latest.regionText : x.next.replace(/^다음:\s*/, '');
          const act = card.querySelector('.vlp-todo-act'); act.textContent = x.todo.label;
          act.addEventListener('click', () => { if (x.todo.tab) V.caseView.setTab(c.contractId, x.todo.tab); else V.caseView.setTab(c.contractId, 'overview'); if (x.todo.open) pendingOpen = c.contractId; route.set(c.contractId); });
          cards.push({ card, contractId: c.contractId });
        });
        careTodo.forEach((it) => {
          const card = el('<div class="vlp-todo-card vlp-todo-care"><div class="vlp-todo-top"><b class="vlp-todo-title"></b><span class="vlp-row-badge"></span></div><p class="vlp-todo-text"></p><button type="button" class="btn btn-primary vlp-todo-act"></button></div>');
          card.dataset.careId = it.careId; card.querySelector('.vlp-todo-title').textContent = '🧴 ' + (it.vehicleModel || '차종 미입력') + (it.shop ? ' · ' + it.shop.name : '');
          card.querySelector('.vlp-row-badge').innerHTML = V.customerCare.badge(it); card.querySelector('.vlp-todo-text').textContent = V.customerCare.nextOf(it);
          const act = card.querySelector('.vlp-todo-act'); act.textContent = CARE_TODO[it.phase]; act.addEventListener('click', () => openCare(it.careId));
          cards.push({ card, careId: it.careId });
        });
        const shown = cards.slice(0, 3); shown.forEach(({ card }) => listPane.appendChild(card));
        if (cards.length > shown.length) listPane.appendChild(el('<div class="hint vlp-todo-more">외 ' + (cards.length - shown.length) + '건은 아래 진행 중 목록에서 확인해 주세요.</div>'));
        if (!cards.length) listPane.appendChild(el('<div class="vlp-todo-none"><span class="vlp-todo-ok" aria-hidden="true">✓</span><div><b>지금 해야 할 일이 없어요</b><span class="hint">새 소식이 오면 여기에 먼저 알려 드려요.</span></div></div>'));
        const shownIds = new Set(shown.map((x) => x.contractId || x.careId));
        const rest = live.filter((c) => !shownIds.has(c.contractId)), careRest = careLive.filter((it) => !shownIds.has(it.careId));
        // "내 차량 전체 보기"는 진행 중 목록의 더보기라서 그 제목줄 오른쪽에 둔다
        const moreCars = () => { if (!items.length) return null; const b = el('<button type="button" class="vlp-to-cars">전체 보기 (' + items.length + ') ›</button>'); b.setAttribute('aria-label', '내 차량 전체 보기 ' + items.length + '건'); b.addEventListener('click', () => setTab('cars')); return b; };
        if (rest.length || careRest.length) {
          const ttl = el('<div class="vlp-section-title">진행 중 <span class="vlp-count">' + (rest.length + careRest.length) + '</span></div>'); const mc = moreCars(); if (mc) ttl.appendChild(mc); listPane.appendChild(ttl);
          rest.forEach((c) => listPane.appendChild(rowFor(c, activeId)));
          careRest.forEach((it) => listPane.appendChild(V.customerCare.row(it, false, openCare)));
        } else if (items.length) {
          const ttl = el('<div class="vlp-section-title">내 차량</div>'); ttl.appendChild(moreCars()); listPane.appendChild(ttl);
        }
        const scZone = el('<div class="vlp-sc-zone"><div class="vlp-section-title vlp-sc-title">바로가기</div></div>');
        const TILES = [['karmasters', '🔎', '카마스터 찾기', '담당 카마스터를 찾아 상담해요'], ['register', '📝', '계약내역 등록', '상담한 계약을 앱에 기록해요'], ['care', '🧴', '신차케어 신청', '시공사에 견적을 요청해요']];
        const sc = el('<div class="vlp-shortcuts vlp-tiles">' + TILES.map(([k, ic, t, d]) => '<button type="button" class="vlp-sc vlp-tile"' + (k === 'register' ? ' id="vh-new"' : '') + ' data-sc="' + k + '"><span class="vlp-tile-ic" aria-hidden="true">' + ic + '</span><span class="vlp-tile-tx"><b>' + t + '</b><span>' + d + '</span></span></button>').join('') + '</div>');
        sc.querySelector('[data-sc=karmasters]').addEventListener('click', () => ctx.goKarmasters && ctx.goKarmasters());
        sc.querySelector('[data-sc=register]').addEventListener('click', () => ctx.goRegister());
        sc.querySelector('[data-sc=care]').addEventListener('click', () => { if (careOn()) { careNew = true; setCareSel(null); setTab('care'); } else if (ctx.goCare) ctx.goCare(); });
        scZone.appendChild(sc); listPane.appendChild(scZone);
      } else if (tab === 'cars') {
        if (swNow() !== 'menu') listPane.appendChild(head('내 차량', true));
        if (swNow() === 'rail') {
          const tg = el('<button type="button" class="vlp-rail-toggle" aria-label="차량 목록 접기/펼치기"></button>'); const closed = railClosed(); tg.textContent = closed ? '»' : '«'; tg.setAttribute('aria-expanded', String(!closed)); tg.addEventListener('click', () => { memSet('rail', closed ? '0' : '1'); paint(); }); listPane.appendChild(tg);
        }
        if (!items.length) {
          const empty = el('<div class="empty-state"><div class="big">📭</div>아직 등록된 계약이 없습니다.<br><button class="btn btn-primary" style="width:auto;margin-top:14px;padding:10px 20px;" id="hist-empty-register" type="button">계약내역 등록하기</button></div>');
          empty.querySelector('button').addEventListener('click', () => ctx.goRegister()); listPane.appendChild(empty);
        }
        if (swNow() === 'menu') { /* 좌측 메뉴 하위 목록(paintNav)에서 전환 */ }
        else if (swNow() === 'pill' && items.length < 2) { /* 1건이면 차량 줄 없이 상세만 */ }
        else if (wide() && items.length) {
          // PC·태블릿: 건이 많지 않아 목록 열을 차량 전환 칩으로 줄인다(2.14)
          const col = el('<div class="vlp-car-chips" role="group" aria-label="차량 전환"></div>');
          items.forEach((c) => { const x = describe(c); const b = el('<button type="button" class="vlp-car-chip"></button>'); b.dataset.contractId = c.contractId; b.dataset.initial = (c.vehicleModel || '차').slice(0, 1); b.innerHTML = '<span class="vlp-chip-t"></span><span class="vlp-row-badge"></span>'; b.querySelector('.vlp-chip-t').textContent = (c.vehicleModel || '차종 미입력') + (c.serviceContractNo ? ' · ' + c.serviceContractNo.slice(-4) : ''); b.querySelector('.vlp-row-badge').innerHTML = x.badge; if (c.contractId === activeId) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); } b.addEventListener('click', () => route.set(c.contractId)); col.appendChild(b); });
          listPane.appendChild(col);
        } else items.forEach((c) => listPane.appendChild(rowFor(c, activeId)));
      } else if (tab === 'care') {
        listPane.appendChild(V.customerCare.list({ wide: wide(), items: care.items, activeId: careSel, canNew: care.cars.length > 0, onOpen: (id) => { careNew = false; setCareSel(id); paint(); g.scrollTo && g.scrollTo(0, 0); }, onNew: () => { careNew = true; setCareSel(null); paint(); g.scrollTo && g.scrollTo(0, 0); } }));
      } else if (tab === 'msgs') {
        listPane.appendChild(head('메시지'));
        const careItems = (care && care.items) || [];
        if (!items.length && !careItems.length) listPane.appendChild(el('<div class="hint">대화할 계약이 없어요.</div>'));
        careItems.forEach((it) => {
          const r = el('<button type="button" class="vlp-case-row vlp-msg-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-chat-badge" hidden></span></span><span class="hint vlp-row-sub"></span></button>');
          r.dataset.careId = it.careId;
          const ttl = (it.vehicleModel || '차종 미입력') + (it.shop ? ' · ' + it.shop.name : '');
          r.querySelector('.vlp-row-title').textContent = '🔧 ' + ttl;
          r.querySelector('.vlp-row-sub').textContent = [it.careId, '시공사'].join(' · ');
          if (it.unreadChat) { const bd = r.querySelector('.vlp-chat-badge'); bd.hidden = false; bd.textContent = String(it.unreadChat); }
          r.addEventListener('click', () => V.chat.open(it.careId, { role: 'customer', api: V.api.care.chat, other: '시공사', summary: ttl + ' · 시공사', opener: r }));
          listPane.appendChild(r);
        });
        items.forEach((c) => {
          const r = el('<button type="button" class="vlp-case-row vlp-msg-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-chat-badge" hidden></span></span><span class="hint vlp-row-sub"></span></button>');
          r.dataset.contractId = c.contractId; r.querySelector('.vlp-row-title').textContent = c.vehicleModel || '차종 미입력';
          r.querySelector('.vlp-row-sub').textContent = [c.serviceContractNo, (c.carmaster && c.carmaster.name) || '카마스터'].filter(Boolean).join(' · ');
          const n = (data.chat[c.contractId] || []).length; if (n) { const bd = r.querySelector('.vlp-chat-badge'); bd.hidden = false; bd.textContent = String(n); }
          r.addEventListener('click', () => openChat(c, r)); listPane.appendChild(r);
        });
      } else {
        listPane.appendChild(head('내 정보'));
        const me = el('<div class="vlp-cd"><h4></h4><p></p></div>'); me.querySelector('h4').textContent = ctx.name || '고객'; me.querySelector('p').textContent = ctx.phone; listPane.appendChild(me);
        listPane.appendChild(V.caseView.card('알림', V.pushLink ? V.pushLink.settingsRow() : null));
        const lo = el('<button type="button" class="btn btn-outline vlp-logout-btn">로그아웃</button>'); lo.addEventListener('click', () => ctx.logout && ctx.logout()); listPane.appendChild(lo);
      }
    }
    function railClosed() { const m = memGet('rail'); return m == null ? (data.items || []).length <= 1 : m === '1'; }
    function carsSub(activeId) {
      const items = data.items || [];
      const box = el('<div class="vlp-nav-sub" role="group" aria-label="내 차량 목록"></div>');
      const open = memGet('carsopen') == null ? items.length > 1 : memGet('carsopen') === '1';
      if (!open) box.hidden = true;
      const live = items.filter((c) => c.status !== 'REJECTED' && c.status !== 'EXPIRED'), past = items.filter((c) => c.status === 'REJECTED' || c.status === 'EXPIRED');
      const row = (c) => { const x = describe(c); const b = el('<button type="button" class="vlp-nav-car"><span class="vlp-nav-car-t"></span><span class="vlp-nav-car-s"></span></button>'); b.dataset.contractId = c.contractId; b.querySelector('.vlp-nav-car-t').textContent = (c.vehicleModel || '차종 미입력'); b.querySelector('.vlp-nav-car-s').textContent = x.idx != null ? V.caseView.progressText(x.idx) : (U.STATUS_LABEL[c.status] || ''); if (c.contractId === activeId) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); } b.addEventListener('click', () => route.set(c.contractId)); return b; };
      if (items.length > 1) live.forEach((c) => box.appendChild(row(c))); // 1건이면 '내 차량'이 바로 그 건을 연다
      if (past.length) { const det = el('<details class="vlp-nav-past"><summary></summary></details>'); det.querySelector('summary').textContent = '지난 계약 ' + past.length; past.forEach((c) => det.appendChild(row(c))); if (past.some((c) => c.contractId === activeId)) det.open = true; box.appendChild(det); }
      const nw = el('<button type="button" class="vlp-nav-new">+ 새 계약 등록</button>'); nw.addEventListener('click', () => ctx.goRegister()); box.appendChild(nw);
      return { box, open, many: items.length > 1 };
    }
    function paintNav(inCase) {
      nav.innerHTML = ''; const cur = getTab();
      navItems().forEach(([id, ico, label]) => { const b = el('<button type="button" class="vlp-nav-btn"><span aria-hidden="true"></span><b></b></button>'); b.dataset.tab = id; b.firstChild.textContent = ico; b.querySelector('b').textContent = label; if (id === cur && (!inCase || wide())) b.setAttribute('aria-current', 'page'); b.addEventListener('click', () => setTab(id)); nav.appendChild(b);
        if (id === 'cars' && swNow() === 'menu') {
          const sub = carsSub(route.get());
          if (sub.many) {
            const wrapRow = el('<div class="vlp-nav-row"></div>'); nav.replaceChild(wrapRow, b); wrapRow.appendChild(b);
            const car = el('<button type="button" class="vlp-nav-caret"></button>'); car.setAttribute('aria-label', '차량 목록 접기/펼치기'); car.textContent = sub.open ? '▾' : '▸'; car.setAttribute('aria-expanded', String(sub.open));
            car.addEventListener('click', () => { memSet('carsopen', sub.open ? '0' : '1'); paintNav(inCase); }); wrapRow.appendChild(car);
          }
          nav.appendChild(sub.box);
        }
      });
    }
    function paintCare() {
      let sel = careSel && care.items.some((x) => x.careId === careSel) ? careSel : null;
      if (!sel && !careNew && wide() && care.items.length) sel = care.items[0].careId;
      if (sel !== careSel) setCareSel(sel);
      wrap.classList.toggle('has-case', !!sel || careNew); wrap.classList.remove('rail-closed'); wrap.dataset.tab = 'care'; wrap.dataset.sw = swNow();
      paintList(null); paintNav(!!sel || careNew);
      detailPane.innerHTML = ''; curDetail = null;
      const back = () => { careNew = false; setCareSel(null); paint(); };
      if (careNew) curDetail = V.customerCare.newForm({ cars: care.cars, shops: care.shops, catalog: care.catalog, onCancel: back, onDone: (id) => { careNew = false; setCareSel(id); load(true); } });
      else if (sel) curDetail = V.customerCare.detail(care.items.find((x) => x.careId === sel), care.catalog, { onBack: back, refresh: () => load(true) });
      if (curDetail) detailPane.appendChild(curDetail); else detailPane.appendChild(el('<div class="vlp-empty-detail hint">왼쪽에서 신청 내역을 선택해 주세요.</div>'));
    }
    function paint() {
      if (!loaded) return;
      if (curDetail && curDetail.__off) curDetail.__off();
      if (getTab() === 'care' && careOn()) { paintCare(); return; }
      let id = route.get(); let c = id && data.items.find((x) => x.contractId === id);
      if (id && !c) { id = null; }
      if (c && wide() && getTab() !== 'cars') { try { sessionStorage.setItem(tabKey, 'cars'); } catch (e) { /* 무시 */ } }
      if (!c && wide() && getTab() === 'cars' && data.items.length) { c = data.items[0]; id = c.contractId; try { g.history.replaceState(null, '', g.location.pathname + g.location.search + '#case=' + encodeURIComponent(id)); } catch (e) { /* 무시 */ } }
      wrap.classList.toggle('has-case', !!c); wrap.dataset.tab = getTab(); wrap.dataset.sw = swNow(); wrap.classList.toggle('rail-closed', swNow() === 'rail' && railClosed());
      paintList(id); paintNav(!!c);
      detailPane.innerHTML = '';
      if (c) { curDetail = buildDetail(c); detailPane.appendChild(curDetail); }
      else { curDetail = null; detailPane.appendChild(el('<div class="vlp-empty-detail hint">왼쪽에서 계약을 선택해 주세요.</div>')); }
    }

    async function load(force) {
      let page;
      try { page = await V.api.contracts.list({ limit: 50 }); }
      catch (e) { if (!loaded) { listPane.innerHTML = ''; listPane.appendChild(el('<div class="vlp-error" role="alert">' + esc(U.errorText(e)) + '</div>')); } return; }
      const items = page.items || [], deliveries = {}, tracking = {}, chat = {};
      await Promise.all(items.filter((c) => c.deliveryId).map(async (c) => { try { deliveries[c.contractId] = await V.api.deliveries.get(c.deliveryId); tracking[c.contractId] = await V.delivery.fetchTracking(c.deliveryId); } catch (e) { /* 칩만 생략 */ } }));
      try { const n = await V.api.notifications.list({ limit: 50 }); (n.items || []).forEach((x) => { if (!x.read && x.refType === 'contract' && /새 메시지/.test(x.text || '')) (chat[x.refId] = chat[x.refId] || []).push(x.notificationId); }); } catch (e) { /* 배지는 없어도 된다 */ }
      const mem = U.mem.get(uiKey(ctx));
      if (careOn()) {
        try {
          const l = await V.api.care.list(); care.items = l.items || [];
          if (!care.catalog) { care.catalog = await V.api.care.catalog(); care.shops = await V.api.care.shops(); }
          care.cars = await V.api.care.cars();
        } catch (e) { /* 케어를 못 읽어도 인도 화면은 계속 */ }
      }
      const sig = JSON.stringify([items, deliveries, tracking, mem, chat, getTab(), route.get(), care.items, care.cars, careSel, careNew]);
      if (!force && sig === lastSig) return;
      if (!force && loaded && wrap.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      lastSig = sig; data = { items, deliveries, tracking, mem, chat };
      const first = !loaded; loaded = true;
      const deepId = V.pushLink && V.pushLink.applyDeep(items, {});
      if (deepId) { try { g.history.replaceState(null, '', g.location.pathname + g.location.search + '#case=' + encodeURIComponent(deepId)); } catch (e) { /* 무시 */ } }
      paint();
      if (first || deepId) { /* 최초/딥링크 진입은 맨 위에서 시작 */ }
    }
    g.addEventListener('vlp-route', () => { if (!document.body.contains(wrap)) return; lastSig = null; paint(); g.scrollTo && g.scrollTo(0, 0); });
    load(true);
    const timer = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(timer); return; } load(false); }, V.config.get('pollIntervalMs'));
    wrap.__reload = () => load(true);
    return wrap;
  };
})(typeof window !== 'undefined' ? window : globalThis);
