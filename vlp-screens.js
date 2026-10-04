/* vlp-screens.js — 새 계약 모델(facade 기반) 화면이 함께 쓰는 공용 부품 (S1: PWA-06~11).
 *  - 세션(신원) 만들기, 목 어댑터 카마스터 명부 동기화, 오류 문구, 라벨, 계약 상세 펼침 카드, 토스트.
 *  - 화면은 서버(어댑터)가 준 값만 그린다. 승인 전 마스킹은 서버 몫이고 여기서 숨기지 않는다(9장).
 *  - 조회번호(claimToken)는 이 파일 어디에도 저장·기록하지 않는다. 호출한 화면의 메모리에만 머문다.
 */
(function (g) {
  'use strict';
  const V = g.VLP = g.VLP || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const cfg = (k) => V.config.get(k);

  const STATUS_LABEL = { PENDING_APPROVAL: '승인 대기', APPROVED: '승인됨', REJECTED: '거절됨', EXPIRED: '만료됨', CANCELLED: '취소됨' };
  const STATUS_BADGE = { PENDING_APPROVAL: 'wait', APPROVED: 'done', REJECTED: 'warn', EXPIRED: 'warn', CANCELLED: 'warn' };
  const DEST_LABEL = { DEALERSHIP: '대리점(영업소) 인도', AFFILIATED_SHOP: '제휴 시공사 경유', CUSTOM_ADDRESS: '고객 지정 장소' };
  // 인도의 "인수 방식"(ReceiptMode). 신차케어의 "수령 방식"과 별개이므로 라벨도 섞지 않는다.
  const RECEIPT_LABEL = { ON_SITE: '현장 인수', REMOTE_PROXY: '원격 승인 · 시공사 대리 인수' };

  function formatPhone(raw) {
    const d = digits(raw).slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
    return d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
  }
  const isPhone = (s) => /^010\d{7,8}$/.test(digits(s));

  function fmtDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso); if (isNaN(d)) return '-';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function now() { const a = V.api && V.api.adapter && V.api.adapter(); try { if (a && a.admin && a.admin.now) return a.admin.now(); } catch (e) { /* 무시 */ } return Date.now(); }
  function remaining(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - now();
    if (isNaN(ms)) return '';
    if (ms <= 0) return '만료됨';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? h + '시간 ' + m + '분 남음' : m + '분 남음';
  }

  /** 오류 -> 사용자 문구. 404는 "없음/권한 없음"을 구분하지 않는다(9장). */
  function errorText(e) {
    if (!(e instanceof V.ApiError)) return '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (e.status === 401) return '로그인이 필요합니다.';
    if (e.status === 404) return '대상을 찾을 수 없습니다.';
    if (e.status === 429) return '시도 횟수를 초과해 잠시 잠겼습니다. 약 ' + cfg('claimLockMinutes') + '분 뒤 다시 시도해 주세요.';
    if (e.status === 422 && e.details && e.details.missing) return '필수 항목을 확인해 주세요: ' + e.details.missing.join(', ');
    return e.message || '처리하지 못했습니다.';
  }

  // ---------- 세션 ----------
  let synced = false;
  function autoSync() { if (!synced && g.Store && g.Store.getKarmasters) { synced = true; syncMockRegistry(g.Store.getKarmasters()); } }
  function setCustomerSession(name, phone) {
    autoSync();
    const d = digits(phone);
    V.api.session.set({ userId: 'cust-' + d, role: 'customer', phone: formatPhone(d), name: name || '', token: 'mock-customer-' + d });
  }
  function setKarmasterSession(phone, name, token) { // token: 미가입 카마스터가 claim/login으로 받은 세션 토큰
    autoSync();
    const d = digits(phone);
    V.api.session.set({ userId: 'km-' + d, role: 'karmaster', phone: formatPhone(d), name: name || '', token: token || 'mock-karmaster-' + d });
  }
  /** 목 어댑터의 가입 카마스터 명부를 v6 시드 카마스터와 맞춘다(목 전용. 실 API에서는 서버가 가진 명부). */
  function syncMockRegistry(karmasters) {
    const a = V.api.adapter();
    if (!a || a.name !== 'mock' || !a.admin) return;
    const st = a.admin.state();
    (karmasters || []).forEach((k) => {
      if (k && k.phone && !st.registry.karmasters[digits(k.phone)]) a.admin.registerKarmaster(k.phone, k.name, '');
    });
  }

  // ---------- 토스트 ----------
  function toast(msg, kind) {
    if (typeof document === 'undefined') return;
    let box = document.getElementById('vlp-toast');
    if (!box) { box = document.createElement('div'); box.id = 'vlp-toast'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    box.className = 'vlp-toast ' + (kind || 'info'); box.textContent = msg; box.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { box.hidden = true; }, 3500);
  }

  // ---------- 계약 상세 펼침 카드 (PWA-11) ----------
  /** 서버가 준 Contract를 그대로 보여 준다. 값이 없으면 '-'로 두어 행이 빠지지 않게 한다.
   *  c.masked(승인 전 카마스터)이면 제한된 항목 외에는 '승인 후 표시'. */
  function fieldRows(c, role, delivery) {
    const masked = !!c.masked;
    const later = '<span class="hint" style="display:inline;">승인 후 표시</span>';
    const v = (x) => (x == null || x === '' ? '-' : esc(x));
    const car = [c.vehicleModel, c.trim, c.color].filter(Boolean).map(esc).join(' · ') || '-';
    const rows = [
      ['서비스 계약번호', v(c.serviceContractNo)],
      ['제조사 계약번호', masked ? later : v(c.manufacturerContractNo)],
      ['차량', car],
      ['계약일자', masked ? later : v(c.contractDate)],
    ];
    if (role === 'customer') {
      const km = c.carmaster || {};
      rows.push(['카마스터', [km.name, km.phone, km.dealershipName].filter(Boolean).map(esc).join(' · ') || '-']);
    } else {
      rows.push(['고객', v(c.customerDisplayName)]);
    }
    rows.push(['인도지 유형', masked ? later : (c.destinationType ? esc(DEST_LABEL[c.destinationType] || c.destinationType) : '-')]);
    if (delivery && delivery.receiptMode) rows.push(['인수 방식', esc(RECEIPT_LABEL[delivery.receiptMode] || delivery.receiptMode)]);
    rows.push(['상태', esc(STATUS_LABEL[c.status] || c.status || '-')]);
    if (c.status === 'PENDING_APPROVAL') rows.push(['만료', esc(fmtDateTime(c.expiresAt) + ' (' + remaining(c.expiresAt) + ')')]);
    return rows;
  }

  // ---- PWA-12: 7개 표시 상태 칩 + 5단계 그래프 + 지연 배지 (색에만 의존하지 않고 글자·모양을 함께 쓴다) ----
  const STATE_GLYPH = { READY: '◇', DISPATCHED: '▷', IN_TRANSIT: '➤', CUSTOMIZING: '✦', DELIVERED: '◎', CONFIRMED: '✔', EXCEPTION: '▲' };
  function stateChip(displayState) {
    if (!displayState) return '';
    const label = (V.statusMap.LABEL || {})[displayState] || displayState;
    return '<span class="vlp-state vlp-state-chip" data-state="' + esc(displayState) + '"><span class="vlp-state-glyph" aria-hidden="true">' + (STATE_GLYPH[displayState] || '') + '</span>' + esc(label) + '</span>';
  }
  /** delivery: {storageState, displayState}. 현재 단계는 저장 상태로, 시공 중·지연은 표시 상태로 알린다. */
  function stepGraph(delivery) {
    if (!delivery) return '';
    const SM = V.statusMap, idx = SM.stepIndex(delivery.storageState), ds = delivery.displayState;
    const items = SM.STEPS.map((name, i) => {
      const st = i < idx ? 'done' : (i === idx ? 'cur' : 'todo');
      const mark = st === 'done' ? '완료' : (st === 'cur' ? '진행 중' : '예정');
      const extra = (i === 2 && ds === 'CUSTOMIZING') ? '<span class="vlp-step-note">시공 중</span>' : '';
      return '<li class="vlp-step ' + st + '" data-step="' + i + '"' + (st === 'cur' ? ' aria-current="step"' : '') + '><span class="vlp-step-dot" aria-hidden="true">' + (st === 'done' ? '✔' : (i + 1)) + '</span><span class="vlp-step-name">' + esc(name) + '</span><span class="vlp-step-mark">' + mark + '</span>' + extra + '</li>';
    }).join('');
    const exc = ds === 'EXCEPTION' ? '<div class="vlp-exc-badge" role="status"><span aria-hidden="true">▲</span> 지연·예외가 발생했습니다. 해소되면 직전 단계로 돌아갑니다.</div>' : '';
    return '<div class="vlp-stepgraph" data-display="' + esc(ds || '') + '"><ol class="vlp-steps" aria-label="인도 진행 단계">' + items + '</ol>' + exc + '</div>';
  }

  /** opts: {role, open, delivery, actionsEl} — 제목 줄을 누르면 접고 펴며, 펼치면 카드가 보이도록 스크롤한다. */
  function contractCard(c, opts) {
    opts = opts || {};
    const role = opts.role || 'customer';
    const card = document.createElement('div');
    card.className = 'vlp-card'; card.dataset.contractId = c.contractId;
    const head = document.createElement('button');
    head.type = 'button'; head.className = 'vlp-card-head'; head.setAttribute('aria-expanded', opts.open ? 'true' : 'false');
    head.innerHTML = '<span class="vlp-card-title"><b>' + esc(c.vehicleModel || '차종 미입력') + '</b><span class="hint" style="display:block;">' + esc(c.serviceContractNo || '') + '</span></span>' +
      (opts.badgeHTML || '<span class="badge ' + (STATUS_BADGE[c.status] || 'info') + '">' + esc(STATUS_LABEL[c.status] || c.status) + '</span>') +
      '<span class="vlp-caret" aria-hidden="true">▾</span>';
    const body = document.createElement('div');
    body.className = 'vlp-card-body'; body.hidden = !opts.open;
    body.innerHTML = fieldRows(c, role, opts.delivery).map(([k, val]) => '<div class="summary-line"><span>' + k + '</span><span>' + val + '</span></div>').join('');
    if (opts.delivery) { const g = document.createElement('div'); g.className = 'vlp-card-graph'; g.innerHTML = stepGraph(opts.delivery); body.insertBefore(g, body.firstChild); }
    if (typeof opts.onChat === 'function') { const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'btn btn-sm vlp-chat-open-btn'; cb.textContent = '💬 대화하기'; cb.addEventListener('click', () => opts.onChat(cb)); const w = document.createElement('div'); w.className = 'vlp-card-chat'; w.appendChild(cb); body.appendChild(w); }
    if (opts.extraEl) { const x = document.createElement('div'); x.className = 'vlp-card-extra'; x.appendChild(opts.extraEl); body.appendChild(x); }
    if (opts.actionsEl) { const slot = document.createElement('div'); slot.className = 'vlp-card-actions'; slot.appendChild(opts.actionsEl); body.appendChild(slot); }
    head.addEventListener('click', () => {
      const open = body.hidden; body.hidden = !open; head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && card.scrollIntoView) { try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { card.scrollIntoView(); } }
      if (typeof opts.onToggle === 'function') opts.onToggle(open);
    });
    card.appendChild(head); card.appendChild(body);
    return card;
  }

  /** 화면이 가진 내부 상태(펼침 여부, 고객이 이 기기에서 확인·요청했는지)를 기기에 잠깐 기억한다. 없어도 동작해야 한다. */
  const mem = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } },
    set(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* 저장 불가 환경 */ } },
  };


  // ---------- 앱 안 알림 (배지 + 목록) ----------
  /** 알림은 서버가 준 일반 문구만 그린다. 새 알림이 오면 토스트로 알리고, 푸시/문자는 이 버전에 없다(추후 처리 문서). */
  function notificationsPanel(opts) {
    opts = opts || {};
    const box = document.createElement('div'); box.className = 'vlp-notes';
    box.innerHTML = '<button type="button" class="vlp-notes-head" aria-expanded="false"><span>🔔 알림</span><span class="badge info vlp-notes-badge" hidden>0</span><span class="vlp-caret" aria-hidden="true">▾</span></button><div class="vlp-notes-body" hidden></div>';
    const head = box.querySelector('.vlp-notes-head'), badge = box.querySelector('.vlp-notes-badge'), body = box.querySelector('.vlp-notes-body');
    let lastUnread = null, lastSig = null, open = false;
    if (opts.sheet && V.delivery && V.delivery.openSheet) {
      // 홈 머리의 🔔: 목록은 시트로 연다(구성안 4.2). 닫으면 본문을 제자리로 돌려 두어 폴링이 계속 갱신한다.
      box.classList.add('vlp-notes-bell'); head.querySelector('.vlp-caret').remove();
      head.addEventListener('click', () => { body.hidden = false; head.setAttribute('aria-expanded', 'true'); V.delivery.openSheet('알림', body, head, () => { body.hidden = true; box.appendChild(body); head.setAttribute('aria-expanded', 'false'); }); });
    } else head.addEventListener('click', () => { open = !open; body.hidden = !open; head.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    async function load() {
      let page;
      try { page = await V.api.notifications.list({ limit: 20 }); } catch (e) { if (e.status === 401 && opts.onAuthLost) opts.onAuthLost(); return; }
      const sig = JSON.stringify(page);
      if (sig === lastSig) return; lastSig = sig;
      badge.textContent = String(page.unreadCount); badge.hidden = page.unreadCount === 0;
      if (lastUnread !== null && page.unreadCount > lastUnread) toast('새 알림이 있어요');
      lastUnread = page.unreadCount;
      body.innerHTML = '';
      if (!page.items.length) { body.innerHTML = '<div class="hint">알림이 없습니다.</div>'; if (V.pushLink) body.appendChild(V.pushLink.settingsRow()); return; }
      page.items.forEach((n) => {
        const row = document.createElement('div'); row.className = 'vlp-note' + (n.read ? ' read' : ''); row.dataset.id = n.notificationId;
        row.innerHTML = '<div class="vlp-note-text"></div><div class="hint vlp-note-time"></div>';
        row.querySelector('.vlp-note-text').textContent = n.text; row.querySelector('.vlp-note-time').textContent = fmtDateTime(n.createdAt);
        if (!n.read) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm vlp-note-read'; b.textContent = '읽음'; b.addEventListener('click', async () => { try { await V.api.notifications.read(n.notificationId); lastSig = null; load(); } catch (e) { /* 무시 */ } }); row.appendChild(b); }
        if (opts.role && n.refType && V.pushLink) { const o = document.createElement('a'); o.className = 'btn btn-sm vlp-note-open'; o.textContent = '열기'; o.href = V.pushLink.urlFor(n, opts.role); row.appendChild(o); }
        body.appendChild(row);
      });
      if (V.pushLink) body.appendChild(V.pushLink.settingsRow());
    }
    load();
    const timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(timer); return; } load(); }, V.config.get('pollIntervalMs'));
    return box;
  }

  V.ui = { stateChip, stepGraph, notificationsPanel, now, esc, digits, formatPhone, isPhone, fmtDateTime, remaining, errorText, setCustomerSession, setKarmasterSession, syncMockRegistry, toast, contractCard, fieldRows, mem, STATUS_LABEL, STATUS_BADGE, DEST_LABEL, RECEIPT_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.ui;
})(typeof window !== 'undefined' ? window : globalThis);
