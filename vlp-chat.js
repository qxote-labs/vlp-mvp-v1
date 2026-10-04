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
  let dock = null, state = null, timer = null;

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

  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    if (dock) { dock.remove(); dock = null; }
    document.body.classList.remove('vlp-chat-open');
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
      dock.style.top = t + 'px'; dock.style.height = (b - t) + 'px'; dock.style.width = cw + 'px'; dock.style.left = (cwid - cw - gap) + 'px';
      return;
    }
    if (!app || !app.parentElement) return;
    const body = app.parentElement.getBoundingClientRect();
    const top = Math.max(rbBottom, Math.round(body.top)), left = Math.round(body.left), width = Math.min(Math.round(body.width), vw - left);
    const frame = app.closest('.frame'), fb = frame ? Math.round(frame.getBoundingClientRect().bottom) - 1 : Math.round(body.bottom); // 흰 틀 아래 끝까지(입력줄이 화면 아래에 닿도록)
    const bottom = vw < 600 ? vh : Math.min(Math.max(fb, Math.round(body.bottom), top + 420), vh);
    if (bottom - top < 240 || width < 280) return;
    dock.classList.add('inbody');
    dock.style.top = top + 'px'; dock.style.left = left + 'px'; dock.style.width = width + 'px'; dock.style.height = (bottom - top) + 'px';
  }
  window.addEventListener('resize', placeDock);
  window.addEventListener('scroll', () => { if (dock && window.innerWidth >= 1280) placeDock(); }, { passive: true });

  /** opts: {role, other('카마스터' 등 상대 표기), summary:'아이오닉 6 · SS-... · 김카마', readOnly, opener, onClose, api:{messages, send}(선택)} */
  function open(contractId, opts) {
    opts = opts || {};
    if (state && state.contractId === contractId) { if (dock) dock.querySelector('textarea, .vlp-chat-close').focus(); return dock; }
    if (dock) close();
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
    bodyEl.addEventListener('scroll', () => { state.atBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40; if (state.atBottom) dock.querySelector('.vlp-chat-newmsg').hidden = true; });
    dock.querySelector('.vlp-chat-newmsg').addEventListener('click', () => { bodyEl.scrollTop = bodyEl.scrollHeight; });
    buildFoot();
    document.body.appendChild(dock); document.body.classList.add('vlp-chat-open'); placeDock();
    refresh(true); timer = setInterval(() => { if (!dock) return; refresh(false); }, V.config.get('pollIntervalMs'));
    dock.querySelector('textarea') ? dock.querySelector('textarea').focus() : dock.querySelector('.vlp-chat-close').focus();
    return dock;
  }

  function buildFoot() {
    const foot = dock.querySelector('.vlp-chat-foot');
    if (state.opts.readOnly) { foot.innerHTML = '<div class="hint vlp-chat-ro">관리자는 대화를 읽기만 할 수 있어요.</div>'; return; }
    foot.innerHTML = '<div class="vlp-chat-input"><textarea rows="1" maxlength="' + MAX + '" placeholder="' + otherOf(state.opts) + '에게 메시지 보내기" aria-label="메시지 입력"></textarea><button type="button" class="btn btn-primary btn-sm vlp-chat-send" disabled>보내기</button></div><div class="hint vlp-chat-count" aria-hidden="true"></div>';
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
      const sig = JSON.stringify(r.items.map((m) => [m.messageId, m.masked])); const added = r.items.length - st.all.length;
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
    if (!total && !st.pending.length) body.appendChild(el('<div class="hint vlp-chat-empty">아직 대화가 없어요. 먼저 인사를 건네 보세요.</div>'));
    if (st.masked) {
      const box = el('<div class="vlp-chat-masked" role="status"><b>대화 내용이 가려져 있어요.</b><div class="hint">열람 사유를 남기면 볼 수 있고, 열람 기록이 남습니다.</div><button type="button" class="btn btn-sm btn-primary vlp-chat-reason">사유 남기고 보기</button></div>');
      box.querySelector('button').addEventListener('click', () => askReason()); body.appendChild(box);
    }
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
    if (stick) body.scrollTop = body.scrollHeight; else body.scrollTop = prevTop + (body.scrollHeight - prevH);
    const mr = apiOf(st.opts).markRead; if (mr && !st.opts.readOnly && st.all.length) mr(st.contractId).catch(() => null); // 열려 있는 동안 읽음 처리(케어 대화)
    function paintKeep() { const h = body.scrollHeight, t = body.scrollTop; paint(false); body.scrollTop = t + (body.scrollHeight - h); }
  }

  function askReason() {
    const st = state; if (!st) return;
    const codes = V.config.get('sensitiveViewReasonCodes'), labels = V.config.get('sensitiveViewReasonLabels') || {};
    const f = el('<form class="vlp-reason" novalidate><p>대화 전문은 사유를 남긴 뒤에만 볼 수 있어요. 열람 기록(누가·언제·사유)이 저장됩니다.</p><label for="vlp-reason-sel">열람 사유</label><select id="vlp-reason-sel"><option value="">선택하세요</option></select><div class="vlp-error" role="alert" hidden></div><button type="submit" class="btn btn-primary btn-sm vlp-reason-go" disabled>열람 기록 남기고 보기</button></form>');
    const sel = f.querySelector('select'); codes.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = labels[c] || c; sel.appendChild(o); });
    sel.addEventListener('change', () => { f.querySelector('.vlp-reason-go').disabled = !sel.value; });
    let closeSheet;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const go = f.querySelector('.vlp-reason-go'), err = f.querySelector('.vlp-error'); go.disabled = true; err.hidden = true;
      try { const ap = apiOf(st.opts); if (ap.recordView) await ap.recordView(st.contractId, sel.value); else await V.api.admin.recordSensitiveView({ viewType: 'CHAT_FULL', contractId: st.contractId, reasonCode: sel.value }); if (closeSheet) closeSheet(); await refresh(true); }
      catch (e) { err.textContent = U.errorText(e); err.hidden = false; go.disabled = false; }
    });
    closeSheet = V.delivery.openSheet('열람 사유', f, dock.querySelector('.vlp-chat-reason'));
    sel.focus();
  }

  V.chat = { open, close, isOpen: () => !!dock, isOpenFor: (id) => !!(dock && state && state.contractId === id), loadAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.chat;
})(typeof window !== 'undefined' ? window : globalThis);
