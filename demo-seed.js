/* demo-seed.js — 목 어댑터에 시연용 계약 데이터를 채운다(데모 전용. 실 API에서는 쓰지 않는다).
 * 모든 데이터는 facade를 통해 만든다 — 화면이 보는 것과 같은 경로로 생긴 데이터다.
 * 조회번호는 이 함수의 반환값으로만 돌려주며 어디에도 저장하지 않는다. */
(function (g) {
  'use strict';
  const V = g.VLP; const U = V.ui;
  const ACC = {
    cust: { name: '홍길동', phone: '010-1111-0001' },
    cust2: { name: '이영희', phone: '010-1111-0002' },
    km: { id: 'k1', name: '김도현 카마스터', phone: '010-2222-3301' },
    newKm: { phone: '010-9999-0009' },
  };
  // 시연 계정: 신차케어 로그인 목록(Store.getDemoCustomers)과 같은 고객, 카마스터 3명(Store 기본값)
  const CUSTS = {
    kim: { name: '김민준', phone: '010-7777-1000' }, lee: { name: '이서연', phone: '010-7777-2000' }, park: { name: '박지훈', phone: '010-7777-3000' },
    choi: { name: '최수민', phone: '010-7777-4000' }, jung: { name: '정하늘', phone: '010-7777-5000' }, han: { name: '한도윤', phone: '010-7777-6000' },
    oh: { name: '오지안', phone: '010-7777-7000' }, yoon: { name: '윤서아', phone: '010-7777-8000' },
  };
  const KMS = { k1: { id: 'k1', name: '김도현 카마스터', phone: '010-2222-3301' }, k2: { id: 'k2', name: '박서연 카마스터', phone: '010-2222-3302' }, k3: { id: 'k3', name: '이준호 카마스터', phone: '010-2222-3303' } };
  ACC.custs = CUSTS; ACC.kms = KMS;
  const asKmOf = (km) => U.setKarmasterSession(km.phone, km.name);
  /** 단계별 인도 건을 만든다. 모든 호출은 facade/목 어댑터 관리 훅(진행 단계) 경유. 반환: 안내 문서용 목록. */
  async function seedFlows({ asCust, shopSite, car, site }) {
    const a = V.api.adapter().admin; const out = []; const memo = {};
    const dealer = site.find((s) => s.type === 'DEALERSHIP').siteId;
    /** spec: {who, km, no, model, dest:'AFFILIATED_SHOP'|'DEALERSHIP'|'CUSTOM_ADDRESS', mode:'ON_SITE'|'REMOTE_PROXY', upto, note} */
    async function make(spec) {
      const cu = CUSTS[spec.who], km = KMS[spec.km];
      asCust(cu);
      const c = await V.api.contracts.create(car(spec.no, spec.model, { carmasterPhone: km.phone, brand: spec.brand || '현대', trim: spec.trim, color: spec.color }));
      const rec = { who: cu.name, phone: cu.phone, km: km.name, model: spec.model, upto: spec.upto, note: spec.note, contractId: c.contractId };
      out.push(rec);
      const m = memo[cu.phone] || (memo[cu.phone] = {});
      if (spec.upto === 'PENDING') return rec;
      asKmOf(km);
      if (spec.upto === 'REJECTED') { await V.api.contracts.reject(c.contractId, { reasonCode: 'WRONG_INFO', note: '계약번호가 다릅니다' }); return rec; }
      await V.api.contracts.approve(c.contractId, { destinationType: spec.dest || 'AFFILIATED_SHOP' });
      if (spec.upto === 'APPROVED') return rec;
      asCust(cu); await V.api.contracts.confirm(c.contractId); m[c.contractId] = { confirmed: true };
      const body = { receiptMode: spec.mode || 'ON_SITE' };
      if (spec.dest === 'CUSTOM_ADDRESS') body.customAddress = '울산광역시 남구 삼산로 123, 101동 1204호';
      else body.deliverySiteId = spec.dest === 'DEALERSHIP' ? dealer : shopSite;
      if (body.receiptMode === 'REMOTE_PROXY') body.proxyConsent = true;
      await V.api.contracts.releaseRequest(c.contractId, body); m[c.contractId] = { confirmed: true, released: true };
      if (spec.upto === 'RELEASE_REQUESTED') return rec;
      asKmOf(km); const d = await V.api.contracts.releaseOrder(c.contractId, {}); const id = d.deliveryId; rec.deliveryId = id;
      if (spec.upto === 'PLANNED') return rec;
      a.advance(id, 'SHIPPED');
      if (spec.upto === 'SHIPPED') { if (spec.delay) { asKmOf(km); await V.api.deliveries.raiseException(id, { reasonCode: spec.delay }); } return rec; }
      a.advance(id, 'IN_TRANSIT'); ['경기 평택', '충북 청주', '대전 유성'].forEach((r) => a.observe(id, r));
      if (spec.resolvedDelay) { asKmOf(km); await V.api.deliveries.raiseException(id, { reasonCode: spec.resolvedDelay }); const t = await V.api.deliveries.timeline(id, { limit: 50 }); const open = V.delivery.openExceptionId(t.items); if (open) await V.api.deliveries.resolveException(id, open); }
      if (spec.post) { asKmOf(km); for (const [kind, text] of spec.post) { const au = await V.api.deliveries.addAugmentation(id, { kind, text, audience: 'CUSTOMER' }); await V.api.deliveries.publishAugmentation(id, au.augmentationId); } }
      if (spec.upto === 'IN_TRANSIT') return rec;
      a.advance(id, 'ARRIVED');
      a.setInspection(id, spec.fail ? [{ item: '외관 도장', result: 'PASS' }, { item: '실내 청결', result: 'PASS' }, { item: '타이어 공기압', result: 'FAIL' }] : [{ item: '외관 도장', result: 'PASS' }, { item: '실내 청결', result: 'PASS' }, { item: '타이어 공기압', result: 'PASS' }]);
      if (spec.shots) { await shopShots(id); }
      if (spec.proxy) { await shopProxy(id); }
      if (spec.kmConfirm || spec.upto === 'DELIVERED') { asKmOf(km); await V.api.handover.managerConfirm(id); }
      if (spec.upto === 'ARRIVED') return rec;
      asCust(cu);
      if (body.receiptMode === 'REMOTE_PROXY') { const h = await V.api.handover.get(id); await V.api.handover.customerApprove(id, { approvalType: 'REMOTE', viewedMediaIds: h.media.map((m) => m.mediaId) }); } // 사진을 모두 본 뒤 원격 승인
      else await V.api.handover.customerApprove(id, { approvalType: 'ON_SITE' }); // → DELIVERED
      if (spec.rate && spec.rate.length) {
        const tg = (await V.api.deliveries.get(id)).ratingTargets || []; const rated = [], detail = {};
        for (const t of spec.rate) { const x = tg.find((q) => q.targetType === t); if (!x) continue; const asp = V.config.get('ratingAspects')[t].map((n, i) => ({ aspect: n, score: 5 - (i % 2) })); await V.api.engagement.rate({ deliveryId: id, targetType: t, targetId: x.targetId, aspects: asp, comment: '시연용 평가' }); rated.push(t); detail[t] = { aspects: asp, comment: '시연용 평가' }; }
        // 화면은 "이 기기에서 평가했는지"를 기기 메모로 안다(서버에서 내 평가를 읽는 API 협의 전, D-56) — 같은 메모를 남긴다
        try { localStorage.setItem('vlp_rated_' + id, JSON.stringify(rated)); localStorage.setItem('vlp_rating_detail_' + id, JSON.stringify(detail)); } catch (e) { /* 저장 불가 환경 */ }
      }
      return rec;
    }
    const F = [
      // 김민준 — 인도 완료 2건(평가 전 / 평가 완료)
      { who: 'kim', km: 'k1', no: 'HM-FLOW-101', model: '투싼', upto: 'DELIVERED', note: '인도 완료 · 평가 전' },
      { who: 'kim', km: 'k1', no: 'KA-FLOW-102', model: '스포티지', brand: '기아', upto: 'DELIVERED', rate: ['KARMASTER', 'SHOP', 'DELIVERY_COMPANY'], note: '인도 완료 · 평가 완료' },
      // 이서연 — 이동 중(위치 수집 3곳 + 카마스터 안내 + 시공 중 게시 + 해소된 지연)
      { who: 'lee', km: 'k2', no: 'KA-FLOW-201', model: '니로 EV', brand: '기아', dest: 'CUSTOM_ADDRESS', upto: 'IN_TRANSIT', resolvedDelay: 'traffic', post: [['LOCATION', '대전 휴게소 경유 중'], ['CUSTOMIZING', '선팅 시공 중']], note: '이동 중 · 자택 배송' },
      // 박지훈 — 도착: 현장 인수 대기(모두 합격) / 검수 불합격 + 카마스터 확인 완료
      { who: 'park', km: 'k1', no: 'HM-FLOW-301', model: '싼타페', upto: 'ARRIVED', note: '도착 · 인수 확인 대기(카마스터 확인 전)' },
      { who: 'park', km: 'k1', no: 'HM-FLOW-302', model: '스타리아', upto: 'ARRIVED', fail: true, kmConfirm: true, note: '도착 · 검수 불합격 1건(사유 입력 필요)' },
      // 최수민 — 지연 중 / 출고 의뢰 완료(배차 전)
      { who: 'choi', km: 'k3', no: 'KA-FLOW-401', model: '셀토스', brand: '기아', dest: 'DEALERSHIP', upto: 'SHIPPED', delay: 'traffic', note: '배송 시작 · 지연 발생 중' },
      { who: 'choi', km: 'k3', no: 'HM-FLOW-402', model: '캐스퍼', upto: 'PLANNED', note: '출고 의뢰 완료 · 배차 전' },
      // 정하늘 — 대리 인수: 촬영 전 / 촬영·대리 인수·카마스터 확인 완료(고객 원격 승인 대기)
      { who: 'jung', km: 'k2', no: 'HM-FLOW-501', model: '쏘나타', mode: 'REMOTE_PROXY', upto: 'ARRIVED', note: '도착 · 대리 인수(시공사 필수 촬영 전)' },
      { who: 'jung', km: 'k2', no: 'HM-FLOW-502', model: '코나', mode: 'REMOTE_PROXY', upto: 'ARRIVED', shots: true, proxy: true, kmConfirm: true, note: '도착 · 대리 인수 기록 완료(고객 원격 승인 대기)' },
      // 한도윤 — 출고 의뢰 완료 / 승인 후 고객 확인 전
      { who: 'han', km: 'k1', no: 'HM-FLOW-601', model: '팰리세이드', upto: 'PLANNED', note: '출고 의뢰 완료 · 배차 전' },
      { who: 'han', km: 'k1', no: 'KA-FLOW-602', model: '레이', brand: '기아', upto: 'APPROVED', note: '승인됨 · 고객 계약 확인 전' },
      // 오지안 — 배송 시작(대리 인수 예정) / 승인 대기 / 거절됨
      { who: 'oh', km: 'k3', no: 'KA-FLOW-701', model: 'EV6', brand: '기아', mode: 'REMOTE_PROXY', upto: 'SHIPPED', note: '배송 시작 · 대리 인수 예정' },
      { who: 'oh', km: 'k3', no: 'KA-FLOW-702', model: 'K5', brand: '기아', upto: 'PENDING', note: '카마스터 승인 대기' },
      { who: 'oh', km: 'k3', no: 'KA-FLOW-703', model: 'K8', brand: '기아', upto: 'REJECTED', note: '거절됨 · 내용 고쳐 다시 등록' },
      // 윤서아 — 인도 완료, 카마스터만 평가(부분 평가)
      { who: 'yoon', km: 'k2', no: 'GN-FLOW-801', model: 'G80', brand: '제네시스', mode: 'REMOTE_PROXY', shots: true, proxy: true, upto: 'DELIVERED', rate: ['KARMASTER'], note: '인도 완료(대리 인수·원격 승인) · 일부만 평가' },
    ];
    for (const f of F) await make(f);
    try { if (V.uploadQueue) { const q = V.uploadQueue.shared(); (await q.list({ owner: false })).forEach((x) => q.discard(x.id)); } } catch (e) { /* 큐 정리 실패는 무시 */ } // 시드가 올린 사진의 완료 기록은 남기지 않는다(대기열이 비어 있어야 시연이 깨끗하다)
    Object.keys(memo).forEach((ph) => { const key = 'vlp_ui_customer_' + U.digits(ph); U.mem.set(key, memo[ph]); });
    return out;
  }
  async function shopShots(id) { asShop(); const q = V.uploadQueue.shared(); const slots = V.config.get('requiredShotSlots'); for (let i = 0; i < slots.length; i++) await q.enqueue({ deliveryId: id, purpose: 'REQUIRED_SHOT', slot: slots[i], blob: await V.capture.samplePhoto(V.capture.labelOf(slots[i]), 30 + i * 45), contentType: 'image/jpeg' }); await q.run(); }
  async function shopProxy(id) { asShop(); const h = await V.api.handover.get(id); await V.api.handover.proxyReceipt(id, { mediaIds: h.media.filter((m) => m.purpose === 'REQUIRED_SHOT').map((m) => m.mediaId), note: '특이사항 없음' }); }

  async function load() {
    const a = V.api.adapter(); if (!a || a.name !== 'mock') throw new Error('데모 데이터는 목 어댑터에서만 불러올 수 있습니다');
    a.admin.reset(); V.api.session.clear();
    try { if (V.uploadQueue) { const q = V.uploadQueue.shared(); (await q.list({ owner: false })).forEach((x) => q.discard(x.id)); } } catch (e) { /* 큐 정리 실패는 무시 */ }
    const asCust = (c) => U.setCustomerSession(c.name, c.phone);
    const asKm = () => U.setKarmasterSession(ACC.km.phone, ACC.km.name);
    const car = (no, model, extra) => Object.assign({ manufacturerContractNo: no, vehicleModel: model, carmasterPhone: ACC.km.phone, brand: '기아', contractDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) }, extra || {});
    const site = V.config.get('deliverySites');
    const shopSite = site.find((s) => s.type === 'AFFILIATED_SHOP').siteId;

    asCust(ACC.cust);
    const c1 = await V.api.contracts.create(car('KA-DEMO-001', '쏘렌토 하이브리드', { trim: '시그니처', color: '스노우 펄' }));   // 승인 대기
    const c2 = await V.api.contracts.create(car('KA-DEMO-002', '카니발', { trim: '프레스티지', color: '미드나잇 블랙' }));       // 승인됨, 고객 확인 전
    const c3 = await V.api.contracts.create(car('HM-DEMO-003', '그랜저', { brand: '현대', color: '아이언 그레이' }));          // 출고 요청까지 → 카마스터 출고 의뢰 대기
    const c4 = await V.api.contracts.create(car('HM-DEMO-004', '아이오닉 6', { brand: '현대', trim: '프레스티지' }));            // 출고 의뢰 완료 → READY
    const c5 = await V.api.contracts.create(car('KA-DEMO-005', '모닝', { memo: '번호 오기입' }));                              // 거절됨 → 다시 등록
    asCust(ACC.cust2);
    const c6 = await V.api.contracts.create(car('KA-DEMO-006', 'EV9', { carmasterPhone: ACC.newKm.phone, carmasterName: '박미가' })); // 미가입 카마스터 → 조회번호

    asKm();
    await V.api.contracts.approve(c2.contractId, { destinationType: 'AFFILIATED_SHOP' });
    await V.api.contracts.approve(c3.contractId, { destinationType: 'AFFILIATED_SHOP' });
    await V.api.contracts.approve(c4.contractId, { destinationType: 'AFFILIATED_SHOP' });
    await V.api.contracts.reject(c5.contractId, { reasonCode: 'WRONG_INFO', note: '계약번호가 다릅니다' });

    asCust(ACC.cust);
    await V.api.contracts.confirm(c3.contractId); await V.api.contracts.confirm(c4.contractId);
    await V.api.contracts.releaseRequest(c3.contractId, { receiptMode: 'ON_SITE', deliverySiteId: shopSite });
    await V.api.contracts.releaseRequest(c4.contractId, { receiptMode: 'REMOTE_PROXY', deliverySiteId: shopSite, proxyConsent: true });
    asKm();
    await V.api.contracts.releaseOrder(c4.contractId, {});

    // 이 기기에서 "확인함/요청함"으로 보이게 한다(Contract 응답에 해당 표시가 없어 기기 메모를 쓴다).
    const key = 'vlp_ui_customer_' + U.digits(ACC.cust.phone);
    U.mem.set(key, { [c3.contractId]: { confirmed: true, released: true }, [c4.contractId]: { confirmed: true, released: true } });

    // ---- 단계별 인도 건: 기존 로그인 목록의 고객(김민준~윤서아)과 카마스터 3명에게 붙인다 ----
    const flows = await seedFlows({ asCust, shopSite, car, site });
    V.api.session.clear();
    return { accounts: ACC, claimToken: c6.claimToken, claimContractNo: c6.serviceContractNo, contracts: { c1, c2, c3, c4, c5, c6: { contractId: c6.contractId, serviceContractNo: c6.serviceContractNo } }, flows };
  }

  /** 시연용: 출고 의뢰된 아이오닉 6(READY) 건의 배송을 한 단계씩 진행시킨다. 목 어댑터 관리 훅 + facade만 사용. */
  async function demoDelivery() {
    V.api.session.clear(); U.setCustomerSession(ACC.cust.name, ACC.cust.phone);
    const l = await V.api.contracts.list({ limit: 50 }); const c = l.items.find((x) => x.deliveryId);
    if (!c) throw new Error('먼저 [데모 데이터 채우기]를 눌러 주세요');
    return c.deliveryId;
  }
  const asKm = () => U.setKarmasterSession(ACC.km.phone, ACC.km.name);
  const STEPS = {
    dispatch: { label: '배차 완료 (배송 시작)', run: async (id, a) => { a.advance(id, 'SHIPPED'); } },
    transit: { label: '탁송 출발 + 위치 3곳 수집', run: async (id, a) => { const st = (a.state().deliveries.find((d) => d.deliveryId === id) || {}).storageState; if (st === 'PLANNED') a.advance(id, 'SHIPPED'); if (st !== 'IN_TRANSIT') a.advance(id, 'IN_TRANSIT'); ['경기 평택', '충북 청주', '경북 구미'].forEach((r) => a.observe(id, r)); } },
    stale: { label: '수집 지연 만들기 (+40분)', run: async (id, a) => { a.skipTime(40 * 60000); } },
    location: { label: '카마스터 위치 안내 게시', run: async (id) => { asKm(); const a = await V.api.deliveries.addAugmentation(id, { kind: 'LOCATION', text: '대전 휴게소 경유 중', audience: 'CUSTOMER' }); await V.api.deliveries.publishAugmentation(id, a.augmentationId); } },
    delay: { label: '지연 발생 (교통정체)', run: async (id) => { asKm(); await V.api.deliveries.raiseException(id, { reasonCode: 'traffic' }); } },
    resolve: { label: '지연 해소', run: async (id) => { asKm(); const t = await V.api.deliveries.timeline(id, { limit: 50 }); const open = V.delivery.openExceptionId(t.items); if (open) await V.api.deliveries.resolveException(id, open); } },
    custom: { label: '시공 중 게시', run: async (id) => { asKm(); const a = await V.api.deliveries.addAugmentation(id, { kind: 'CUSTOMIZING', text: '선팅 시공 중', audience: 'CUSTOMER' }); await V.api.deliveries.publishAugmentation(id, a.augmentationId); } },
    arrive: { label: '도착', run: async (id, a) => { const st = (a.state().deliveries.find((d) => d.deliveryId === id) || {}).storageState; if (st === 'SHIPPED') a.advance(id, 'IN_TRANSIT'); a.advance(id, 'ARRIVED'); } },
  };

  const asShop = () => V.api.session.set({ userId: 'shop-1', role: 'shop', phone: '010-0000-0003', name: '울산 제휴 시공소', token: 'mock-shop-1' });
  Object.assign(STEPS, {
    inspect: { label: '검수 항목 기록 (불합격 1건 포함)', run: async (id, a) => { a.setInspection(id, [{ item: '외관 도장', result: 'PASS' }, { item: '실내 청결', result: 'PASS' }, { item: '타이어 공기압', result: 'FAIL' }]); } },
    inspectOk: { label: '검수 항목 기록 (모두 합격)', run: async (id, a) => { a.setInspection(id, [{ item: '외관 도장', result: 'PASS' }, { item: '실내 청결', result: 'PASS' }, { item: '타이어 공기압', result: 'PASS' }]); } },
    shots: { label: '시공사 필수 촬영 6컷 자동 등록 (샘플 사진)', run: async (id) => { asShop(); const q = V.uploadQueue.shared(); const slots = V.config.get('requiredShotSlots'); for (let i = 0; i < slots.length; i++) await q.enqueue({ deliveryId: id, purpose: 'REQUIRED_SHOT', slot: slots[i], blob: await V.capture.samplePhoto(V.capture.labelOf(slots[i]), 30 + i * 45), contentType: 'image/jpeg' }); await q.run(); } },
    proxy: { label: '시공사 대리 인수 기록', run: async (id) => { asShop(); const h = await V.api.handover.get(id); await V.api.handover.proxyReceipt(id, { mediaIds: h.media.filter((m) => m.purpose === 'REQUIRED_SHOT').map((m) => m.mediaId), note: '특이사항 없음' }); } },
    kmconfirm: { label: '카마스터 인도 확인', run: async (id) => { asKm(); await V.api.handover.managerConfirm(id); } },
  });
  async function stepDelivery(name) {
    const a = V.api.adapter(); if (!a || a.name !== 'mock') throw new Error('목 어댑터에서만 쓸 수 있습니다');
    const s = STEPS[name]; if (!s) throw new Error('알 수 없는 단계 ' + name);
    const id = await demoDelivery(); await s.run(id, a.admin); V.api.session.clear(); return s.label;
  }
  V.demo = { load, ACC, stepDelivery, STEPS };
})(window);
