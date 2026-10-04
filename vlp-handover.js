/* vlp-handover.js — S3 인수 화면 부품.
 *  PWA-19 카마스터 개인수령확인 · PWA-20 고객 최종 승인(현장/원격, 사진 열람 추적, 검수 FAIL 사유) ·
 *  PWA-21 시공사 대리 인수(필수 촬영 6컷) · PWA-22 평가(인도 종결 후 언제든).
 * 서버 호출은 VLP.api(facade)만. 사진 올리기는 업로드 큐(upload-queue.js)가 한다. */
(function (g) {
  'use strict';
  const V = g.VLP, U = V.ui, esc = U.esc;
  const el = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  const setText = (n, t) => { n.textContent = t; return n; };
  const SUB = {
    PHOTOS_NOT_VIEWED: '인수 사진을 모두 열어 본 뒤에 원격 승인할 수 있어요.',
    PROXY_RECEIPT_REQUIRED: '시공사의 대리 인수 기록이 아직 없어요.',
    REMOTE_NOT_ALLOWED: '원격 승인은 대리 인수를 맡긴 건에서만 가능해요.',
    INSPECTION_FAIL_OVERRIDE_REQUIRED: '검수에서 불합격 항목이 있어 사유를 적어야 승인할 수 있어요.',
    SHOTS_INCOMPLETE: '필수 촬영이 아직 끝나지 않았어요.',
  };
  const errMsg = (e) => (e && e.details && SUB[e.details.subcode]) || U.errorText(e);
  const viewedKey = (deliveryId) => 'vlp_viewed_' + deliveryId;
  const getViewed = (id) => { try { return new Set(JSON.parse(g.localStorage.getItem(viewedKey(id)) || '[]')); } catch (e) { return new Set(); } };
  const addViewed = (id, mid) => { const s = getViewed(id); s.add(mid); try { g.localStorage.setItem(viewedKey(id), JSON.stringify(Array.from(s))); } catch (e) { /* 무시 */ } };

  // ---------- 공용: 사진 줄 + 큰 보기 ----------
  function photoStrip(h, deliveryId, onViewed) {
    const media = h.media || [], viewed = getViewed(deliveryId);
    const box = el('<div class="vlp-photos"><div class="vlp-sub-title vlp-photos-title"></div><div class="vlp-photos-row"></div></div>');
    box.querySelector('.vlp-photos-title').textContent = '인수 사진 ' + media.length + '장' + (media.length ? ' · 열람 ' + media.filter((m) => viewed.has(m.mediaId)).length + '/' + media.length : '');
    const row = box.querySelector('.vlp-photos-row');
    if (!media.length) row.appendChild(el('<div class="hint">아직 사진이 없어요.</div>'));
    media.forEach((m, i) => {
      const b = el('<button type="button" class="vlp-photo" aria-label=""><img alt=""><span class="vlp-photo-mark" aria-hidden="true"></span></button>');
      b.dataset.mediaId = m.mediaId; b.setAttribute('aria-label', (m.slot ? V.capture.labelOf(m.slot) : '사진') + ' 크게 보기' + (viewed.has(m.mediaId) ? ' (열람함)' : ''));
      const src = V.api.mediaSrc(m); const img = b.querySelector('img'); if (src) img.src = src; img.alt = m.slot ? V.capture.labelOf(m.slot) : '인수 사진';
      b.querySelector('.vlp-photo-mark').textContent = viewed.has(m.mediaId) ? '✔' : '';
      b.addEventListener('click', () => {
        const body = el('<div class="vlp-viewer"><img class="vlp-viewer-img" alt=""><div class="hint vlp-viewer-cap"></div></div>');
        const big = body.querySelector('img'); if (src) big.src = src; big.alt = img.alt; body.querySelector('.vlp-viewer-cap').textContent = img.alt + ' (' + (i + 1) + '/' + media.length + ')';
        addViewed(deliveryId, m.mediaId); V.delivery.openSheet('인수 사진', body, b, onViewed); // 열어 보면 열람으로 친다
      });
      row.appendChild(b);
    });
    return box;
  }
  const flag = (ok, t) => '<li class="vlp-chk ' + (ok ? 'ok' : 'wait') + '"><span aria-hidden="true">' + (ok ? '✔' : '○') + '</span> ' + esc(t) + '<span class="vlp-chk-mark">' + (ok ? ' 완료' : ' 대기') + '</span></li>';

  // ---------- PWA-19 카마스터: 개인수령확인 ----------
  function karmasterPanel(delivery, ctx) {
    ctx = ctx || {}; const q = ctx.queue || V.uploadQueue.shared();
    const wrap = el('<div class="vlp-hand vlp-hand-km"><div class="vlp-sub-title">인수 확인</div><div class="vlp-hand-body hint">불러오는 중…</div></div>');
    const body = wrap.querySelector('.vlp-hand-body');
    async function refresh() {
      try { delivery = await V.api.deliveries.get(delivery.deliveryId); } catch (e) { /* 이전 값으로 */ } // 시트처럼 오래 열려 있어도 최신 상태로
      let h; try { h = await V.api.handover.get(delivery.deliveryId); } catch (e) { body.textContent = U.errorText(e); return; }
      body.className = 'vlp-hand-body'; body.innerHTML = '';
      const proxy = delivery.receiptMode === 'REMOTE_PROXY';
      body.appendChild(el('<ul class="vlp-checks">' + flag(!!h.managerConfirmedAt, '카마스터 인도 확인') + (proxy ? flag(h.receiverType === 'PROXY_INSTALLER', '시공사 대리 인수 기록') : '') + flag(!!h.customerApprovedAt, '고객 최종 승인') + '</ul>'));
      body.appendChild(photoStrip(h, delivery.deliveryId));
      const done = delivery.storageState === 'DELIVERED';
      if (done) { body.appendChild(el('<div class="vlp-hand-done" role="status">✔ 인도가 종결되었습니다.</div>')); return; }
      if (delivery.storageState !== 'ARRIVED') { body.appendChild(el('<div class="hint">차량이 도착하면 인도 확인을 할 수 있어요.</div>')); return; }
      // 현장 사진 추가(선택): 업로드 큐로 보관 후 올림
      const more = el('<details class="vlp-more"><summary>현장 사진 추가 (선택)</summary></details>');
      more.appendChild(V.capture.slotGrid({ deliveryId: delivery.deliveryId, purpose: 'INTAKE', slots: ['_'], queue: q, onDone: refresh })); body.appendChild(more);
      if (!h.managerConfirmedAt) {
        const err = el('<div class="vlp-error" role="alert" hidden></div>');
        const b = el('<button type="button" class="btn btn-primary btn-sm vlp-km-confirm">인도 확인 (차량을 직접 확인했습니다)</button>');
        b.addEventListener('click', async () => { b.disabled = true; try { await V.api.handover.managerConfirm(delivery.deliveryId); await refresh(); if (ctx.onChange) ctx.onChange(); } catch (e) { err.textContent = errMsg(e); err.hidden = false; b.disabled = false; } });
        body.appendChild(b); body.appendChild(err); body.appendChild(el('<div class="hint">고객이 최종 승인하기 전에는 인도가 종결되지 않아요.</div>'));
      } else body.appendChild(el('<div class="hint">확인했어요. 고객의 최종 승인을 기다리고 있어요.</div>'));
    }
    refresh(); wrap.__refresh = refresh; return wrap;
  }

  // ---------- PWA-20 고객: 최종 승인 + PWA-22 평가 ----------
  function customerPanel(delivery, ctx) {
    ctx = ctx || {};
    const wrap = el('<div class="vlp-hand vlp-hand-cust"><div class="vlp-sub-title">인수 확인</div><div class="vlp-hand-body hint">불러오는 중…</div></div>');
    const body = wrap.querySelector('.vlp-hand-body');
    async function refresh() {
      try { delivery = await V.api.deliveries.get(delivery.deliveryId); } catch (e) { /* 이전 값으로 */ } // 시트처럼 오래 열려 있어도 최신 상태로
      let h; try { h = await V.api.handover.get(delivery.deliveryId); } catch (e) { body.textContent = U.errorText(e); return; }
      const proxy = delivery.receiptMode === 'REMOTE_PROXY', closed = delivery.storageState === 'DELIVERED';
      body.className = 'vlp-hand-body'; body.innerHTML = '';
      const host = closed ? el('<div hidden></div>') : body; // 종결 후 기록은 이력 탭 상단 '인수 기록' 카드(recordCard)에서 본다
      host.appendChild(el('<ul class="vlp-checks">' + flag(!!h.managerConfirmedAt, '카마스터 인도 확인') + (proxy ? flag(h.receiverType === 'PROXY_INSTALLER', '시공사 대리 인수 기록') : '') + flag(!!h.customerApprovedAt, '내 최종 승인') + '</ul>'));
      host.appendChild(photoStrip(h, delivery.deliveryId, refresh));
      const insp = h.inspectionItems || [];
      if (insp.length) { const ul = el('<ul class="vlp-insp"></ul>'); insp.forEach((i) => { const li = el('<li><span class="vlp-insp-item"></span> <span class="badge vlp-insp-res"></span></li>'); li.dataset.result = i.result; li.querySelector('.vlp-insp-item').textContent = i.item; li.querySelector('.vlp-insp-res').textContent = i.result === 'PASS' ? '합격' : i.result === 'FAIL' ? '▲ 불합격' : '해당 없음'; ul.appendChild(li); }); host.appendChild(el('<div class="vlp-sub-title">검수 항목</div>')); host.appendChild(ul); }
      if (closed || h.customerApprovedAt && closed) { body.appendChild(el('<div class="vlp-hand-done" role="status">✔ 인도가 종결되었습니다. 이용해 주셔서 감사합니다.</div>')); { const rb = el('<button type="button" class="btn btn-primary vlp-open-rating">평가 남기기</button>'); rb.addEventListener('click', () => openRating(delivery, ctx, rb)); body.appendChild(rb); } return; }
      if (delivery.storageState !== 'ARRIVED') { body.appendChild(el('<div class="hint">차량이 도착하면 인수 확인과 최종 승인을 할 수 있어요.</div>')); return; }
      if (h.customerApprovedAt) { body.appendChild(el('<div class="hint vlp-wait-km">승인했어요. 카마스터의 인도 확인이 끝나면 인도가 종결돼요.</div>')); return; }
      body.appendChild(approvalForm(delivery, h, ctx, refresh));
    }
    refresh(); wrap.__refresh = refresh; return wrap;
  }

  function approvalForm(delivery, h, ctx, refresh) {
    const proxy = delivery.receiptMode === 'REMOTE_PROXY', viewed = getViewed(delivery.deliveryId), media = h.media || [];
    const unseen = media.filter((m) => !viewed.has(m.mediaId));
    const fails = (h.inspectionItems || []).filter((i) => i.result === 'FAIL');
    const f = el(`<form class="vlp-approve-form" novalidate>
      <div class="vlp-sub-title">최종 승인</div>
      <fieldset class="vlp-fs"><legend>승인 방법</legend>
        <label class="vlp-radio"><input type="radio" name="approvalType" value="ON_SITE"> 현장 승인 (차량을 직접 보고 승인)</label>
        <label class="vlp-radio"><input type="radio" name="approvalType" value="REMOTE"> 원격 승인 (사진을 보고 승인)</label>
      </fieldset>
      <div class="hint vlp-why" role="status"></div>
      <div class="vlp-override" hidden><label>불합격 항목이 있어도 승인하는 사유 (필수)</label><textarea name="overrideReason" rows="2"></textarea></div>
      <label>메모 (선택)</label><input type="text" name="memo" autocomplete="off" aria-label="메모">
      <label>서명 (이름을 입력)</label><input type="text" name="signature" autocomplete="off" aria-label="서명(이름)">
      <button type="submit" class="btn btn-primary btn-sm vlp-approve-go" disabled>승인하기</button>
      <div class="vlp-error" role="alert" hidden></div>
    </form>`);
    const remoteRadio = f.querySelector('input[value=REMOTE]'), siteRadio = f.querySelector('input[value=ON_SITE]'), why = f.querySelector('.vlp-why'), go = f.querySelector('.vlp-approve-go'), err = f.querySelector('.vlp-error'), ov = f.querySelector('.vlp-override');
    function remoteBlock() { if (!proxy) return '원격 승인은 시공사 대리 인수를 맡긴 건에서만 할 수 있어요.'; if (!h.managerConfirmedAt) return '카마스터의 인도 확인이 끝나야 원격 승인할 수 있어요.'; if (h.receiverType !== 'PROXY_INSTALLER') return '시공사의 대리 인수 기록이 아직 없어요.'; if (unseen.length) return '인수 사진 ' + unseen.length + '장을 아직 열어 보지 않았어요. 모두 열어 본 뒤 승인할 수 있어요.'; return ''; }
    const rb = remoteBlock(); if (rb) { remoteRadio.disabled = true; remoteRadio.closest('label').classList.add('disabled'); }
    function sync() {
      const t = (f.querySelector('input[name=approvalType]:checked') || {}).value;
      ov.hidden = !(fails.length && t); why.textContent = t === 'REMOTE' ? '' : (t === 'ON_SITE' ? '' : (rb ? '원격 승인 불가: ' + rb : ''));
      go.disabled = !t || (fails.length && !f.elements.overrideReason.value.trim());
    }
    f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
    if (rb) why.textContent = '원격 승인 불가: ' + rb;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const t = (f.querySelector('input[name=approvalType]:checked') || {}).value; if (!t) return;
      const bodyReq = { approvalType: t, viewedMediaIds: Array.from(viewed) }; ['memo', 'signature', 'overrideReason'].forEach((k) => { const v = f.elements[k].value.trim(); if (v) bodyReq[k] = v; });
      go.disabled = true; err.hidden = true;
      try { await V.api.handover.customerApprove(delivery.deliveryId, bodyReq); await refresh(); if (ctx.onChange) ctx.onChange(); }
      catch (e) { err.textContent = errMsg(e); err.hidden = false; go.disabled = false; }
    });
    return f;
  }

  // ---------- 이력 탭 상단 '인수 기록' 카드: 인도 종결 후에도 사진·검수 결과·승인 정보를 다시 본다 ----------
  function recordCard(delivery) {
    const card = el('<div class="vlp-cd vlp-rec-card"><button type="button" class="vlp-rec-head" aria-expanded="false"><span class="vlp-rec-title">인수 기록</span><span class="vlp-rec-sum">불러오는 중…</span><span class="vlp-rec-caret" aria-hidden="true">▾</span></button><div class="vlp-rec-body" hidden></div></div>');
    const head = card.querySelector('.vlp-rec-head'), sum = card.querySelector('.vlp-rec-sum'), body = card.querySelector('.vlp-rec-body');
    head.addEventListener('click', () => { const open = body.hidden; body.hidden = !open; head.setAttribute('aria-expanded', String(open)); card.querySelector('.vlp-rec-caret').textContent = open ? '▴' : '▾'; });
    V.api.handover.get(delivery.deliveryId).then((h) => {
      const when = (t) => (t ? ' · ' + U.fmtDateTime(t) : '');
      const proxy = delivery.receiptMode === 'REMOTE_PROXY', insp = h.inspectionItems || [], fails = insp.filter((i) => i.result === 'FAIL').length, n = (h.media || []).length;
      sum.textContent = [delivery.storageState === 'DELIVERED' ? '인도 종결' : '진행 중', n ? '사진 ' + n + '장' : '', fails ? '▲ 검수 불합격 ' + fails + '건' : (insp.length ? '검수 합격' : '')].filter(Boolean).join(' · ');
      if (fails) sum.classList.add('warn');
      body.appendChild(el('<ul class="vlp-checks">' + flag(!!h.managerConfirmedAt, '카마스터 인도 확인' + when(h.managerConfirmedAt)) + (proxy ? flag(h.receiverType === 'PROXY_INSTALLER', '시공사 대리 인수 기록') : '') + flag(!!h.customerApprovedAt, '고객 최종 승인' + when(h.customerApprovedAt) + (h.approvalType ? ' (' + (h.approvalType === 'REMOTE' ? '원격' : '현장') + ')' : '')) + '</ul>'));
      body.appendChild(photoStrip(h, delivery.deliveryId));
      if (insp.length) { const ul = el('<ul class="vlp-insp"></ul>'); insp.forEach((i) => { const li = el('<li><span class="vlp-insp-item"></span> <span class="badge vlp-insp-res"></span></li>'); li.dataset.result = i.result; li.querySelector('.vlp-insp-item').textContent = i.item; li.querySelector('.vlp-insp-res').textContent = i.result === 'PASS' ? '합격' : i.result === 'FAIL' ? '▲ 불합격' : '해당 없음'; ul.appendChild(li); }); body.appendChild(el('<div class="vlp-sub-title">검수 항목</div>')); body.appendChild(ul); }
    }).catch((e) => { sum.textContent = U.errorText(e); });
    return card;
  }

  // ---------- PWA-22 평가: 인도 종결 이후 언제든 (목업 "평가" 화면: 별도 전체 화면, 제공자별 점수 + 한마디 + 제출) ----------
  const RATE_TYPE = { KARMASTER: '카마스터', SHOP: '옵션 시공 (사전시공)', DELIVERY_COMPANY: '탁송' };
  function ratingPanel(delivery, ctx) {
    ctx = ctx || {};
    const box = el('<div class="vlp-rate"><p class="hint vlp-rate-intro">인도 완료 · 서비스 제공자별로 평가합니다. 인도 후 언제든 남길 수 있어요. 제출한 평가는 수정할 수 없어요.</p><div class="vlp-rate-list"></div><label class="vlp-rate-cmt">한마디 (선택)<input type="text" name="comment" autocomplete="off"></label><div class="vlp-error" role="alert" hidden></div><div class="vlp-rate-done" role="status" hidden></div><div class="vlp-rate-bar"><button type="button" class="btn btn-primary vlp-rate-submit" disabled>평가 제출</button></div></div>');
    const list = box.querySelector('.vlp-rate-list'), key = 'vlp_rated_' + delivery.deliveryId;
    const rated = () => { try { return JSON.parse(g.localStorage.getItem(key) || '[]'); } catch (e) { return []; } };
    const dkey = 'vlp_rating_detail_' + delivery.deliveryId; // 기기 임시 보관(서버에서 내 평가를 읽는 API 협의 전 — D-56)
    const details = () => { try { return JSON.parse(g.localStorage.getItem(dkey) || '{}'); } catch (e) { return {}; } };
    const mark = (t, d) => { try { g.localStorage.setItem(key, JSON.stringify(rated().concat(t))); if (d) { const all = details(); all[t] = d; g.localStorage.setItem(dkey, JSON.stringify(all)); } } catch (e) { /* 무시 */ } };
    const submit = box.querySelector('.vlp-rate-submit'), err = box.querySelector('.vlp-error'), done = box.querySelector('.vlp-rate-done'), cmt = box.querySelector('input[name=comment]');
    const rows = [];
    // 평가 대상: 카마스터 · 탁송 · 사전시공 시공사 (인도 자체 평가는 대상 유형이 API에 없어 보류 — D-53)
    (delivery.ratingTargets || []).forEach((tg) => {
      const row = el('<section class="vlp-rate-row"><h4 class="vlp-rate-name"></h4><div class="vlp-rate-aspects"></div><div class="vlp-rate-state" hidden></div></section>');
      row.dataset.target = tg.targetType; row.querySelector('.vlp-rate-name').textContent = (RATE_TYPE[tg.targetType] || tg.targetType) + (tg.name && tg.targetType !== 'SHOP' ? ' · ' + tg.name : '');
      const aspects = ((V.config.get('ratingAspectsHandover') || {})[tg.targetType]) || (V.config.get('ratingAspects') || {})[tg.targetType] || []; const names = aspects.length ? aspects : ['전반 만족도'];
      const wrapA = row.querySelector('.vlp-rate-aspects');
      names.forEach((a, ai) => { const r = el('<div class="vlp-aspect"><span class="vlp-aspect-name"></span><span class="vlp-stars" role="radiogroup"></span></div>'); r.querySelector('.vlp-aspect-name').textContent = a; r.dataset.aspect = a; const st = r.querySelector('.vlp-stars'); st.setAttribute('aria-label', a); for (let n = 1; n <= 5; n++) st.appendChild(el('<label class="vlp-star"><input type="radio" value="' + n + '" name="' + tg.targetType + ai + '"><span>' + n + '</span></label>')); wrapA.appendChild(r); });
      const full = () => Array.from(wrapA.querySelectorAll('.vlp-aspect')).every((r) => r.querySelector('input:checked'));
      if (tg.targetType === 'DELIVERY_COMPANY') wrapA.parentNode.insertBefore(el('<p class="hint vlp-rate-pending">탁송 평가 항목은 정하는 중입니다 (아래는 예시)</p>'), wrapA);
      const lock = (t, d) => {
        const st = row.querySelector('.vlp-rate-state'); st.hidden = false; st.textContent = ''; wrapA.hidden = true; row.classList.add('rated');
        st.appendChild(el('<div class="vlp-rate-ok"></div>')).textContent = t;
        if (d && d.aspects) { const ul = el('<ul class="vlp-rate-ro"></ul>'); d.aspects.forEach((a) => { const li = el('<li><span></span><b></b></li>'); li.firstChild.textContent = a.aspect; li.lastChild.textContent = '★'.repeat(a.score) + '☆'.repeat(5 - a.score) + ' ' + a.score; ul.appendChild(li); }); st.appendChild(ul); }
        if (d && d.comment) { const q = el('<p class="vlp-rate-ro-cmt"></p>'); q.textContent = '“' + d.comment + '”'; st.appendChild(q); }
      };
      if (rated().includes(tg.targetType)) lock('✔ 평가를 남겼어요.', details()[tg.targetType]);
      rows.push({ tg, row, wrapA, full, lock, isOpen: () => !row.classList.contains('rated') });
      list.appendChild(row);
    });
    if (!rows.length) { list.appendChild(el('<div class="hint">평가할 대상이 없어요.</div>')); submit.hidden = true; cmt.parentElement.hidden = true; }
    const sync = () => { const open = rows.some((r) => r.isOpen()); submit.disabled = !rows.some((r) => r.isOpen() && r.full()); if (rows.length && !open) { submit.hidden = true; cmt.parentElement.hidden = true; box.classList.add('all-rated'); } };
    box.addEventListener('change', sync); sync();
    submit.addEventListener('click', async () => {
      submit.disabled = true; err.hidden = true; let pts = null, failed = false;
      for (const r of rows.filter((x) => x.isOpen() && x.full())) {
        const asp = Array.from(r.wrapA.querySelectorAll('.vlp-aspect')).map((a) => ({ aspect: a.dataset.aspect, score: parseInt(a.querySelector('input:checked').value, 10) }));
        const body = { targetType: r.tg.targetType, targetId: r.tg.targetId, deliveryId: delivery.deliveryId, aspects: asp }; const c = cmt.value.trim(); if (c) body.comment = c;
        try { await V.api.engagement.rate(body); const dd = { aspects: asp, comment: c || '' }; mark(r.tg.targetType, dd); r.lock('✔ 평가를 남겼어요.', dd); }
        catch (e) { if (e.status === 409) { mark(r.tg.targetType); r.lock('이미 평가했어요.'); } else { err.textContent = U.errorText(e); err.hidden = false; failed = true; } }
      }
      try { pts = await V.api.engagement.points(); } catch (e) { /* 무시 */ }
      if (ctx.onChange) ctx.onChange();
      if (!failed) { done.hidden = false; done.textContent = '✔ 평가가 접수되었습니다.' + (pts ? ' (포인트 ' + pts.balance + ')' : ''); }
      sync();
    });
    return box;
  }
  /** 평가 전체 화면: ← 평가 헤더 + 본문 스크롤 + 하단 제출 */
  function openRating(delivery, ctx, opener) {
    const scr = el('<div class="vlp-rate-screen" role="dialog" aria-modal="true" aria-label="평가" tabindex="-1"><header class="vlp-rate-hdr"><button type="button" class="vlp-rate-back" aria-label="뒤로">←</button><b>평가</b></header><div class="vlp-rate-scroll"></div></div>');
    scr.querySelector('.vlp-rate-scroll').appendChild(ratingPanel(delivery, ctx));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { scr.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus && opener.isConnected) opener.focus(); if (ctx && ctx.onClose) ctx.onClose(); };
    scr.querySelector('.vlp-rate-back').addEventListener('click', close); document.addEventListener('keydown', onKey);
    document.body.appendChild(scr); scr.focus(); return close;
  }

  // ---------- PWA-21 시공사: 대리 인수 (필수 촬영 6컷) ----------
  function shopPanel(delivery, ctx) {
    ctx = ctx || {}; const q = ctx.queue || V.uploadQueue.shared();
    const wrap = el('<div class="vlp-hand vlp-hand-shop"><div class="vlp-sub-title">대리 인수 (필수 촬영)</div><div class="vlp-hand-body hint">불러오는 중…</div></div>');
    const body = wrap.querySelector('.vlp-hand-body');
    async function refresh() {
      try { delivery = await V.api.deliveries.get(delivery.deliveryId); } catch (e) { /* 이전 값으로 */ } // 시트처럼 오래 열려 있어도 최신 상태로
      let h; try { h = await V.api.handover.get(delivery.deliveryId); } catch (e) { body.textContent = U.errorText(e); return; }
      body.className = 'vlp-hand-body'; body.innerHTML = '';
      if (h.receiverType === 'PROXY_INSTALLER') { body.appendChild(el('<div class="vlp-hand-done" role="status">✔ 대리 인수가 기록되었습니다.</div>')); body.appendChild(photoStrip(h, delivery.deliveryId)); return; }
      if (delivery.storageState !== 'ARRIVED') { body.appendChild(el('<div class="hint vlp-shop-wait">차량이 도착하면 촬영을 시작할 수 있어요.</div>')); return; }
      const slots = V.config.get('requiredShotSlots'), have = new Set((h.media || []).filter((m) => m.purpose === 'REQUIRED_SHOT').map((m) => m.slot));
      body.appendChild(el('<div class="hint">외관 사방·계기판·특이사항을 모두 촬영해야 대리 인수를 기록할 수 있어요. 연결이 끊겨도 사진은 기기에 보관되었다가 자동으로 올라가요.</div>'));
      body.appendChild(V.capture.slotGrid({ deliveryId: delivery.deliveryId, purpose: 'REQUIRED_SHOT', slots, doneSlots: have, queue: q, onDone: refresh }));
      const err = el('<div class="vlp-error" role="alert" hidden></div>'), note = el('<input type="text" class="vlp-proxy-note" placeholder="특이사항 메모 (선택)" autocomplete="off">');
      const b = el('<button type="button" class="btn btn-primary btn-sm vlp-proxy-go">대리 인수 기록</button>');
      const ready = slots.every((s) => have.has(s)); b.disabled = !ready;
      if (!ready) body.appendChild(el('<div class="hint vlp-proxy-need">남은 촬영 ' + slots.filter((s) => !have.has(s)).length + '컷</div>'));
      b.addEventListener('click', async () => {
        b.disabled = true; err.hidden = true;
        const ids = (h.media || []).filter((m) => m.purpose === 'REQUIRED_SHOT').map((m) => m.mediaId); const bodyReq = { mediaIds: ids }; const n = note.value.trim(); if (n) bodyReq.note = n;
        try { await V.api.handover.proxyReceipt(delivery.deliveryId, bodyReq); await refresh(); if (ctx.onChange) ctx.onChange(); }
        catch (e) { err.textContent = errMsg(e); err.hidden = false; b.disabled = false; }
      });
      body.appendChild(note); body.appendChild(b); body.appendChild(err);
    }
    refresh(); wrap.__refresh = refresh; return wrap;
  }

  V.handover = { karmasterPanel, customerPanel, shopPanel, ratingPanel, openRating, recordCard, photoStrip, approvalForm };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.handover;
})(typeof window !== 'undefined' ? window : globalThis);
