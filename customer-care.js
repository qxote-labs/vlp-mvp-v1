/* customer-care.js — 구매자 신차케어 화면 (v6 항목을 그대로 옮긴 1차 이식).
 * 서버 호출은 VLP.api.care.* (잠정 계약, care-api.js)만 쓴다. 화면 틀은 인도 상세(vlp-case.js detail)를 재사용한다.
 * 흐름(v6): 신청 -> 견적 회신 -> 계약 -> 입고 -> 작업 -> 검수 -> 출차 -> 수령 -> 정찰제 확인 -> 평가.
 * 이동 현황(transit)은 GPS·기사 화면을 두지 않는 원칙에 따라 옮기지 않고, 수령 방식 문구로 대신한다.
 */
(function (g) {
  'use strict';
  const V = g.VLP; const U = V.ui; const esc = U.esc;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR') + '원');
  const cfg = (k) => V.config.get(k);

  // 단계 위치: -1 = 입고 전(접수·견적·계약), 0..4 = 입고·작업·검수·출차·수령, 5 = 모두 끝남
  const IDX = { REQUESTED: -1, QUOTED: -1, CONFIRMED: -1, RECEIVED: 0, WORKING: 1, INSPECTING: 2, CUSTOMER_INSPECT: 2, REWORK: 2, ESCALATED: 2, RELEASED: 3, READY_TO_RECEIVE: 4, PRICE_CHECK: 5, DISPUTED: 5, RATE: 5, DONE: 5 };
  const LABEL = { REQUESTED: ['견적 대기', 'wait'], QUOTED: ['견적 도착', 'info'], CONFIRMED: ['입고 대기', 'wait'], RECEIVED: ['입고 완료', 'info'], WORKING: ['작업 중', 'info'], INSPECTING: ['검수 준비', 'info'], CUSTOMER_INSPECT: ['검수 확인 필요', 'wait'], REWORK: ['보완 중', 'wait'], ESCALATED: ['운영자 중재 중', 'wait'], RELEASED: ['출차 완료', 'info'], READY_TO_RECEIVE: ['수령 대기', 'wait'], PRICE_CHECK: ['정찰제 확인', 'wait'], DISPUTED: ['이의 접수', 'wait'], RATE: ['평가 대기', 'wait'], DONE: ['완료', 'done'] };
  const badge = (it) => { const l = LABEL[it.phase] || ['-', 'info']; return '<span class="badge ' + l[1] + '">' + esc(l[0]) + '</span>'; };
  const steps = () => cfg('careSteps') || ['입고', '작업', '검수', '출차', '수령'];
  const modeLabel = (code) => { const m = (cfg('careReceiveModes') || []).find((x) => x.code === code); return m ? m.label : (code || '-'); };
  const titleOf = (it) => (it.vehicleModel || '차종 미입력') + (it.shop ? ' · ' + it.shop.name : '');

  function progressOf(it) {
    const i = IDX[it.phase]; const st = steps();
    if (it.phase === 'REWORK') return '3단계 검수 · 보완 중' + (it.disputeMaxRounds != null ? ' (이의 ' + it.disputeRounds + '/' + it.disputeMaxRounds + '회)' : '');
    if (it.phase === 'ESCALATED') return '3단계 검수 · 운영자 중재 중';
    if (i < 0) return it.phase === 'QUOTED' ? '견적이 도착했어요' : (it.phase === 'CONFIRMED' ? '계약 완료 · 입고 전' : '견적 대기');
    if (i >= st.length) return it.phase === 'DONE' ? '모든 과정 완료' : '수령 완료 · 마무리 확인';
    return (i + 1) + '/' + st.length + (i < st.length - 1 ? ' · 다음 ' + st[i + 1] : '');
  }
  function graphOf(it) {
    const i = IDX[it.phase];
    const items = steps().map((name, k) => {
      const st = k < i ? 'done' : (k === i ? 'cur' : 'todo');
      const mark = st === 'done' ? '완료' : (st === 'cur' ? '진행 중' : '예정');
      return '<li class="vlp-step ' + st + '" data-step="' + k + '"' + (st === 'cur' ? ' aria-current="step"' : '') + '><span class="vlp-step-dot" aria-hidden="true">' + (st === 'done' ? '✔' : (k + 1)) + '</span><span class="vlp-step-name">' + esc(name) + '</span><span class="vlp-step-mark">' + mark + '</span></li>';
    }).join('');
    return '<div class="vlp-stepgraph"><ol class="vlp-steps" aria-label="케어 진행 단계">' + items + '</ol></div>';
  }
  function nextOf(it) {
    const visit = it.receiveMode !== 'SHOP_DELIVERY';
    switch (it.phase) {
      case 'REQUESTED': return (it.mode === 'online' ? '온라인으로 요청한 견적을' : '방문 협의 후 견적을') + ' ' + (it.shop ? it.shop.name : '시공사') + '가 확인하고 있어요. 도착하면 알려 드려요.';
      case 'QUOTED': return '시공사 견적이 도착했어요. 내용을 확인하고 계약해 주세요.';
      case 'CONFIRMED': return '계약이 완료됐어요. 차량을 시공사에 입고해 주세요. 입고를 확인하면 작업이 시작돼요.';
      case 'RECEIVED': return '입고를 확인했어요. 곧 작업을 시작해요.';
      case 'WORKING': return '시공이 진행 중이에요.';
      case 'INSPECTING': return '시공사가 최종 검수 중이에요. 끝나면 확인을 요청드려요.';
      case 'CUSTOMER_INSPECT': return '시공이 끝났어요. 결과 사진을 보고 출차를 승인해 주세요.';
      case 'REWORK': return '이의를 접수했어요. 시공사가 보완한 뒤 다시 검수를 요청해요.' + (it.disputeReason ? ' (사유: ' + it.disputeReason + ')' : '');
      case 'ESCALATED': return '이의 가능 횟수를 넘어 운영자가 중재하고 있어요. 확인 후 연락드려요.';
      case 'RELEASED': return visit ? '출차가 끝났어요. 곧 수령 안내를 드려요.' : '출차가 끝났어요. 시공사 배송으로 수령합니다.';
      case 'READY_TO_RECEIVE': return visit ? '시공이 끝난 차량을 수령하고 확인해 주세요.' : '시공사 배송으로 차량이 도착했어요. 수령을 확인해 주세요.';
      case 'PRICE_CHECK': return '수령이 끝났어요. 정찰제가 지켜졌는지 확인해 주세요.';
      case 'DISPUTED': return '추가 요금 제보가 접수됐어요. 운영자가 확인 후 연락드려요.';
      case 'RATE': return '정찰제 이행이 확인됐어요. 평가를 남기면 포인트가 적립돼요.';
      case 'DONE': return '신차케어가 모두 끝났어요.' + (it.pointsEarned ? ' (+' + Number(it.pointsEarned).toLocaleString('ko-KR') + 'P 적립)' : '');
      default: return '';
    }
  }

  // ---------- 목록 ----------
  function row(it, active, onOpen) {
    const r = el('<button type="button" class="vlp-case-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-row-badge"></span></span><span class="hint vlp-row-sub"></span><span class="vlp-row-prog"></span></button>');
    r.dataset.careId = it.careId; if (active) { r.classList.add('on'); r.setAttribute('aria-current', 'true'); }
    r.querySelector('.vlp-row-title').textContent = titleOf(it); r.querySelector('.vlp-row-badge').innerHTML = badge(it);
    r.querySelector('.vlp-row-sub').textContent = it.careId + ' · ' + (it.package ? it.package.name : '');
    r.querySelector('.vlp-row-prog').textContent = (it.unreadChat ? '💬 새 메시지 ' + it.unreadChat + ' · ' : '') + progressOf(it);
    r.addEventListener('click', () => onOpen(it.careId));
    return r;
  }
  /** 목록 열: items, activeId, onOpen(id), onNew(), canNew(내 차량이 있는지) */
  function list(o) {
    const box = document.createElement('div');
    const hd = el('<div class="vlp-pane-head"><h2>신차케어</h2></div>');
    if (o.items.length && o.canNew) { const b = el('<button class="btn btn-outline btn-sm" id="care-new-sm" type="button">+ 새로 신청</button>'); b.addEventListener('click', o.onNew); hd.appendChild(b); }
    box.appendChild(hd);
    if (!o.items.length) {
      const e = o.canNew
        ? el('<div class="empty-state"><div class="big">📭</div>아직 신청한 신차케어가 없습니다.<br><button class="btn btn-primary" style="width:auto;margin-top:14px;padding:10px 20px;" id="care-empty-new" type="button">새로 신청하기</button></div>')
        : el('<div class="empty-state"><div class="big">📭</div>아직 등록된 내 차량이 없습니다.<br>먼저 신차인도서비스 계약을 등록해야 신청할 수 있습니다.</div>');
      const nb = e.querySelector('#care-empty-new'); if (nb) nb.addEventListener('click', o.onNew);
      box.appendChild(e);
    } else if (o.wide && o.items.length < 2) {
      /* 태블릿·PC에서 1건이면 목록 없이 상세만 (내 차량과 같은 규칙) */
    } else if (o.wide) {
      const col = el('<div class="vlp-car-chips" role="group" aria-label="신청 전환"></div>');
      o.items.forEach((it) => { const b = el('<button type="button" class="vlp-car-chip"><span class="vlp-chip-t"></span><span class="vlp-row-badge"></span></button>'); b.dataset.careId = it.careId; b.dataset.initial = (it.vehicleModel || '차').slice(0, 1); b.querySelector('.vlp-chip-t').textContent = titleOf(it) + ' · ' + String(it.careId).slice(-4); b.querySelector('.vlp-row-badge').innerHTML = badge(it); if (it.careId === o.activeId) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); } b.addEventListener('click', () => o.onOpen(it.careId)); col.appendChild(b); });
      box.appendChild(col);
    } else {
      o.items.forEach((it) => box.appendChild(row(it, it.careId === o.activeId, o.onOpen)));
    }
    return box;
  }

  // ---------- 상세 ----------
  function line(k, v) { return '<div class="summary-line"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }
  const mmdd = (t) => { const d = new Date(t); const z = (n) => String(n).padStart(2, '0'); return z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); };
  const routeLabel = (code) => ((cfg('careIntakeRoutes') || []).find((r) => r.code === code) || {}).label || code;
  const card = (title, bodyHTML) => { const c = el('<div class="vlp-cd"><h4></h4><p></p></div>'); c.querySelector('h4').textContent = title; c.querySelector('p').innerHTML = bodyHTML; return c; };
  /** 청구 표기(구성안 8.2): "견적 ○○원 + 추가 ○○원". 청구 입력 전에는 견적만 */
  function chargeText(it) {
    if (it.quotedPrice == null) return '견적 대기';
    if (it.chargedPrice == null) return '견적 ' + won(it.quotedPrice) + ' · 청구 전';
    return '견적 ' + won(it.quotedPrice) + ' + 추가 ' + won(Math.max(0, it.chargedPrice - it.quotedPrice));
  }
  function chargeReasonSheet(it, opener) {
    const extra = it.chargedPrice == null ? 0 : it.chargedPrice - it.quotedPrice;
    const w = el('<div class="care-sheet"></div>');
    w.innerHTML = line('견적', won(it.quotedPrice)) + line('추가', won(Math.max(0, extra))) + line('실제 청구액', it.chargedPrice == null ? '-' : won(it.chargedPrice)) + line('추가 사유', it.chargeNote || (extra > 0 ? '시공사가 사유를 적지 않았어요' : '추가 없음'));
    V.delivery.openSheet('청구 내역', w, opener);
  }
  function chargeRow(it) {
    const r = el('<div class="care-charge"><span class="care-charge-t"></span> <button type="button" class="vlp-sum-link care-reason">추가 사유 ›</button></div>');
    r.querySelector('.care-charge-t').textContent = chargeText(it);
    const b = r.querySelector('.care-reason'); if (it.chargedPrice == null) b.hidden = true; else b.addEventListener('click', () => chargeReasonSheet(it, b));
    return r;
  }
  /** 계약 요약: 구매·인도의 summaryCard와 같은 마크업·동작(제목 줄 전체가 버튼, 오른쪽 '상세 ▾ / 접기 ▴', 펼치면 필드 목록) */
  function summaryCard(it) {
    const root = el('<div class="vlp-cd vlp-sum"><div class="vlp-sum-top" role="button" tabindex="0" aria-expanded="false"><h4>계약 요약</h4><span class="vlp-sum-link">상세 ▾</span></div><div class="vlp-sum-lines"></div><div class="vlp-sum-more vlp-fields" hidden></div></div>');
    const car = [it.vehicleModel, it.trim, it.color].filter(Boolean).join(' · ') || '차종 미입력';
    const l1 = '서비스 계약번호 ' + it.careId + ' · ' + car;
    const l2 = [it.createdAt ? '신청일 ' + mmdd(it.createdAt).slice(0, 5) : '', it.shop ? '시공사 ' + it.shop.name : '', (LABEL[it.phase] || [''])[0]].filter(Boolean).join(' · ');
    const lines = root.querySelector('.vlp-sum-lines');
    [l1, l2].forEach((t) => { const p = el('<p class="vlp-sum-line"></p>'); p.textContent = t; if (t) lines.appendChild(p); });
    const more = root.querySelector('.vlp-sum-more'), head = root.querySelector('.vlp-sum-top'), link = root.querySelector('.vlp-sum-link');
    more.innerHTML = (it.customer ? line('고객', [it.customer.name, it.customer.phone].filter(Boolean).join(' · ') || '-') : '') + line('시공업체', it.shop ? it.shop.name : '-') + line('입고 경로', it.intakeRoute ? routeLabel(it.intakeRoute) : '입고 후 표시') + line('수령 방식', modeLabel(it.receiveMode)) + line('진행 방식', it.mode === 'online' ? '온라인 즉시견적' : '방문 후 협의') +
      (it.package ? line('패키지', it.package.name + ' · ' + won(it.package.price)) : '') + (it.options.length ? line('추가 옵션', it.options.map((x) => x.name + ' ' + won(x.price)).join(', ')) : '') +
      (it.quotedPrice ? line('견적가', won(it.quotedPrice)) : '') + (it.pointsUsed ? line('포인트 사용', '−' + Number(it.pointsUsed).toLocaleString('ko-KR') + 'P') : '') + (it.customRequest ? line('요청사항', it.customRequest) : '');
    function toggle() {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', open ? 'true' : 'false'); root.classList.toggle('open', open); link.textContent = open ? '접기 ▴' : '상세 ▾'; more.hidden = !open;
      if (open && root.scrollIntoView) root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    head.addEventListener('click', toggle); head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return root;
  }
  function overviewTab(it) {
    const w = el('<div class="vlp-ov"></div>');
    w.appendChild(summaryCard(it));
    if (it.shop) {
      const q = String(cfg('navLinkTemplate') || '').replace('{q}', encodeURIComponent(it.shop.address || it.shop.name));
      const c = card('시공사 위치', '');
      c.querySelector('p').textContent = [it.shop.name, it.shop.address, it.shop.phone].filter(Boolean).join(' · ') + ' ';
      if (it.shop.address) { const a = el('<a class="vlp-sum-link" target="_blank" rel="noopener noreferrer">길찾기 ›</a>'); a.href = q; c.querySelector('p').appendChild(a); }
      w.appendChild(c);
    }
    w.appendChild(card('수령 방식', it.receiveMode === 'SHOP_DELIVERY' ? '시공사 배송 · 시공사가 인계 사진을 올리면 고객이 원격 확인으로 수령을 확정합니다.' : '방문 수령(기본) · 출차 승인 후 시공사에서 수령합니다. 시공사 배송은 옵션이며, 신청할 때 고를 수 있어요.'));
    const pc = it.priceMatch === true ? '정찰제 확인: 견적과 청구가 일치했어요' : (it.priceMatch === false ? '정찰제 확인: 추가금 제보가 접수됐어요' : '견적 = 청구 여부는 완료 후 확인합니다');
    w.appendChild(card('정찰제', esc(pc)));
    return w;
  }
  function progressTab(it, catalog) {
    const w = el('<div class="vlp-ov"></div>');
    const i = IDX[it.phase];
    const st = (k) => (i >= 5 || k < i ? 'done' : (k === i ? 'cur' : 'todo'));
    const intake = (it.log.find((l) => /^입고 확인/.test(l.msg)) || {}).t;
    const nodes = [];
    nodes.push({ s: st(0), t: '입고 확인', sub: ((intake ? mmdd(intake) : '') + (it.intakeRoute ? ' · ' + routeLabel(it.intakeRoute) : '')).replace(/^ · /, '') });
    if (it.intakePhotos && it.intakePhotos.length) nodes.push({ s: st(0), t: '사전 촬영', sub: it.intakePhotos.length + '장' + (it.mileage != null ? ' · 주행 ' + Number(it.mileage).toLocaleString('ko-KR') + 'km' : '') });
    nodes.push({ s: st(1), t: i === 1 ? '작업 중' : '작업', sub: it.photos.length ? '현장 사진 ' + it.photos.length : '' });
    // 추가 작업: 청구가 견적을 넘었을 때만 한 줄을 끼운다(고객 동의 절차는 두지 않음 — 문서에 정의 없음)
    if (it.chargedPrice != null && it.quotedPrice != null && it.chargedPrice > it.quotedPrice) nodes.push({ s: i > 1 ? 'done' : 'todo', t: '추가 작업', sub: '+' + won(it.chargedPrice - it.quotedPrice) + (it.chargeNote ? ' · ' + it.chargeNote : '') });
    nodes.push({ s: st(2), t: '검수 요청', sub: it.phase === 'REWORK' ? '보완 중' : (it.phase === 'ESCALATED' ? '운영자 중재 중' : '') });
    nodes.push({ s: st(3), t: '출차' }); nodes.push({ s: st(4), t: '수령 확인', sub: modeLabel(it.receiveMode) });
    const box = el('<div class="vlp-cd"><h4>진행</h4></div>'); box.appendChild(V.delivery.stepper(nodes, '신차케어 진행 순서'));
    w.appendChild(box);
    const ch = el('<div class="vlp-cd"><h4>청구</h4></div>'); ch.appendChild(chargeRow(it)); w.appendChild(ch);
    if (it.intakePhotos && it.intakePhotos.length) {
      const ip = el('<div class="vlp-cd"><h4>사전 촬영</h4><div class="care-photos"></div></div>');
      it.intakePhotos.forEach((p) => { const f = el('<figure class="care-photo"><img alt=""><figcaption class="hint"></figcaption></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = p.label + ' 사진'; f.querySelector('figcaption').textContent = p.label; ip.querySelector('.care-photos').appendChild(f); });
      w.appendChild(ip);
    }
    if (it.photos.length) {
      const ph = el('<div class="vlp-cd"><h4>현장 사진</h4><div class="care-photos"></div></div>');
      it.photos.forEach((p) => { const f = el('<figure class="care-photo"><img alt=""><figcaption class="hint"></figcaption></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = p.label || '현장 사진'; f.querySelector('figcaption').textContent = p.label || ''; ph.querySelector('.care-photos').appendChild(f); });
      w.appendChild(ph);
    }
    return w;
  }
  /** 이력: 구매·인도 이력 탭과 같은 형식 — 일어난 기록만, 날짜 구분 · 시각 · 한 줄, 최근 N건 + 더 보기 */
  function historyTab(it) {
    const w = el('<div class="vlp-hist-tab"></div>'); const two = (n) => String(n).padStart(2, '0');
    w.appendChild(el('<h3 class="vlp-hl-title">진행 기록</h3>'));
    const box = el('<div class="vlp-hl"></div>'); w.appendChild(box);
    const all = it.log.slice().reverse(); const limit = cfg('historyVisible') || 5; let lastDay = '';
    if (!all.length) box.appendChild(el('<div class="hint">아직 기록이 없어요.</div>'));
    const add = (l) => {
      const d = new Date(l.t), day = two(d.getMonth() + 1) + '-' + two(d.getDate()), n = new Date();
      if (day !== lastDay) { lastDay = day; const dv = el('<div class="vlp-hl-day"></div>'); dv.textContent = day + (n.getMonth() === d.getMonth() && n.getDate() === d.getDate() ? ' · 오늘' : ''); box.appendChild(dv); }
      const row = el('<div class="vlp-hl-row"><span class="vlp-hl-time"></span><span class="vlp-hl-text"></span></div>');
      row.querySelector('.vlp-hl-time').textContent = two(d.getHours()) + ':' + two(d.getMinutes()); row.querySelector('.vlp-hl-text').textContent = l.msg; box.appendChild(row);
    };
    all.slice(0, limit).forEach(add);
    if (all.length > limit) { const more = el('<button type="button" class="vlp-hl-more">이전 기록 더 보기 (' + (all.length - limit) + ') ▾</button>'); more.addEventListener('click', () => { all.slice(limit).forEach(add); more.remove(); }); w.appendChild(more); }
    return w;
  }

  // 단계별 주요 행동 시트
  const sheetOf = {
    QUOTED(it, ctx) {
      // 목업 e: 기본 패키지 / 추가 옵션 / 합계(작업 착수 전에 가격이 확정됩니다) / 포인트 사용
      const w = el('<div class="care-sheet"></div>');
      w.appendChild(card('기본 패키지', esc(it.package ? it.package.name + ' · ' + won(it.package.price) : '-')));
      w.appendChild(card('추가 옵션', esc(it.options.length ? it.options.map((x) => x.name + ' ' + won(x.price)).join(', ') : '없음')));
      const base = (it.package ? it.package.price : 0) + it.options.reduce((a, x) => a + x.price, 0);
      w.appendChild(card('합계', esc(won(it.quotedPrice) + ' · 작업 착수 전에 가격이 확정됩니다') + (base !== it.quotedPrice ? '<br>' + esc('시공사가 요청사항을 반영해 조정한 금액이에요') : '')));
      if (it.customRequest) w.appendChild(card('요청사항', esc(it.customRequest)));
      w.insertAdjacentHTML('beforeend', '<label for="care-pts">포인트 사용</label><div class="hint care-bal"></div><input id="care-pts" type="number" min="0" step="1000" value="0"><button type="button" class="btn btn-primary btn-auto" id="care-confirm">이 견적으로 계약 완료</button><div class="vlp-error" role="alert" hidden></div>');
      V.api.care.points().then((p) => { const cap = Math.min(p.balance, it.quotedPrice || 0); w.querySelector('.care-bal').textContent = '보유 포인트: ' + Number(p.balance).toLocaleString('ko-KR') + 'P'; const inp = w.querySelector('#care-pts'); inp.max = cap; if (cap <= 0) inp.disabled = true; });
      w.querySelector('#care-confirm').addEventListener('click', () => run(w, () => V.api.care.confirmQuote(it.careId, parseInt(w.querySelector('#care-pts').value, 10) || 0), ctx));
      return w;
    },
    CUSTOMER_INSPECT(it, ctx) {
      const w = el('<div class="care-sheet"><p class="hint">시공사가 최종 검수를 마쳤어요. 시공 결과(사진)와 청구 내역을 확인하고 만족스러우면 출차를 승인해 주세요.</p><div class="care-photos"></div><div class="care-charge-slot"></div><div class="btn-row"><button type="button" class="btn btn-primary btn-auto" id="care-approve">만족합니다, 출차 승인</button><button type="button" class="btn btn-danger btn-auto" id="care-dispute-open">불만족 — 재작업 요청</button></div><div id="care-dispute-box" hidden><label for="care-dispute-reason">불만족 사유</label><textarea id="care-dispute-reason" rows="3" placeholder="예: 틴팅 기포, 마감 스크래치 등"></textarea><button type="button" class="btn btn-danger btn-sm" id="care-dispute-send">이의제기 접수</button></div><div class="vlp-error" role="alert" hidden></div></div>');
      w.querySelector('.care-charge-slot').appendChild(chargeRow(it));
      it.photos.forEach((p) => { const f = el('<figure class="care-photo"><img alt=""></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = p.label || ''; w.querySelector('.care-photos').appendChild(f); });
      const left = it.disputeMaxRounds == null ? null : it.disputeMaxRounds - it.disputeRounds;
      const dopen = w.querySelector('#care-dispute-open'), dsend = w.querySelector('#care-dispute-send');
      if (it.disputeRounds > 0) w.querySelector('p.hint').insertAdjacentText('beforeend', ' 보완 후 다시 검수를 요청드렸어요.');
      if (left !== null && left <= 0) { dopen.textContent = '운영자에게 중재 요청'; dsend.textContent = '중재 요청 접수'; w.querySelector('p.hint').insertAdjacentText('beforeend', ' 이의 가능 횟수(' + it.disputeMaxRounds + '회)를 모두 사용했어요. 추가 불만은 운영자가 중재해요.'); }
      else if (left !== null) dopen.textContent = '불만족 — 보완 요청 (남은 ' + left + '회)';
      w.querySelector('#care-approve').addEventListener('click', () => run(w, () => V.api.care.approveInspection(it.careId), ctx));
      w.querySelector('#care-dispute-open').addEventListener('click', () => { w.querySelector('#care-dispute-box').hidden = false; });
      w.querySelector('#care-dispute-send').addEventListener('click', () => run(w, () => V.api.care.raiseDispute(it.careId, w.querySelector('#care-dispute-reason').value), ctx));
      return w;
    },
    READY_TO_RECEIVE(it, ctx) {
      const w = el('<div class="care-sheet"><p class="hint">시공이 끝난 차량을 확인한 뒤 최종 수령을 눌러 주세요.</p><button type="button" class="btn btn-primary btn-auto" id="care-receive">차량 수령 확인하기</button><div class="vlp-error" role="alert" hidden></div></div>');
      w.querySelector('#care-receive').addEventListener('click', () => run(w, () => V.api.care.confirmReceipt(it.careId), ctx)); return w;
    },
    PRICE_CHECK(it, ctx) {
      const w = el('<div class="care-sheet"><p class="check-q">사전에 확정했던 <b></b> 외에 현장에서 추가 요금을 요구받으셨나요?</p><div class="summary-card"><div class="summary-title">참고 정보</div></div><button type="button" class="btn btn-primary btn-auto" id="care-pc-ok">아니오, 견적가 그대로였습니다</button><button type="button" class="btn btn-danger btn-auto" id="care-pc-no">예, 추가금을 요구받았습니다</button><div class="vlp-error" role="alert" hidden></div></div>');
      w.querySelector('b').textContent = won(it.quotedPrice);
      const same = it.chargedPrice != null && it.chargedPrice === it.quotedPrice;
      w.querySelector('.summary-card').insertAdjacentHTML('beforeend', line('견적 = 청구', it.chargedPrice == null ? '청구 미입력' : '견적 ' + won(it.quotedPrice) + ' ' + (same ? '=' : '≠') + ' 청구 ' + won(it.chargedPrice) + ' (' + (same ? '일치' : '차이 있음') + ')') + line('추가', it.chargedPrice == null ? '-' : won(Math.max(0, it.chargedPrice - it.quotedPrice))) + (it.chargeNote ? line('추가 사유', it.chargeNote) : ''));
      w.querySelector('#care-pc-ok').addEventListener('click', () => run(w, () => V.api.care.answerPriceCheck(it.careId, true), ctx));
      w.querySelector('#care-pc-no').addEventListener('click', () => run(w, () => V.api.care.answerPriceCheck(it.careId, false), ctx)); return w;
    },
    RATE(it, ctx) {
      const dims = V.api.care.ratingAspects();
      const w = el('<div class="care-sheet"><p class="hint"></p><div class="care-dims"></div><label for="care-rate-comment">후기 (선택)</label><textarea id="care-rate-comment" rows="3" placeholder="이용 경험을 남겨주세요"></textarea><button type="button" class="btn btn-primary btn-auto" id="care-rate-send">평가 제출하고 포인트 받기</button><div class="vlp-error" role="alert" hidden></div></div>');
      w.querySelector('.hint').textContent = (it.shop ? it.shop.name : '시공사') + '에 대한 평가를 남기면 포인트가 적립돼요. 제출한 평가는 수정할 수 없어요.';
      const scores = {};
      dims.forEach((d) => {
        scores[d.id] = 5;
        const r = el('<div class="care-dim"><label></label><input type="range" min="1" max="5" value="5"><span class="hint">5점</span></div>');
        r.querySelector('label').textContent = d.label; const inp = r.querySelector('input'); inp.id = 'care-dim-' + d.id; r.querySelector('label').htmlFor = inp.id;
        inp.addEventListener('input', () => { scores[d.id] = parseInt(inp.value, 10); r.querySelector('.hint').textContent = inp.value + '점'; });
        w.querySelector('.care-dims').appendChild(r);
      });
      w.querySelector('#care-rate-send').addEventListener('click', () => run(w, () => V.api.care.rate(it.careId, scores, w.querySelector('#care-rate-comment').value), ctx)); return w;
    },
  };
  const PRIMARY = { QUOTED: '견적 확인하고 계약', CUSTOMER_INSPECT: '검수 확인', READY_TO_RECEIVE: '차량 수령 확인', PRICE_CHECK: '정찰제 확인', RATE: '시공사 평가하고 포인트 받기' };

  async function run(w, fn, ctx) {
    const errBox = w.querySelector('.vlp-error'); errBox.hidden = true;
    w.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { await fn(); if (ctx.close) ctx.close(); ctx.refresh(); }
    catch (e) { errBox.textContent = U.errorText ? U.errorText(e) : String(e.message || e); errBox.hidden = false; w.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  }

  /** 상세: it(케어 한 건), catalog, o = {onBack, refresh} */
  function detail(it, catalog, o) {
    const ctx = { refresh: o.refresh };
    const tabs = [
      { id: 'overview', label: '개요', render: () => overviewTab(it) },
      { id: 'progress', label: '진행', render: () => progressTab(it, catalog) },
      { id: 'history', label: '이력', render: () => historyTab(it) },
    ];
    const opts = {
      role: 'customer', noGuide: true, contract: { contractId: it.careId, vehicleModel: titleOf(it) }, idx: 0, stateHTML: badge(it), next: nextOf(it), progress: progressOf(it), graphHTML: graphOf(it),
      steps: steps(), stepDescs: cfg('careStepDescriptions') || [], tabs, defaultTab: 'progress', onBack: o.onBack, aside: '',
      chatBadge: it.unreadChat || 0,
      onChat: (b) => V.chat.open(it.careId, { role: 'customer', api: V.api.care.chat, other: '시공사', summary: titleOf(it) + ' · 시공사', opener: b }),
    };
    if (sheetOf[it.phase]) opts.primary = { label: PRIMARY[it.phase], title: PRIMARY[it.phase], open: (h) => { const body = sheetOf[it.phase](it, ctx); ctx.close = () => h.close && h.close(); return body; } };
    const root = V.caseView.detail(opts);
    root.classList.add('vlp-care-case'); root.dataset.careId = it.careId; root.dataset.phase = it.phase;
    return root;
  }

  // ---------- 새 신청 ----------
  /** o: {cars, shops, catalog, preCar, onDone(careId), onCancel()} */
  function newForm(o) {
    const cat = o.catalog; const d = { reservationId: o.preCar || (o.cars.length === 1 ? o.cars[0].reservationId : ''), shopId: '', packageId: (cat.packages.find((p) => p.rec) || cat.packages[0]).id, optionIds: [], mode: 'online', receiveMode: cat.defaultReceiveMode, customRequest: '' };
    const w = el('<div class="vlp-form care-form" style="max-width:var(--page-measure,760px);"><h2>신차케어 신청</h2><div class="sub">시공사를 고르고 옵션을 구성하면, 시공사가 요청사항을 반영해 최종 견적을 회신합니다.</div></div>');
    const body = document.createElement('div'); w.appendChild(body);
    function paint() {
      const pkg = cat.packages.find((p) => p.id === d.packageId); const opts = cat.options.filter((x) => d.optionIds.includes(x.id));
      const suggested = pkg.price + opts.reduce((s, x) => s + x.price, 0);
      body.innerHTML = '';
      const sec = (t, node) => { const s = el('<div class="care-sec"><h3></h3></div>'); s.querySelector('h3').textContent = t; if (node) s.appendChild(node); body.appendChild(s); return s; };
      const carSel = el('<select id="care-car"><option value="">차량을 선택하세요</option></select>');
      o.cars.forEach((c) => { const op = document.createElement('option'); op.value = c.reservationId; op.textContent = (c.vehicleModel || '차종 미정') + (c.trim ? ' · ' + c.trim : '') + (c.ref ? ' (' + c.ref + ')' : ''); carSel.appendChild(op); });
      carSel.value = d.reservationId; carSel.addEventListener('change', () => { d.reservationId = carSel.value; validate(); });
      sec('대상 차량 (출고 전이든 이미 받은 차든 상관없어요)', carSel);
      const shops = el('<div class="care-shops"></div>');
      o.shops.forEach((s) => { const b = el('<button type="button" class="care-shop"><b></b><span class="hint"></span></button>'); b.dataset.shopId = s.shopId; b.querySelector('b').textContent = s.name; b.querySelector('.hint').textContent = (s.tags || []).join(' · '); if (d.shopId === s.shopId) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); } b.addEventListener('click', () => { d.shopId = s.shopId; paint(); }); shops.appendChild(b); });
      sec('시공사 선택', shops);
      const pk = el('<div class="care-pkgs"></div>');
      cat.packages.forEach((p) => { const b = el('<button type="button" class="care-pkg"><b></b><span class="care-pkg-price"></span><span class="hint"></span></button>'); b.dataset.pkgId = p.id; b.querySelector('b').textContent = p.name; b.querySelector('.care-pkg-price').textContent = won(p.price); b.querySelector('.hint').textContent = p.desc; if (d.packageId === p.id) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); } b.addEventListener('click', () => { d.packageId = p.id; paint(); }); pk.appendChild(b); });
      sec('기본 패키지', pk);
      const ox = document.createElement('div');
      cat.options.forEach((x) => { const r = el('<label class="care-opt"><input type="checkbox"><span></span></label>'); r.querySelector('span').textContent = x.name + ' · ' + won(x.price); const cb = r.querySelector('input'); cb.checked = d.optionIds.includes(x.id); cb.addEventListener('change', () => { d.optionIds = cb.checked ? d.optionIds.concat([x.id]) : d.optionIds.filter((i) => i !== x.id); paint(); }); ox.appendChild(r); });
      sec('추가옵션 (선택)', ox);
      const md = el('<div class="care-seg" role="group" aria-label="진행 방식"></div>');
      [['online', '온라인 즉시견적'], ['visit', '방문 후 협의']].forEach(([v, t]) => { const b = el('<button type="button" class="care-seg-b"></button>'); b.textContent = t; if (d.mode === v) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); } b.addEventListener('click', () => { d.mode = v; paint(); }); md.appendChild(b); });
      sec('진행 방식', md);
      const rm = el('<div class="care-seg" role="group" aria-label="수령 방식"></div>');
      (cat.receiveModes || []).forEach((m) => { const b = el('<button type="button" class="care-seg-b"></button>'); b.textContent = m.label; b.dataset.mode = m.code; if (d.receiveMode === m.code) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); } b.addEventListener('click', () => { d.receiveMode = m.code; paint(); }); rm.appendChild(b); });
      sec('수령 방식', rm);
      const ta = el('<textarea id="care-req" rows="3" placeholder="예: 도어 하부 PPF 추가 부탁드립니다"></textarea>'); ta.value = d.customRequest; ta.addEventListener('input', () => { d.customRequest = ta.value; });
      sec('요청사항 (선택)', ta);
      body.appendChild(el('<div class="summary-line"><span>참고 견적(기본+옵션 합)</span><span id="care-sugg">' + esc(won(suggested)) + '</span></div>'));
      body.appendChild(el('<div class="hint">실제 견적은 시공사가 요청사항까지 반영해 별도로 회신합니다.</div>'));
      const ok = el('<button type="button" class="btn btn-primary btn-auto" id="care-submit" style="margin-top:14px;">견적 요청하기 →</button>');
      const cancel = el('<button type="button" class="btn btn-outline btn-auto" id="care-cancel" style="margin-top:8px;">← 취소</button>');
      const err = el('<div class="vlp-error" role="alert" hidden></div>');
      body.appendChild(ok); body.appendChild(cancel); body.appendChild(err);
      function validate() { ok.disabled = !(d.reservationId && d.shopId); }
      validate();
      cancel.addEventListener('click', () => o.onCancel());
      ok.addEventListener('click', async () => {
        ok.disabled = true; err.hidden = true;
        try { const res = await V.api.care.request(d); o.onDone(res.careId); }
        catch (e) { err.textContent = U.errorText ? U.errorText(e) : String(e.message || e); err.hidden = false; ok.disabled = false; }
      });
    }
    paint();
    return w;
  }

  V.customerCare = { list, detail, newForm, row, badge, progressOf, nextOf, IDX, h: { LABEL, IDX, badge, steps, graphOf, progressOf, modeLabel, routeLabel, won, line, mmdd, card, chargeText, chargeRow, summaryCard, historyTab, titleOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.customerCare;
})(typeof window !== 'undefined' ? window : globalThis);
