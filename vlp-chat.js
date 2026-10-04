/* vlp-chat.js — PWA-23 대화 스레드 + PC 우측 대화 전용 패널.
 *  · 헤더는 한 줄 요약(차량 · 계약번호 · 상대), 본문은 오래된 것 위 → 최신 하단, 입력은 하단 고정.
 *  · 폰·태블릿(1280 미만)은 전체 화면 시트, PC(1280~)는 우측 고정 열(본문은 그대로 쓸 수 있다).
 *  · 관리자는 읽기 전용이고, 열람 사유를 남기기 전에는 본문이 가려진다(BR-12; 서버가 가려서 준다).
 *  · 보내기에 실패하면 같은 Idempotency-Key로 다시 보낸다(중복 방지). 서버 호출은 VLP.api(facade)만. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  const ROLE = { customer: '고객', karmaster: '카마스터', shop: '시공사', admin: '관리자' };
  const MAX = 2000;
  let dock = null, state = null, timer = null, ro = null;

  const apiOf = (opts) => (opts && opts.api) || V.api.engagement; // 신차케어처럼 다른 경계를 쓰는 건은 opts.api({messages, send})를 넘긴다
  async function loadAll(contractId, api) { // 서버는 오래된 것부터 앞으로 이어 읽는다
    let cursor, out = [], masked = false;
    for (let i = 0; i < 20; i++) { // 최대 2000개까지
      const p = await (api || V.api.engagement).messages(contractId, { limit: 100, cursor });
      out = out.concat(p.items || []); if (p.items && p.items.some((m) => m.masked)) masked = true;
      if (!p.nextCursor) break; cursor = p.nextCursor;
    }
    return { items: out, masked };
  }
  const timeText = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : U.fmtDateTime(iso); };

  function close(keepLayout) { // keepLayout: 다른 건으로 바로 바꿀 때 — 본문 틀 폭이 줄었다 늘었다 하지 않게 여백 표시(vlp-chat-open)를 유지한다
    if (timer) { clearInterval(timer); timer = null; }
    if (dock) { dock.remove(); dock = null; } unwatchLayout();
    if (keepLayout !== true) document.body.classList.remove('vlp-chat-open');
    const cb = state && state.opts && state.opts.onClose; const op = state && state.opener; state = null;
    if (cb) cb(); if (op && op.focus && document.body.contains(op)) op.focus();
  }

  // 대화 상대 표기: 호출부가 other를 주지 않으면 역할로 추정한다 (고객은 케어 api면 시공사, 아니면 카마스터)
  function otherOf(o) { return o.other || ({ customer: o.api ? '시공사' : '카마스터', karmaster: '고객', shop: '고객', admin: '고객' })[o.role] || '상대'; }
  function jong(w) { const c = String(w).charCodeAt(String(w).length - 1) - 0xAC00; return c >= 0 && c % 28 !== 0; }
  // 1280 미만: 위쪽 제목줄(역할 줄)과 바깥 틀은 그대로 두고, 본문 영역 전체(메뉴 줄 포함)를 대화로 쓴다.
  // 본문 영역을 못 찾는 화면(관리자 등)은 역할 줄 아래 전체를 쓴다.
  function placeDock() {
    if (!dock) return;
    const wide = window.innerWidth >= 1280, vw = window.innerWidth, vh = window.innerHeight;
    const rb = document.getElementById('vlp-rolebar'), app = document.querySelector('.vlp-app');
    dock.classList.remove('inbody'); ['top', 'left', 'width', 'height'].forEach((k) => dock.style.removeProperty(k));
    const rbBottom = rb ? Math.max(0, Math.round(rb.getBoundingClientRect().bottom)) : 0;
    dock.style.setProperty('--chat-top', (wide ? 0 : rbBottom) + 'px');
    if (wide) { // 1280 이상: 오른쪽 대화창을 본문 틀(위·아래) 높이에 맞추고, 틀의 왼쪽 여백과 같은 오른쪽 여백을 둔다 (스크롤 막대 폭은 제외)
      const fr = (app && app.closest('.frame')) || document.querySelector('.frame'), r = fr ? fr.getBoundingClientRect() : null;
      const cwid = document.documentElement.clientWidth || vw, gap = 26;
      const t = Math.max(Math.round(r ? r.top : rbBottom), 0), b = r ? Math.min(Math.round(r.bottom), vh - gap) : vh, cw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w'), 10) || 360;
      if (b - t < 320) return;
      dock.classList.add('inbody', 'wide');
      dock.style.top = t + 'px'; dock.style.height = (b - t) + 'px'; dock.style.width = cw + 'px'; dock.style.left = (r ? Math.min(cwid - cw - gap, Math.round(r.right) + 16) : cwid - cw - gap) + 'px'; // 본문 틀이 상한에 걸려 좁으면 대화창을 오른쪽 끝에 두지 않고 틀 바로 옆(간격 16)에 붙인다 — 본문+대화창 묶음이 가운데 오게(본문 틀의 가운데 정렬 위치는 body 오른쪽 여백이 이미 같은 값)
      return;
    }
    if (!app || !app.parentElement) return;
    const body = (app.closest('.vlp-adm') || app.parentElement).getBoundingClientRect(); // 관리자는 메뉴 줄(.vlp-adm-nav)까지 덮는다(카마스터·고객과 동일)
    const top = Math.max(rbBottom, Math.floor(body.top)), left = Math.max(0, Math.floor(body.left) - 1), width = Math.min(Math.ceil(body.right) + 1 - left, vw - left); // 배율이 소수(125%·175% 등)일 때 아래 화면의 가장자리 선이 비치지 않도록 1px 겹친다
    const frame = app.closest('.frame'), fb = frame ? Math.round(frame.getBoundingClientRect().bottom) - 1 : Math.round(body.bottom); // 흰 틀 아래 끝까지(입력줄이 화면 아래에 닿도록)
    const bottom = vw < 600 ? vh : Math.min(Math.max(fb, Math.round(body.bottom), top + 420), vh);
    if (bottom - top < 240 || width < 280) return;
    dock.classList.add('inbody');
    dock.style.top = top + 'px'; dock.style.left = left + 'px'; dock.style.width = width + 'px'; dock.style.height = (bottom - top) + 'px';
  }
  window.addEventListener('resize', placeDock);
  // 스크롤 막대가 생기거나 화면 배치가 바뀌면(창 크기 변화 없이도) 본문 틀 위치가 달라지므로 대화창을 다시 맞춘다
  const watchLayout = () => { if (ro || typeof ResizeObserver === 'undefined') return; ro = new ResizeObserver(() => { if (dock) placeDock(); }); [document.documentElement, document.body, (document.querySelector('.vlp-adm') || (document.querySelector('.vlp-app') || {}).parentElement)].forEach((n) => { if (n) ro.observe(n); }); };
  const unwatchLayout = () => { if (ro) { ro.disconnect(); ro = null; } };
  window.addEventListener('scroll', () => { if (dock && window.innerWidth >= 1280) placeDock(); }, { passive: true });

  /** opts: {role, other('카마스터' 등 상대 표기), summary:'아이오닉 6 · SS-... · 김카마', readOnly, opener, onClose, api:{messages, send}(선택)} */
  function open(contractId, opts) {
    opts = opts || {};
    if (state && state.contractId === contractId) { if (dock) dock.querySelector('textarea, .vlp-chat-close').focus(); return dock; }
    if (dock) close(true);
    state = { contractId, opts, opener: opts.opener || null, all: [], shown: V.config.get('chatPageSize') || 30, pending: [], lastSig: '', atBottom: true };
    dock = el(`<aside class="vlp-chatdock" role="dialog" aria-label="대화" aria-modal="false">
      <div class="vlp-chat">
        <div class="vlp-chat-head"><span class="vlp-chat-sum"><b class="vlp-chat-to"></b><small class="vlp-chat-ctx"></small></span><button type="button" class="btn btn-sm vlp-chat-close" aria-label="대화 닫기">닫기</button></div>
        <div class="vlp-chat-body" role="log" aria-live="polite" tabindex="0"></div>
        <button type="button" class="btn btn-sm vlp-chat-newmsg" hidden>새 메시지 ↓</button>
        <div class="vlp-chat-foot"></div>
      </div></aside>`);
    const other = otherOf(opts);
    dock.querySelector('.vlp-chat-to').textContent = opts.readOnly ? '대화 열람 (읽기 전용)' : other + (jong(other) ? '과' : '와') + ' 대화';
    dock.querySelector('.vlp-chat-ctx').textContent = String(opts.summary || '').replace(/ · (시공사|카마스터|고객|읽기 전용)$/, '');
    dock.setAttribute('aria-label', opts.readOnly ? '대화 열람' : other + '와의 대화');
    try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
    placeDock();
    dock.querySelector('.vlp-chat-close').addEventListener('click', close);
    dock.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const bodyEl = dock.querySelector('.vlp-chat-body');
    bodyEl.insertAdjacentHTML('beforebegin', '<div class="vlp-chat-consent" hidden></div>');
    bodyEl.addEventListener('scroll', () => { state.atBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40; if (state.atBottom) dock.querySelector('.vlp-chat-newmsg').hidden = true; });
    dock.querySelector('.vlp-chat-newmsg').addEventListener('click', () => { bodyEl.scrollTop = bodyEl.scrollHeight; });
    buildFoot();
    document.body.appendChild(dock); document.body.classList.add('vlp-chat-open'); placeDock(); watchLayout();
    refresh(true); timer = setInterval(() => { if (!dock) return; refresh(false); }, V.config.get('pollIntervalMs'));
    dock.querySelector('textarea') ? dock.querySelector('textarea').focus() : dock.querySelector('.vlp-chat-close').focus();
    return dock;
  }

  function buildFoot() {
    const foot = dock.querySelector('.vlp-chat-foot');
    if (state.opts.readOnly) { foot.innerHTML = '<div class="hint vlp-chat-ro">관리자는 대화를 읽기만 할 수 있어요.</div>'; return; }
    foot.innerHTML = '<div class="vlp-chat-input"><textarea rows="1" maxlength="' + MAX + '" placeholder="' + otherOf(state.opts) + '에게 메시지 보내기" aria-label="메시지 입력"></textarea><button type="button" class="btn btn-primary btn-sm vlp-chat-send" disabled>보내기</button></div><div class="hint vlp-chat-count" aria-hidden="true"></div>';
    foot.insertAdjacentHTML('afterbegin', '<div class="hint vlp-chat-notice">분쟁·민원 처리가 필요하면 운영자가 열람할 수 있어요 (열람 기록이 남습니다)</div>'); // 정보보호 고지
    const ta = foot.querySelector('textarea'), send = foot.querySelector('.vlp-chat-send'), cnt = foot.querySelector('.vlp-chat-count');
    const sync = () => { send.disabled = !ta.value.trim(); cnt.textContent = ta.value.length > MAX - 200 ? ta.value.length + '/' + MAX : ''; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!send.disabled) send.click(); } });
    send.addEventListener('click', () => { const text = ta.value.trim(); if (!text) return; ta.value = ''; sync(); sendText(text, V.api.newIdempotencyKey()); ta.focus(); });
  }

  async function sendText(text, key, existing) {
    const st = state; if (!st) return;
    const item = existing || { text, key, status: 'sending' }; item.status = 'sending'; if (!existing) st.pending.push(item); paint(true);
    try { await apiOf(st.opts).send(st.contractId, { body: text }, { idempotencyKey: key }); st.pending = st.pending.filter((x) => x !== item); await refresh(true); st.atBottom = true; paint(true); }
    catch (e) { item.status = 'failed'; item.error = (e && e.network) ? '연결이 끊겨 보내지 못했어요' : U.errorText(e); paint(true); }
  }

  async function refresh(force) {
    const st = state; if (!st) return;
    try {
      const r = await loadAll(st.contractId, apiOf(st.opts));
      if (state !== st) return;
      const sig = JSON.stringify([r.items.map((m) => [m.messageId, m.masked]), consentSig()]); const added = r.items.length - st.all.length;
      st.masked = r.masked;
      if (sig === st.lastSig && !force) return;
      st.lastSig = sig; st.all = r.items; paint(st.atBottom || force);
      if (added > 0 && !st.atBottom && dock) dock.querySelector('.vlp-chat-newmsg').hidden = false;
    } catch (e) { if (e.status === 401 && st.opts.onAuthLost) st.opts.onAuthLost(); }
  }

  function paint(stick) {
    if (!dock || !state) return;
    const st = state, body = dock.querySelector('.vlp-chat-body'), prevH = body.scrollHeight, prevTop = body.scrollTop;
    body.innerHTML = '';
    const total = st.all.length, from = Math.max(0, total - st.shown);
    if (from > 0) { const more = el('<button type="button" class="btn btn-sm vlp-chat-older">이전 대화 보기 (' + from + ')</button>'); more.addEventListener('click', () => { st.shown += V.config.get('chatPageSize') || 30; st.atBottom = false; paintKeep(); }); body.appendChild(more); }
    if (!total && !st.pending.length) body.appendChild(el('<div class="hint vlp-chat-empty">' + (st.opts.readOnly ? '아직 오간 대화가 없어요. 열람할 내용이 없습니다.' : '아직 대화가 없어요. 먼저 인사를 건네 보세요.') + '</div>'));
    if (st.masked) body.appendChild(maskedBox());
    st.all.slice(from).forEach((m) => {
      const mine = m.senderRole === st.opts.role && st.opts.role !== 'admin';
      const b = el('<div class="msg-bubble"><div class="vlp-msg-who"></div><div class="vlp-msg-text"></div><div class="hint vlp-msg-time"></div></div>');
      b.classList.add(mine ? 'mine' : 'theirs'); b.dataset.sender = m.senderRole;
      b.querySelector('.vlp-msg-who').textContent = mine ? '나' : (ROLE[m.senderRole] || m.senderRole);
      b.querySelector('.vlp-msg-text').textContent = m.masked ? '(가려진 메시지)' : m.body; b.querySelector('.vlp-msg-time').textContent = timeText(m.createdAt);
      body.appendChild(b);
    });
    st.pending.forEach((p) => {
      const b = el('<div class="msg-bubble mine pending"><div class="vlp-msg-who">나</div><div class="vlp-msg-text"></div><div class="hint vlp-msg-time"></div></div>');
      b.querySelector('.vlp-msg-text').textContent = p.text; b.dataset.status = p.status;
      const t = b.querySelector('.vlp-msg-time'); t.textContent = p.status === 'sending' ? '보내는 중…' : p.error || '보내지 못했어요';
      if (p.status === 'failed') { const rb = el('<button type="button" class="btn btn-sm vlp-msg-retry">다시 보내기</button>'); rb.addEventListener('click', () => sendText(p.text, p.key, p)); const db = el('<button type="button" class="btn btn-sm vlp-msg-drop">삭제</button>'); db.addEventListener('click', () => { st.pending = st.pending.filter((x) => x !== p); paint(false); }); b.appendChild(rb); b.appendChild(db); }
      body.appendChild(b);
    });
    paintConsent();
    if (stick) body.scrollTop = body.scrollHeight; else body.scrollTop = prevTop + (body.scrollHeight - prevH);
    const mr = apiOf(st.opts).markRead; if (mr && !st.opts.readOnly && st.all.length) mr(st.contractId).catch(() => null); // 열려 있는 동안 읽음 처리(케어 대화)
    function paintKeep() { const h = body.scrollHeight, t = body.scrollTop; paint(false); body.scrollTop = t + (body.scrollHeight - h); }
  }

  // ---- 열람 동의 알림 (당사자 쪽) ----
  const pendingFor = (chatId, role) => { const s = typeof Store !== 'undefined' ? Store : null; if (!s || !s.latestChatConsent || !chatId) return null; const c = s.latestChatConsent(chatId); const pt = role === 'customer' ? 'customer' : 'other'; return c && c.state === 'pending' && c.responses[pt] === null ? c : null; };
  const halfWay = (c) => { const exp = (V.config.get('chatConsentExpireHours') || 24) * 3600000; return Date.now() - c.createdAt > exp / 2; };
  /** 알림 패널에 끼워 넣을 항목: 운영자가 이 사람(role)에게 동의를 요청해 아직 응답하지 않은 대화들. items:[{id,label}] */
  function consentNotes(items, role, open) {
    const out = [];
    (items || []).forEach((it) => { const c = pendingFor(it.id, role); if (c) out.push({ id: c.id, text: '운영자가 대화 열람 동의를 요청했어요' + (it.label ? ' · ' + it.label : '') + (halfWay(c) ? ' · 응답 기한이 곧 끝나요' : ''), createdAt: new Date(c.createdAt).toISOString(), half: halfWay(c), open: () => open && open(it.id) }); });
    return out;
  }
  // 건 화면의 채팅 버튼·목록 행에 "동의 요청 있음" 점을 붙인다(2초마다, 그리고 다른 창이 바꿨을 때)
  function paintDots() {
    document.querySelectorAll('.vlp-case[data-role] .vlp-case-chat').forEach((b) => { const r = b.closest('.vlp-case'); if (r.dataset.role === 'admin') return; const on = !!pendingFor(r.dataset.contractId, r.dataset.role); b.classList.toggle('has-consent', on); if (on) b.title = '운영자의 대화 열람 동의 요청이 있어요'; });
    const app = document.querySelector('.vlp-app'); if (!app) return;
    const role = app.classList.contains('vlp-app-customer') ? 'customer' : app.classList.contains('vlp-app-karmaster') ? 'karmaster' : app.classList.contains('vlp-app-shop') ? 'shop' : null; if (!role) return;
    document.querySelectorAll('.vlp-case-row').forEach((r) => { const id = r.dataset.contractId || r.dataset.careId; if (!id) return; const on = !!pendingFor(id, role); r.classList.toggle('has-consent', on); });
  }
  if (typeof window !== 'undefined') { setInterval(() => { if (!document.hidden) paintDots(); }, 2000); window.addEventListener('storage', paintDots); }

  // ---- 열람 동의 (관리자 요청 → 고객·상대 양쪽 승인) ----
  const S = () => (typeof Store !== 'undefined' ? Store : null);
  const partyOf = (o) => (o.role === 'customer' ? 'customer' : 'other');
  const partnerLabel = (o) => (o.api ? '시공사' : '카마스터');
  const isSuper = () => { try { return typeof loggedInAdminId !== 'undefined' && !!loggedInAdminId && S().getAdmin(loggedInAdminId).adminScope === 'super'; } catch (e) { return false; } };
  const latestConsent = () => (state && S() ? S().latestChatConsent(state.contractId) : null);
  const remainMin = (c) => (c && c.state === 'granted' ? Math.max(0, Math.ceil((c.approvedAt + winMin() * 60000 - Date.now()) / 60000)) : 0);
  const consentSig = () => { const c = latestConsent(); return c ? [c.id, c.state, c.responses.customer, c.responses.other, remainMin(c)] : null; };
  const reasonText = (c) => { const lb = V.config.get('sensitiveViewReasonLabels') || {}, ex = V.config.get('chatExceptionReasonLabels') || {}; return (lb[c.reasonCode] || ex[c.reasonCode] || c.reasonCode) + (c.note ? ' — ' + c.note : ''); };
  const winMin = () => V.config.get('sensitiveViewWindowMinutes') || 30;

  // 관리자: 가려진 대화 자리에 지금 동의 상태와 다음 행동을 보여 준다
  function maskedBox() {
    const st = state, partner = partnerLabel(st.opts), c = latestConsent();
    const box = el('<div class="vlp-chat-masked" role="status"><b>대화 내용이 가려져 있어요.</b><div class="hint vlp-chat-msg"></div><div class="vlp-chat-acts"></div></div>');
    const msg = box.querySelector('.vlp-chat-msg'), acts = box.querySelector('.vlp-chat-acts');
    const btn = (label, cls, fn) => { const b = el('<button type="button" class="btn btn-sm"></button>'); b.textContent = label; b.className += ' ' + cls; b.addEventListener('click', fn); acts.appendChild(b); return b; };
    if (c && c.state === 'pending') {
      const mark = (v) => (v === true ? '✓ 동의' : v === false ? '✗ 거부' : '대기 중');
      msg.textContent = '동의를 기다리는 중이에요 · 고객 ' + mark(c.responses.customer) + ' / ' + partner + ' ' + mark(c.responses.other) + ' (요청 사유: ' + reasonText(c) + ')';
    } else if (c && c.state === 'granted') {
      msg.textContent = '두 분 모두 동의했어요. 열람하면 ' + winMin() + '분 동안 볼 수 있고, 열람 기록이 남습니다.';
      btn('열람하기', 'btn-primary vlp-chat-view', () => doRecord(c.reasonCode, c.note));
    } else {
      msg.textContent = c && c.state === 'denied' ? ((c.deniedBy === 'customer' ? '고객' : partner) + '이(가) 열람을 거부했어요. 거부한 대화는 볼 수 없어요.') : c && c.state === 'expired' ? '동의 요청에 응답이 없어 기한이 지났어요.' : '당사자(고객·' + partner + ') 두 분이 동의해야 볼 수 있어요. 열람 기록이 남습니다.';
      btn('열람 동의 요청', 'btn-primary vlp-chat-reason', () => askReason());
    }
    if (isSuper() && !(c && c.state === 'granted')) btn('예외 사유로 열람', 'vlp-chat-exc', () => askException());
    return box;
  }
  async function doRecord(code, note, closeSheet) {
    const st = state; if (!st) return;
    const ap = apiOf(st.opts);
    if (ap.recordView) await ap.recordView(st.contractId, code, note); else await V.api.admin.recordSensitiveView(Object.assign({ viewType: 'CHAT_FULL', contractId: st.contractId, reasonCode: code }, note ? { note } : {}));
    if (closeSheet) closeSheet(); await refresh(true);
  }
  // 고객·상대: 운영자가 동의를 요청했을 때 대화창 위에 승인/거부 안내를 띄운다
  function paintConsent() {
    const host = dock && dock.querySelector('.vlp-chat-consent'); if (!host || !state) return;
    const st = state, c = latestConsent(), pt = partyOf(st.opts);
    if (st.opts.readOnly) { // 관리자: 열람 중이면 남은 시간과 기록 안내를 보여 준다
      if (!st.masked && st.all.length && c && c.state === 'granted') { host.hidden = false; host.dataset.cid = ''; host.classList.add('viewing'); host.innerHTML = ''; const m = el('<div class="hint vlp-cc-r"></div>'); m.textContent = (c.exception ? '예외 사유로 열람 중' : '당사자 동의로 열람 중') + ' · 남은 시간 약 ' + remainMin(c) + '분 · 열람 기록이 남았어요'; host.appendChild(m); }
      else { host.hidden = true; host.classList.remove('viewing'); host.innerHTML = ''; }
      return;
    }
    host.classList.remove('viewing');
    if (!c || c.state !== 'pending' || c.responses[pt] !== null) { host.hidden = true; host.innerHTML = ''; return; }
    if (host.dataset.cid === c.id && !host.hidden) return;
    host.dataset.cid = c.id; host.hidden = false; host.innerHTML = '';
    host.appendChild(el('<div class="vlp-cc-t"><b>운영자가 이 대화의 열람 동의를 요청했어요</b></div>'));
    const p = el('<div class="hint vlp-cc-r"></div>'); p.textContent = '사유: ' + reasonText(c) + ' · 고객과 상대 두 분 모두 동의하면 ' + winMin() + '분 동안 열람해요. 거부하면 열람되지 않아요.'; host.appendChild(p);
    const row = el('<div class="vlp-cc-b"></div>');
    [['동의', 'btn-primary vlp-cc-yes', true], ['거부', 'vlp-cc-no', false]].forEach(([l, cls, v]) => { const b = el('<button type="button" class="btn btn-sm"></button>'); b.textContent = l; b.className += ' ' + cls; b.addEventListener('click', () => { S().respondChatConsent(c.id, pt, v); host.dataset.cid = ''; paintConsent(); }); row.appendChild(b); });
    host.appendChild(row);
  }
  function reasonSheet({ title, intro, codes, labels, goLabel, noteRequired, onSubmit }) {
    const f = el('<form class="vlp-reason" novalidate><p></p><label for="vlp-reason-sel">사유</label><select id="vlp-reason-sel"><option value="">선택하세요</option></select><label for="vlp-reason-note">상세 사유 <span class="hint" id="vlp-reason-need"></span></label><textarea id="vlp-reason-note" rows="3" maxlength="200" placeholder="예: 고객 민원 접수 번호, 확인하려는 내용"></textarea><div class="hint vlp-reason-cnt">0/200</div><div class="vlp-error" role="alert" hidden></div><button type="submit" class="btn btn-primary btn-sm vlp-reason-go" disabled></button></form>');
    f.querySelector('p').textContent = intro; f.querySelector('.vlp-reason-go').textContent = goLabel;
    const sel = f.querySelector('select'), note = f.querySelector('#vlp-reason-note'), need = f.querySelector('#vlp-reason-need'), cnt = f.querySelector('.vlp-reason-cnt'), go = f.querySelector('.vlp-reason-go');
    codes.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = labels[c] || c; sel.appendChild(o); });
    const sync = () => { const must = noteRequired || sel.value === 'OTHER'; need.textContent = must ? '(필수)' : '(선택)'; cnt.textContent = note.value.length + '/200'; go.disabled = !sel.value || (must && !note.value.trim()); };
    sel.addEventListener('change', () => { sync(); if (sel.value === 'OTHER') note.focus(); }); note.addEventListener('input', sync); sync();
    let closeSheet;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const err = f.querySelector('.vlp-error'); go.disabled = true; err.hidden = true;
      try { await onSubmit(sel.value, note.value.trim(), () => closeSheet && closeSheet()); } catch (e) { err.textContent = U.errorText(e); err.hidden = false; go.disabled = false; }
    });
    closeSheet = V.delivery.openSheet(title, f, dock.querySelector('.vlp-chat-reason, .vlp-chat-exc'));
    sel.focus();
  }
  function askReason() {
    const st = state; if (!st) return;
    reasonSheet({ title: '열람 동의 요청', intro: '고객과 ' + partnerLabel(st.opts) + '에게 대화 열람 동의를 요청해요. 두 분 모두 동의하면 ' + winMin() + '분 동안 볼 수 있고, 요청과 열람 기록(누가·언제·사유)이 저장돼요.',
      codes: V.config.get('sensitiveViewReasonCodes'), labels: V.config.get('sensitiveViewReasonLabels') || {}, goLabel: '동의 요청 보내기',
      onSubmit: async (code, note, close) => { S().requestChatConsent(st.contractId, g.loggedInAdminName || '관리자', code, note); close(); paint(false); } });
  }
  function askException() {
    const st = state; if (!st) return;
    reasonSheet({ title: '예외 사유로 열람', intro: '당사자 동의 없이 열람하는 예외예요(슈퍼바이저 전용). 법적 요청이나 긴급 안전 확인에만 쓰고, 예외 열람으로 따로 기록돼요.',
      codes: V.config.get('chatExceptionReasonCodes') || [], labels: V.config.get('chatExceptionReasonLabels') || {}, goLabel: '예외 열람 기록 남기고 보기', noteRequired: true,
      onSubmit: async (code, note, close) => { S().exceptionChatView(st.contractId, g.loggedInAdminName || '슈퍼바이저', code, note); await doRecord(code, note, close); } });
  }

  V.chat = { consentNotes, consentPending: pendingFor, paintDots, open, close: (k) => close(k), isOpen: () => !!dock, isOpenFor: (id) => !!(dock && state && state.contractId === id), loadAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.chat;
})(typeof window !== 'undefined' ? window : globalThis);
