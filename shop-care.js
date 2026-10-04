/* shop-care.js — 시공사 화면(구성안 5.3): 할 일 큐(견적 요청 / 입고 대기 / 작업 중 / 검수 대기 / 이의 대응 / 출차·완료) + 건 목록 + 건 상세(개요·진행·이력).
 *  · 신차케어 건은 VLP.api.care.shop.* (잠정 계약, 목 전용)로만 다룬다. 신차인도 대리 인수 건은 shop-handover.js의 원천을 같은 목록(입고 대기)에 합친다.
 *  · 고객 화면(customer-care.js)의 도우미(V.customerCare.h)를 같이 써서 단계 그래프·계약 요약·이력 형식을 맞춘다. */
(function (g) {
  'use strict';
  const V = g.VLP; const U = V.ui; const esc = U.esc;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const cfg = (k) => V.config.get(k);
  const H = () => V.customerCare.h;
  const api = () => V.api.care.shop;
  const wide = () => g.matchMedia && g.matchMedia('(min-width: 768px)').matches;

  // ---------- 분류·문구 ----------
  function queueOf(it) {
    switch (it.phase) {
      case 'REQUESTED': case 'QUOTED': return 'quote';
      case 'CONFIRMED': return 'intake';
      case 'RECEIVED': case 'WORKING': case 'INSPECTING': return 'work';
      case 'CUSTOMER_INSPECT': return 'inspect';
      case 'REWORK': case 'ESCALATED': return 'dispute';
      default: return 'out';
    }
  }
  const SHOP_LABEL = { QUOTED: ['고객 확인 대기', 'wait'], CONFIRMED: ['입고 대기', 'wait'], INSPECTING: ['작업 완료', 'info'], CUSTOMER_INSPECT: ['고객 검수 대기', 'wait'], RELEASED: ['출차 완료', 'info'], READY_TO_RECEIVE: ['수령 대기', 'wait'] };
  function badge(it) { const l = SHOP_LABEL[it.phase] || H().LABEL[it.phase] || ['-', 'info']; return '<span class="badge ' + l[1] + '">' + esc(l[0]) + '</span>'; }
  const VISIT = (it) => it.receiveMode !== 'SHOP_DELIVERY';
  function nextOf(it) {
    switch (it.phase) {
      case 'REQUESTED': return '고객 요청을 확인하고 최종 견적을 회신해 주세요.';
      case 'QUOTED': return '견적을 회신했어요. 고객이 확인하면 계약이 완료돼요.';
      case 'CONFIRMED': return '차량이 입고되면 입고 확인(필수 촬영 ' + (cfg('careIntakeShots') || []).length + '컷)을 기록해 주세요.';
      case 'RECEIVED': return '입고 확인이 끝났어요. 작업을 시작해 주세요.';
      case 'WORKING': return '작업이 끝나면 "작업 완료"를 눌러 주세요. 현장 사진을 올릴 수 있어요.';
      case 'INSPECTING': return '청구(추가 금액·사유)를 정리하고 검수를 요청해 주세요.';
      case 'CUSTOMER_INSPECT': return '고객 검수를 기다리고 있어요.';
      case 'REWORK': return '고객이 이의를 냈어요(' + (it.disputeRounds || 1) + '/' + (it.disputeMaxRounds || '-') + '회째)' + (it.disputeReason ? ' 사유: ' + it.disputeReason : '') + '. 보완한 뒤 재검수를 요청해 주세요.';
      case 'ESCALATED': return '이의 가능 횟수를 넘어 운영자가 중재하고 있어요. 결과를 기다려 주세요.';
      case 'RELEASED': return VISIT(it) ? '고객이 출차를 승인했어요. 수령 준비가 되면 알려 주세요.' : '고객이 출차를 승인했어요. 고객에게 배송을 시작해 주세요.';
      case 'READY_TO_RECEIVE': return it.delivering ? '고객에게 배송 중이에요' + (it.destination ? '(도착지: ' + it.destination + ')' : '') + '. 도착하면 고객이 수령을 확인해요.' : '고객의 수령 확인을 기다리고 있어요.';
      case 'PRICE_CHECK': return '고객이 수령했어요. 정찰제 확인을 기다려요.';
      case 'DISPUTED': return '고객이 추가 요금을 제보했어요. 운영자가 확인해요.';
      case 'RATE': return '정찰제 이행이 확인됐어요. 고객 평가를 기다려요.';
      case 'DONE': return '모든 과정이 끝났어요.';
      default: return '';
    }
  }
  const titleOf = (it) => (it.vehicleModel || '차종 미입력') + (it.customer && it.customer.name ? ' · ' + it.customer.name : '');
  const urgentOf = (it) => ({ REQUESTED: '견적 회신 필요', CONFIRMED: '입고 확인 필요', RECEIVED: '작업 시작 필요', INSPECTING: '검수 요청 필요', REWORK: '보완 필요', RELEASED: VISIT(it) ? '수령 준비 필요' : '배송 시작 필요' }[it.phase] || '');

  // ---------- 사진 도우미 ----------
  // 폰 사진은 용량이 커서 저장소(목)가 금방 찬다 — 긴 변 960px, JPEG로 줄여 담는다.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('사진을 읽지 못했습니다'));
      fr.onload = () => {
        const raw = String(fr.result);
        const img = new Image();
        img.onerror = () => resolve(raw);
        img.onload = () => {
          try {
            const k = Math.min(1, 960 / Math.max(img.width, img.height)); if (k === 1 && raw.length < 300000) { resolve(raw); return; }
            const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.72));
          } catch (e) { resolve(raw); }
        };
        img.src = raw;
      };
      fr.readAsDataURL(file);
    });
  }
  const sample = (i, label) => (typeof g.generateSamplePhoto === 'function' ? g.generateSamplePhoto(i, label) : '');
  const fail = (e) => U.toast(U.errorText ? U.errorText(e) : String(e.message || e), 'error');

  // ---------- 입고 확인 시트(필수 촬영 + 입고 경로 + 주행거리 선택) ----------
  function intakeSheet(it, ctx) {
    const shots = cfg('careIntakeShots') || []; const got = {};
    const routes = cfg('careIntakeRoutes') || [];
    const w = el('<div class="care-sheet sc-intake"><p class="hint">차량이 도착하면 아래 사진을 모두 찍어 주세요. 모두 찍어야 [입고 확인]이 켜져요.</p><label for="sc-route">입고 경로</label><select id="sc-route"></select><div class="sc-shots"></div><label for="sc-km">주행거리 (km, 선택)</label><input id="sc-km" type="number" min="0" step="1" inputmode="numeric" placeholder="예: 12"><div class="btn-row"><button type="button" class="btn btn-sm" id="sc-sample-all">시연용 샘플로 채우기</button></div><button type="button" class="btn btn-primary btn-auto" id="sc-intake-ok" disabled>입고 확인</button><div class="vlp-error" role="alert" hidden></div></div>');
    const sel = w.querySelector('#sc-route'); routes.forEach((r) => { const o = document.createElement('option'); o.value = r.code; o.textContent = r.label; sel.appendChild(o); }); sel.value = cfg('careDefaultIntakeRoute');
    const ok = w.querySelector('#sc-intake-ok'), box = w.querySelector('.sc-shots'), err = w.querySelector('.vlp-error');
    const rows = {};
    function sync() { const n = shots.filter((s) => got[s]).length; ok.disabled = n < shots.length; ok.textContent = n < shots.length ? '입고 확인 (' + n + '/' + shots.length + ')' : '입고 확인'; shots.forEach((s) => { const r = rows[s]; r.dataset.state = got[s] ? 'DONE' : 'NONE'; r.querySelector('.sc-shot-st').textContent = got[s] ? '✓ 촬영됨' : '필요'; const im = r.querySelector('img'); if (got[s]) { im.src = got[s]; im.hidden = false; } else im.hidden = true; }); }
    shots.forEach((s, i) => {
      const r = el('<div class="sc-shot"><b class="sc-shot-n"></b><span class="sc-shot-st hint"></span><img alt="" hidden><label class="btn btn-sm sc-shot-pick">촬영<input type="file" accept="image/*" capture="environment" class="sc-shot-in" hidden></label></div>');
      r.dataset.shot = s; r.querySelector('.sc-shot-n').textContent = s; r.querySelector('img').alt = s + ' 사진';
      r.querySelector('input').addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { got[s] = await shrink(f); sync(); } catch (x) { fail(x); } });
      rows[s] = r; box.appendChild(r);
    });
    w.querySelector('#sc-sample-all').addEventListener('click', () => { shots.forEach((s, i) => { got[s] = sample(i, s); }); sync(); });
    ok.addEventListener('click', async () => {
      ok.disabled = true; err.hidden = true;
      try { await api().confirmIntake(ctx.shopId, it.careId, { route: sel.value, mileage: w.querySelector('#sc-km').value, shots: shots.map((s) => ({ label: s, src: got[s] })) }); if (ctx.close) ctx.close(); ctx.refresh(); }
      catch (e) { err.textContent = U.errorText ? U.errorText(e) : String(e.message || e); err.hidden = false; ok.disabled = false; }
    });
    sync(); return w;
  }

  // ---------- 견적 회신 시트 ----------
  function quoteSheet(it, ctx) {
    const w = el('<div class="care-sheet"><div class="summary-line"><span>참고 견적(기본+옵션 합)</span><span class="sc-sugg"></span></div><div class="msg-box sc-req" hidden></div><label for="sc-price">최종 견적가 (원)</label><input id="sc-price" type="number" min="0" step="10000"><button type="button" class="btn btn-primary btn-auto" id="sc-quote-send">견적 회신하기</button><div class="vlp-error" role="alert" hidden></div></div>');
    w.querySelector('.sc-sugg').textContent = H().won(it.suggestedPrice);
    if (it.customRequest) { const r = w.querySelector('.sc-req'); r.hidden = false; r.innerHTML = '<b>고객 요청사항</b><br>'; r.appendChild(document.createTextNode(it.customRequest)); }
    const inp = w.querySelector('#sc-price'); inp.value = it.suggestedPrice || 0;
    const err = w.querySelector('.vlp-error'), b = w.querySelector('#sc-quote-send');
    b.addEventListener('click', async () => { b.disabled = true; err.hidden = true; try { await api().respondQuote(ctx.shopId, it.careId, inp.value); if (ctx.close) ctx.close(); ctx.refresh(); } catch (e) { err.textContent = U.errorText ? U.errorText(e) : String(e.message || e); err.hidden = false; b.disabled = false; } });
    return w;
  }

  // ---------- 상세 탭 ----------
  const chargeDrafts = {};
  const draftOf = (id) => chargeDrafts[id] || (chargeDrafts[id] = { extra: '', note: '' });
  function overviewTab(it) {
    const h = H(); const w = el('<div class="vlp-ov"></div>');
    w.appendChild(h.summaryCard(it));
    if (it.customRequest) { const c = h.card('고객 요청사항', ''); c.querySelector('p').textContent = it.customRequest; w.appendChild(c); }
    const info = el('<div class="vlp-cd sc-info"><h4>시공 정보</h4><div class="vlp-fields"></div></div>');
    info.querySelector('.vlp-fields').innerHTML = h.line('고객', [it.customer.name, it.customer.phone ? U.formatPhone(it.customer.phone) : ''].filter(Boolean).join(' · ') || '-') + h.line('입고 경로', it.intakeRoute ? h.routeLabel(it.intakeRoute) : '입고 후 표시') + h.line('주행거리', it.mileage != null ? Number(it.mileage).toLocaleString('ko-KR') + ' km' : (it.intakeRoute ? '미입력' : '입고 후 표시')) + h.line('수령 방식', h.modeLabel(it.receiveMode));
    w.appendChild(info);
    const pc = it.priceMatch === true ? '정찰제 확인: 견적과 청구가 일치했어요' : (it.priceMatch === false ? '정찰제 확인: 추가금 제보가 접수됐어요' : '견적 = 청구 여부는 완료 후 확인합니다');
    w.appendChild(h.card('정찰제', U.esc(pc)));
    return w;
  }
  function stepList(it) {
    const h = H(); const i = h.IDX[it.phase];
    const st = (k) => (i >= 5 || k < i ? 'done' : (k === i ? 'cur' : 'todo'));
    const intake = (it.log.find((l) => /^입고 확인/.test(l.msg)) || {}).t;
    const nodes = [];
    nodes.push({ s: st(0), t: '입고 확인', sub: ((intake ? h.mmdd(intake) : '') + (it.intakeRoute ? ' · ' + h.routeLabel(it.intakeRoute) : '')).replace(/^ · /, '') });
    if (it.intakePhotos.length) nodes.push({ s: st(0), t: '사전 촬영', sub: it.intakePhotos.length + '장' });
    nodes.push({ s: st(1), t: i === 1 ? '작업 중' : '작업', sub: it.photos.length ? '현장 사진 ' + it.photos.length : '' });
    nodes.push({ s: st(2), t: '검수 요청', sub: it.phase === 'REWORK' ? '보완 중' : (it.phase === 'ESCALATED' ? '운영자 중재 중' : '') });
    nodes.push({ s: st(3), t: '출차' }); nodes.push({ s: st(4), t: '수령 확인', sub: h.modeLabel(it.receiveMode) });
    const box = el('<div class="vlp-cd"><h4>진행</h4></div>'); box.appendChild(V.delivery.stepper(nodes, '신차케어 진행 순서'));
    return box;
  }
  function photoCard(it, ctx) {
    const max = cfg('careMaxPhotos') || 3; const editable = ['WORKING', 'INSPECTING', 'REWORK'].includes(it.phase);
    const card = el('<div class="vlp-cd sc-photos"><h4></h4><div class="care-photos"></div></div>');
    card.querySelector('h4').textContent = '현장 사진 (' + it.photos.length + '/' + max + ')';
    const strip = card.querySelector('.care-photos');
    if (!it.photos.length) strip.appendChild(el('<div class="hint">아직 등록된 사진이 없습니다</div>'));
    // 회수는 서버의 사진 번호(회수 표시된 것 포함)로 지정해야 하므로 원본 순서를 다시 계산한다
    it.photos.forEach((p, k) => {
      const f = el('<figure class="care-photo"><img alt=""><figcaption class="hint"></figcaption></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = p.label || '현장 사진'; f.querySelector('figcaption').textContent = p.label || '';
      if (editable) { const b = el('<button type="button" class="btn btn-sm sc-withdraw">회수(내리기)</button>'); b.dataset.k = String(k); b.addEventListener('click', () => ctx.act(() => api().withdrawPhoto(ctx.shopId, it.careId, ctx.rawIndex(it, k)))); f.appendChild(b); }
      strip.appendChild(f);
    });
    if (editable) {
      const full = it.photos.length >= max;
      const row = el('<div class="btn-row" style="margin-top:8px;"><label class="btn btn-sm sc-cam' + (full ? ' disabled' : '') + '">📷 촬영<input type="file" accept="image/*" capture="environment" hidden ' + (full ? 'disabled' : '') + '></label><label class="btn btn-sm sc-file' + (full ? ' disabled' : '') + '">🖼 파일 선택<input type="file" accept="image/*" hidden ' + (full ? 'disabled' : '') + '></label><button type="button" class="btn btn-sm sc-sample" ' + (full ? 'disabled' : '') + '>샘플 추가(시연)</button></div>');
      row.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (!f || !f.type.startsWith('image/')) return; try { const src = await shrink(f); await ctx.act(() => api().addPhoto(ctx.shopId, it.careId, src, f.name)); } catch (e) { fail(e); } }));
      row.querySelector('.sc-sample').addEventListener('click', () => ctx.act(() => api().addPhoto(ctx.shopId, it.careId, null, null)));
      card.appendChild(row);
    }
    return card;
  }
  function intakePhotoCard(it) {
    if (!it.intakePhotos.length) return null;
    const card = el('<div class="vlp-cd"><h4>사전 촬영 (' + it.intakePhotos.length + '장)</h4><div class="care-photos"></div></div>');
    it.intakePhotos.forEach((p) => { const f = el('<figure class="care-photo"><img alt=""><figcaption class="hint"></figcaption></figure>'); f.querySelector('img').src = p.src || ''; f.querySelector('img').alt = p.label + ' 사진'; f.querySelector('figcaption').textContent = p.label; card.querySelector('.care-photos').appendChild(f); });
    return card;
  }
  function chargeCard(it) {
    const h = H(); const card = el('<div class="vlp-cd sc-charge"><h4>청구</h4></div>');
    if (it.phase === 'INSPECTING') {
      const d = draftOf(it.careId);
      const f = el('<div class="care-sheet"><div class="summary-line"><span>기본 금액 (사전 견적가)</span><span></span></div><label for="sc-extra">추가 금액 (선택, 원)</label><input id="sc-extra" type="number" min="0" step="10000" inputmode="numeric"><label for="sc-note">추가 사유·작업 내역 (선택)</label><textarea id="sc-note" rows="2" placeholder="예: 후면 추가 PPF 시공"></textarea><div class="summary-line"><span>합계 청구액</span><span id="sc-total"></span></div></div>');
      f.querySelector('.summary-line span:last-child').textContent = h.won(it.quotedPrice);
      const ex = f.querySelector('#sc-extra'), nt = f.querySelector('#sc-note'), tot = f.querySelector('#sc-total');
      ex.value = d.extra; nt.value = d.note;
      const upd = () => { tot.textContent = h.won((it.quotedPrice || 0) + Math.max(0, parseInt(d.extra, 10) || 0)); };
      ex.addEventListener('input', () => { d.extra = ex.value; upd(); }); nt.addEventListener('input', () => { d.note = nt.value; }); upd();
      card.appendChild(f);
    } else card.appendChild(h.chargeRow(it));
    return card;
  }
  // 구형 화면에 있던 안내: 고객 이의(횟수·사유·중재 여부), 고객에게 배송 중(도착지)
  function noticeCards(it) {
    const h = H(); const out = [];
    if (it.disputed && ['REWORK', 'ESCALATED', 'DISPUTED'].includes(it.phase)) {
      const c = h.card('고객 이의 (' + (it.disputeRounds || 1) + '/' + (it.disputeMaxRounds || '-') + '회째)', '');
      c.classList.add('sc-dispute'); c.querySelector('p').textContent = (it.disputeReason ? '사유: ' + it.disputeReason : '사유가 입력되지 않았어요.') + (it.escalated ? ' · 이의 가능 횟수를 넘어 운영자가 중재하고 있어요.' : ' · 보완한 뒤 재검수를 요청해 주세요.'); out.push(c);
    }
    if (it.delivering) { const c = h.card('고객에게 배송 중', ''); c.classList.add('sc-delivering'); c.querySelector('p').textContent = (it.destination ? '도착지: ' + it.destination + ' · ' : '') + '도착하면 고객이 수령을 확인해요.'; out.push(c); }
    return out;
  }
  function progressTab(it, ctx) {
    const w = el('<div class="vlp-ov"></div>');
    noticeCards(it).forEach((c) => w.appendChild(c));
    w.appendChild(stepList(it));
    const ip = intakePhotoCard(it); if (ip) w.appendChild(ip);
    if (['WORKING', 'INSPECTING', 'REWORK', 'CUSTOMER_INSPECT', 'ESCALATED', 'RELEASED', 'READY_TO_RECEIVE'].includes(it.phase) || it.photos.length) w.appendChild(photoCard(it, ctx));
    if (it.quotedPrice != null) w.appendChild(chargeCard(it));
    return w;
  }

  // ---------- 상세 ----------
  function careDetail(it, ctx) {
    const h = H(); const c2 = Object.assign({}, ctx);
    const tabs = [
      { id: 'overview', label: '개요', render: () => overviewTab(it) },
      { id: 'progress', label: '진행', render: () => progressTab(it, c2) },
      { id: 'history', label: '이력', render: () => h.historyTab(it) },
    ];
    const opts = { role: 'shop', noGuide: true, contract: { contractId: it.careId, vehicleModel: titleOf(it) }, idx: 0, stateHTML: badge(it), next: nextOf(it), progress: h.progressOf(it), graphHTML: h.graphOf(it), steps: h.steps(), stepDescs: cfg('careStepDescriptions') || [], tabs, defaultTab: ['REQUESTED', 'QUOTED', 'CONFIRMED'].includes(it.phase) ? 'overview' : 'progress', onBack: ctx.onBack, aside: '', chatBadge: it.unreadChat || 0, onChat: (b) => V.chat.open(it.careId, { role: 'shop', api: api().chatFor(ctx.shopId), summary: titleOf(it) + ' · 고객', opener: b }) };
    const sheet = (label, build) => ({ label, title: label, open: (hh) => { const body = build(it, Object.assign({}, ctx, { close: () => hh.close && hh.close() })); return body; } });
    const direct = (label, fn) => ({ label, direct: () => ctx.act(fn) });
    switch (it.phase) {
      case 'REQUESTED': opts.primary = sheet('견적 회신', quoteSheet); break;
      case 'CONFIRMED': opts.primary = sheet('입고 확인', intakeSheet); break;
      case 'RECEIVED': opts.primary = direct('작업 시작', () => api().setStage(ctx.shopId, it.careId, '작업중')); break;
      case 'WORKING': opts.primary = direct('작업 완료', () => api().setStage(ctx.shopId, it.careId, '최종검수')); break;
      case 'INSPECTING': opts.primary = direct('검수 요청', () => { const d = draftOf(it.careId); return api().requestInspection(ctx.shopId, it.careId, d.extra, d.note).then((r) => { delete chargeDrafts[it.careId]; return r; }); }); break;
      case 'REWORK': opts.primary = direct('보완 완료 · 재검수 요청', () => api().completeRework(ctx.shopId, it.careId)); break;
      case 'RELEASED': opts.primary = direct(VISIT(it) ? '수령 준비 완료' : '배송 시작', () => api().handOut(ctx.shopId, it.careId)); break;
      default: break;
    }
    opts.more = [{ label: '고객에게 메시지', direct: (b) => opts.onChat(b) }];
    const root = V.caseView.detail(opts);
    root.classList.add('vlp-care-case', 'vlp-shop-case'); root.dataset.careId = it.careId; root.dataset.phase = it.phase;
    return root;
  }

  // ---------- 화면(목록 + 상세) ----------
  function render(shop, o) {
    o = o || {};
    const shopId = shop.id; const route = V.caseView.route;
    const root = el('<div class="vlp-app vlp-app-shop"><div class="vlp-app-strip"></div><div class="vlp-app-list"></div><div class="vlp-app-detail"></div></div>');
    const stripEl = root.querySelector('.vlp-app-strip'), listEl = root.querySelector('.vlp-app-list'), detailEl = root.querySelector('.vlp-app-detail');
    const ho = V.shopFlow ? V.shopFlow.source(shopId) : null;
    let care = [], queue = '', cur = null, lastSig = null, loaded = false, busy = false;

    const unified = () => {
      const items = care.map((it) => ({ id: it.careId, kind: 'care', q: queueOf(it), it }));
      if (ho) ho.st.rows.forEach((c) => { const d = ho.st.dels[c.contractId]; items.unshift({ id: c.contractId, kind: 'handover', q: d.storageState === 'DELIVERED' ? 'out' : 'intake', c }); });
      return items;
    };
    const ctx = {
      shopId, rawIndex: (it, k) => it.photos[k].idx,
      refresh: () => load(true),
      act: async (fn) => { if (busy) return; busy = true; try { await fn(); await load(true); } catch (e) { fail(e); } finally { busy = false; } },
      onBack: () => route.clear(),
    };

    function paintList(items, activeId) {
      listEl.innerHTML = ''; stripEl.innerHTML = '';
      const hd = el('<div class="vlp-pane-head"><h2>할 일</h2></div>');
      if (o.onLogout) { const b = el('<button type="button" class="btn btn-outline btn-sm" id="sc-logout">로그아웃</button>'); b.addEventListener('click', o.onLogout); hd.appendChild(b); }
      stripEl.appendChild(hd);
      const qs = cfg('careShopQueues') || [];
      const chips = el('<div class="vlp-chip-row sc-queues" role="group" aria-label="할 일 큐"></div>');
      const mk = (id, label, n) => { const b = el('<button type="button" class="vlp-chip"></button>'); b.dataset.queue = id; b.textContent = label + ' ' + n; b.setAttribute('aria-pressed', queue === id ? 'true' : 'false'); b.addEventListener('click', () => { queue = queue === id ? '' : id; paint(); }); chips.appendChild(b); };
      mk('', '전체', items.length); qs.forEach((q) => mk(q.id, q.label, items.filter((x) => x.q === q.id).length));
      stripEl.appendChild(chips);
      const shown = queue ? items.filter((x) => x.q === queue) : items;
      if (!shown.length) listEl.appendChild(el('<div class="empty-state"><div class="big">📭</div>' + (queue ? '이 큐에는 건이 없습니다.' : '아직 들어온 건이 없습니다.') + '</div>'));
      shown.forEach((x) => {
        if (x.kind === 'handover') { listEl.appendChild(ho.rowFor(x.c, x.id === activeId, (id) => route.set(id))); return; }
        const it = x.it; const r = el('<button type="button" class="vlp-case-row"><span class="vlp-row-top"><b class="vlp-row-title"></b><span class="vlp-row-badge"></span></span><span class="hint vlp-row-sub"></span><span class="vlp-row-prog"></span></button>');
        r.dataset.careId = it.careId; if (urgentOf(it)) r.classList.add('urgent'); if (x.id === activeId) { r.classList.add('on'); r.setAttribute('aria-current', 'true'); }
        r.querySelector('.vlp-row-title').textContent = titleOf(it); r.querySelector('.vlp-row-badge').innerHTML = badge(it);
        r.querySelector('.vlp-row-sub').textContent = it.careId + ' · ' + (it.package ? it.package.name : '');
        r.querySelector('.vlp-row-prog').textContent = (it.unreadChat ? '💬 새 메시지 ' + it.unreadChat + ' · ' : '') + (urgentOf(it) ? urgentOf(it) + ' · ' : '') + H().progressOf(it);
        r.addEventListener('click', () => route.set(it.careId)); listEl.appendChild(r);
      });
    }
    function paint() {
      if (!loaded) return;
      if (cur && cur.__off) cur.__off();
      const items = unified(); let id = route.get(); let x = id && items.find((i) => i.id === id);
      if (!x && wide() && items.length) { const pool = queue ? items.filter((i) => i.q === queue) : items; x = pool[0] || null; id = x ? x.id : null; }
      root.classList.toggle('has-case', !!x); detailEl.innerHTML = '';
      paintList(items, id);
      if (!x) { cur = null; if (items.length) detailEl.appendChild(el('<div class="vlp-empty-detail hint">왼쪽에서 건을 선택해 주세요.</div>')); return; }
      cur = x.kind === 'care' ? careDetail(x.it, ctx) : ho.detail(x.c, { onBack: ctx.onBack, reload: () => load(true) });
      detailEl.appendChild(cur);
    }
    async function load(force) {
      try {
        const [res, hch] = await Promise.all([api().list(shopId), ho ? ho.load(force) : Promise.resolve(false)]);
        const sig = JSON.stringify([res.items, ho ? ho.st.rows.map((c) => (ho.st.dels[c.contractId] || {}).storageState) : null]);
        if (!force && loaded && sig === lastSig && !hch) return;
        lastSig = sig; care = res.items; loaded = true; paint();
      } catch (e) { if (!loaded) { listEl.innerHTML = ''; listEl.appendChild(el('<div class="vlp-error" role="alert"></div>')).textContent = U.errorText ? U.errorText(e) : String(e.message || e); } }
    }
    g.addEventListener('vlp-route', () => { if (document.body.contains(root)) paint(); });
    load(true);
    const t = setInterval(() => { if (!document.body.contains(root)) { clearInterval(t); return; } if (!document.querySelector('.vlp-sheet') && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) load(false); }, cfg('pollIntervalMs'));
    root.__refresh = () => load(false);
    return root;
  }
  V.shopCare = { render, queueOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.shopCare;
})(typeof window !== 'undefined' ? window : globalThis);
