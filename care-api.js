/* care-api.js — 신차케어 "잠정 계약"(provisional). openapi.yaml에는 케어 API가 없다(PLAT-05, PKG-C 요청서 미전달).
 * 그래서 vlp-ops.js(= openapi 표)에는 넣지 않고, 여기서 VLP.api.care.* 로만 노출한다. 화면은 이 경계만 부르고
 * v6 Store를 직접 읽지 않는다. 실서버(JEFLIX) 계약이 확정되면 이 파일만 http 호출로 바꾸면 된다.
 *   - 값은 모두 복사본(JSON)으로 돌려준다. 어댑터가 mock이 아니면 501.
 *   - 미정 규칙(이의 횟수, 입고 유형, 수령 방식 목록)은 VLP.config의 care* 설정에서 읽는다.
 */
(function (g) {
  'use strict';
  const V = g.VLP = g.VLP || {};
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const cfg = (k) => (V.config ? V.config.get(k) : undefined);
  const store = () => g.Store;
  const err = (status, message) => { const e = new Error(message); e.status = status; e.code = 'CARE-' + status; return e; };
  function guard() {
    if (!V.api || V.api.adapterName() !== 'mock') throw err(501, '신차케어 서버 계약이 아직 없어 목 어댑터에서만 동작합니다');
    if (!store()) throw err(500, 'mock 저장소를 찾을 수 없습니다');
  }
  const phoneOf = () => { const id = V.api.session.get(); return (id && id.phone) || (g.loggedInPhone || ''); };
  const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

  // v6 상태값 -> 화면용 단계(구성안 5단계: 입고·작업·검수·출차·수령). 대응이 확정되지 않은 부분은 phase로만 구분한다.
  function phaseOf(c) {
    if (c.status === 'requested') return 'REQUESTED';
    if (c.status === 'quoted') return 'QUOTED';
    if (c.status === 'confirmed') return 'CONFIRMED';
    if (c.status === '입고완료') return 'RECEIVED';
    if (c.status === '작업중') return 'WORKING';
    if (c.status === '최종검수') return 'INSPECTING';
    if (c.status === '고객검수대기' && c.disputed) return c.escalated ? 'ESCALATED' : 'REWORK';
    if (c.status === '고객검수대기') return 'CUSTOMER_INSPECT';
    if (c.status === '출차완료') return 'RELEASED';
    if (c.status === '수령대기') return 'READY_TO_RECEIVE';
    if (c.status === '수령확인') {
      if (c.priceMatch === null || c.priceMatch === undefined) return 'PRICE_CHECK';
      if (c.disputed || c.priceMatch === false) return 'DISPUTED'; // 정찰제 불일치 제보도 같은 단계(품질 이의와 별개로 운영자 확인)
      if (!c.shopRated) return 'RATE';
      return 'DONE';
    }
    return 'REQUESTED';
  }
  // intakeRoute: 기록 이전에 이미 입고된 건은 기본값으로 보여 준다
  function view(c) {
    const s = store(); const shop = s.getShop(c.shopId);
    return {
      unreadChat: unreadFor(c, 'customer'),
      careId: c.id, reservationId: c.reservationId, vehicleModel: c.carModel || '', trim: c.trim || '', color: c.color || '',
      shop: shop ? { shopId: shop.id, name: shop.name, address: shop.address || '', phone: shop.phone || '' } : null,
      mode: c.mode, intakeRoute: c.intakeRoute || (['requested', 'quoted', 'confirmed'].includes(c.status) ? null : cfg('careDefaultIntakeRoute')), receiveMode: c.receiveMode || cfg('careDefaultReceiveMode'),
      package: c.package ? { id: c.package.id, name: c.package.name, price: c.package.price } : null,
      options: (c.options || []).map((o) => ({ id: o.id, name: o.name, price: o.price })),
      customRequest: c.customRequest || '', quotedPrice: c.quotedPrice, chargedPrice: c.chargedPrice, chargeNote: c.chargeNote || '',
      pointsUsed: c.pointsUsed || 0, status: c.status, phase: phaseOf(c), priceMatch: c.priceMatch,
      disputed: !!c.disputed, escalated: !!c.escalated, disputeRounds: c.disputeRounds || 0, disputeMaxRounds: cfg('careDisputeMaxRounds'), disputeReason: c.disputeReason || '', rated: !!c.shopRated, pointsEarned: c.shopPointsEarned || 0,
      mileage: c.mileage == null ? null : c.mileage, intakePhotos: (c.intakePhotos || []).map((p) => ({ label: p.label, src: p.src || null })),
      createdAt: c.createdAt, photos: (c.photos || []).map((p, i) => ({ p, i })).filter((x) => !x.p.withdrawn).map((x) => ({ label: x.p.label, src: x.p.src || null, idx: x.i })),
      log: (c.log || []).map((l) => ({ t: l.t, msg: l.msg })),
    };
  }
  const mine = (id) => { const c = store().getCareOrder(id); if (!c || digits(c.customer && c.customer.phone) !== digits(phoneOf())) throw err(404, '신청 내역을 찾을 수 없습니다'); return c; };
  const wait = (v) => Promise.resolve(clone(v));

  const care = {
    provisional: true,
    /** 설정값: 단계 이름, 수령 방식 목록, 패키지·옵션 카탈로그 (서버가 주게 될 값의 자리) */
    async catalog() {
      guard();
      return clone({ packages: g.PACKAGES, options: g.OPTION_CATALOG, steps: cfg('careSteps'), receiveModes: cfg('careReceiveModes'), defaultReceiveMode: cfg('careDefaultReceiveMode'), shopStages: g.SHOP_DISPLAY_STAGES });
    },
    async shops() { guard(); return wait(store().getApprovedShops().map((s) => ({ shopId: s.id, name: s.name, tags: s.tags || [], rating: s.rating, reviews: s.reviews }))); },
    /** 신청 대상이 될 수 있는 내 차량: 새 모델 계약(contracts.list) + 이행 중인 v6 예약 */
    async cars() {
      guard(); const out = [];
      try { const pg = await V.api.contracts.list({ limit: 50 }); (pg.items || []).filter((c) => c.status !== 'REJECTED' && c.status !== 'EXPIRED').forEach((c) => out.push({ reservationId: c.contractId, vehicleModel: c.vehicleModel || '', trim: c.trim || '', color: c.color || '', ref: c.serviceContractNo || c.contractId })); } catch (e) { /* 계약 없음 */ }
      store().getReservationsByPhone(phoneOf()).forEach((r) => out.push({ reservationId: r.id, vehicleModel: r.carModel || '', trim: r.trim || '', color: r.color || '', ref: r.id }));
      return wait(out);
    },
    async list() { guard(); return wait({ items: store().getCareOrdersByPhone(phoneOf()).map(view) }); },
    async get(id) { guard(); return wait(view(mine(id))); },
    async points() { guard(); return wait({ balance: store().getPointBalance(phoneOf()) }); },
    async request(body) {
      guard(); const b = body || {};
      let source = null;
      if (!store().getReservation(b.reservationId)) { // 새 모델 계약이면 차량·고객 정보를 계약에서 가져온다
        const car = (await care.cars()).find((x) => x.reservationId === b.reservationId);
        if (!car) throw err(422, '대상 차량을 찾을 수 없습니다');
        const id = V.api.session.get() || {};
        source = { customer: { name: id.name || g.loggedInName || '', phone: phoneOf() }, carModel: car.vehicleModel, trim: car.trim, color: car.color };
      }
      const o = store().requestCareOrder({ reservationId: b.reservationId, shopId: b.shopId, mode: b.mode || 'online', packageId: b.packageId, optionIds: b.optionIds || [], customRequest: b.customRequest || '', source });
      if (!o) throw err(422, '대상 차량을 찾을 수 없습니다');
      store()._updateCare(o.id, { receiveMode: b.receiveMode || cfg('careDefaultReceiveMode') });
      return wait(view(store().getCareOrder(o.id)));
    },
    async confirmQuote(id, pointsUsed) { guard(); mine(id); return wait(view(store().confirmCareQuote(id, pointsUsed || 0))); },
    /** 고객 검수: approve=true면 출차 승인, false면 이의(사유). 이의 후 보완·재검수 규칙은 미정 -> 지금은 v6처럼 접수만 */
    async approveInspection(id) { guard(); mine(id); return wait(view(store().ownerConfirmCare(id))); },
    async raiseDispute(id, reason) {
      guard(); const c = mine(id); const max = cfg('careDisputeMaxRounds');
      // 한도를 넘긴 이의는 보완 단계 없이 운영자 중재로 접수한다
      return wait(view(store().raiseCareDispute(id, reason, { escalated: max != null && (c.disputeRounds || 0) >= max })));
    },
    async confirmReceipt(id) { guard(); mine(id); return wait(view(store().ownerConfirmCare(id))); },
    async answerPriceCheck(id, matched) { guard(); mine(id); return wait(view(store().answerCarePriceCheck(id, !!matched))); },
    async rate(id, scores, comment) { guard(); const c = mine(id); store().submitRating('shop', c.shopId, id, scores || {}, comment || ''); return wait(view(store().getCareOrder(id))); },
    ratingAspects() { return clone(g.RATING_DIMS_SHOP || []); },
  };

  // ---- 시공사 쪽(목 전용). 시공사 로그인은 v6 화면(sessionStorage)이 쥐고 있어 shopId를 직접 받는다. 실서버에서는 로그인 신원으로 대체. ----
  const mineShop = (shopId, id) => { const c = store().getCareOrder(id); if (!c || c.shopId !== shopId) throw err(404, '시공 건을 찾을 수 없습니다'); return c; };
  const shopView = (c) => Object.assign(view(c), { unreadChat: unreadFor(c, 'shop'), customer: { name: (c.customer && c.customer.name) || '', phone: (c.customer && c.customer.phone) || '' }, suggestedPrice: store().aftermarketSuggestedPrice(c), ownerConfirmed: !!c.ownerConfirmed, delivering: !!(c.transit && c.transit.active), destination: (c.transit && c.transit.destination) || '' });
  const shopApi = {
    async list(shopId) { guard(); return wait({ items: store().getCareOrders().filter((c) => c.shopId === shopId).map(shopView) }); },
    async respondQuote(shopId, id, price) { guard(); mineShop(shopId, id); const p = Math.max(0, parseInt(price, 10) || 0); if (!p) throw err(422, '견적가를 입력해 주세요'); store().respondCareQuote(id, p); return wait(shopView(store().getCareOrder(id))); },
    /** 입고 확인: 필수 촬영(설정 careIntakeShots) 전부 + 입고 경로. 주행거리는 선택. shots: [{label, src}] */
    async confirmIntake(shopId, id, body) {
      guard(); const c = mineShop(shopId, id); const b = body || {}; const need = cfg('careIntakeShots') || [];
      if (c.status !== 'confirmed') throw err(409, '입고를 확인할 수 있는 상태가 아닙니다');
      const have = (b.shots || []).filter((x) => x && x.src).map((x) => x.label);
      const miss = need.filter((n) => !have.includes(n));
      if (miss.length) throw err(422, '필수 촬영이 부족합니다: ' + miss.join(', '));
      const route = b.route || cfg('careDefaultIntakeRoute');
      if (!(cfg('careIntakeRoutes') || []).some((r) => r.code === route)) throw err(422, '입고 경로가 올바르지 않습니다');
      const km = b.mileage === '' || b.mileage == null ? null : Math.max(0, parseInt(b.mileage, 10) || 0);
      store().confirmCareDropoff(id, route, { mileage: km, intakePhotos: need.map((n) => (b.shots || []).find((x) => x.label === n)).map((x) => ({ label: x.label, src: x.src })) });
      return wait(shopView(store().getCareOrder(id)));
    },
    async setStage(shopId, id, code) { guard(); mineShop(shopId, id); store().setCareShopStage(id, code); return wait(shopView(store().getCareOrder(id))); },
    async addPhoto(shopId, id, src, name) { guard(); mineShop(shopId, id); if (src) store().addCareUploadedPhoto(id, src, name); else store().addCareSamplePhoto(id, g.generateSamplePhoto); return wait(shopView(store().getCareOrder(id))); },
    async withdrawPhoto(shopId, id, idx) { guard(); mineShop(shopId, id); store().withdrawCarePhoto(id, idx); return wait(shopView(store().getCareOrder(id))); },
    /** 검수 요청: 추가 금액(견적 위에 얹는 금액)과 사유를 청구로 확정하고 고객에게 검수를 요청한다 */
    async requestInspection(shopId, id, extra, note) { guard(); mineShop(shopId, id); store().setCareCharged(id, Math.max(0, parseInt(extra, 10) || 0), note || ''); store().requestCareInspection(id); return wait(shopView(store().getCareOrder(id))); },
    async completeRework(shopId, id) { guard(); mineShop(shopId, id); store().completeCareRework(id); return wait(shopView(store().getCareOrder(id))); },
    /** 출차 후: 방문 수령이면 수령 준비 완료, 시공사 배송이면 배송 시작 */
    async handOut(shopId, id) { guard(); const c = mineShop(shopId, id); if ((c.receiveMode || cfg('careDefaultReceiveMode')) === 'SHOP_DELIVERY') store().startCareSecondLeg(id); else store().readyCareForPickup(id); return wait(shopView(store().getCareOrder(id))); },
  };
  care.shop = shopApi;
  // 대화(고객↔시공사): vlp-chat.js가 opts.api로 받는 {messages, send}. 건 단위 스레드, 서버 계약이 생기면 이 두 함수만 바꾼다.
  const unreadFor = (c, role) => { const other = role === 'customer' ? 'shop' : 'customer'; const seen = (c.chatRead || {})[role] || ''; return (c.messages || []).filter((m) => m.senderRole === other && m.createdAt > seen).length; };
  function pageOfMsgs(c, q, masked) {
    q = q || {}; const all = c.messages || []; const start = q.cursor ? parseInt(q.cursor, 10) || 0 : 0; const limit = q.limit || 100;
    const items = all.slice(start, start + limit).map((m) => ({ messageId: m.messageId, senderRole: m.senderRole, body: masked ? '' : m.body, masked: masked ? true : undefined, createdAt: m.createdAt }));
    return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
  }
  function chatApi(role, resolve) {
    return {
      async messages(id, q) { guard(); return wait(pageOfMsgs(resolve(id), q)); },
      /** 열려 있는 대화창이 호출한다 — 상대가 보낸 마지막 메시지까지 읽음 처리 */
      async markRead(id) { guard(); resolve(id); store().markCareChatRead(id, role); return wait({ ok: true }); },
      async send(id, payload, o) {
        guard(); const c = resolve(id); const body = String((payload && payload.body) || '').trim();
        if (!body) { const e = err(422, '내용을 입력해 주세요'); e.field = 'body'; throw e; }
        if (body.length > 2000) throw err(422, '2000자를 넘을 수 없습니다');
        const m = store().addCareMessage(c.id, role, body, o && o.idempotencyKey);
        return wait({ messageId: m.messageId, senderRole: m.senderRole, body: m.body, createdAt: m.createdAt });
      },
    };
  }
  care.chat = chatApi('customer', (id) => mine(id));
  // 관리자: 읽기 전용. 열람 사유를 남기기 전에는 본문을 가린다(BR-12과 같은 방식, 신차인도 건 대화와 동일한 사용감).
  const viewedRecently = (c) => { const win = (cfg('sensitiveViewWindowMinutes') || 30) * 60000; return (c.chatViews || []).some((v) => Date.now() - v.at <= win); };
  care.admin = {
    async messages(id, q) { guard(); const c = store().getCareOrder(id); if (!c) throw err(404, '신청 내역을 찾을 수 없습니다'); return wait(pageOfMsgs(c, q, !viewedRecently(c))); },
    async recordView(id, reasonCode) { guard(); if (!(cfg('sensitiveViewReasonCodes') || []).includes(reasonCode)) throw err(422, '열람 사유를 선택해 주세요'); const c = store().recordCareChatView(id, (g.loggedInAdminName || '관리자'), reasonCode); if (!c) throw err(404, '신청 내역을 찾을 수 없습니다'); return wait({ ok: true }); },
  };
  shopApi.chatFor = (shopId) => chatApi('shop', (id) => mineShop(shopId, id));
  // 실행 시점에 facade 인스턴스에 붙는다(createFacade가 새로 만들어져도 다시 붙일 수 있게 함수로 노출)
  V.attachCare = function (api) { api.care = care; return api; };
  if (V.api) V.attachCare(V.api);
  V.careApi = care;
  if (typeof module !== 'undefined' && module.exports) module.exports = care;
})(typeof window !== 'undefined' ? window : globalThis);
