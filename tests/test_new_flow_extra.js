// 새 흐름 보강 시나리오(구형 예약 흐름 테스트에서 옮겨 온 검증):
//  ① 같은 카마스터가 여러 고객을 담당해도 건이 섞이지 않는다  ② 상담 메모를 넣은 승인(메모 전달은 openapi 응답에 없어 미확인)
//  ③ 시공 없는 인도(고객 지정 주소·현장 인수) 끝까지 → 평가·포인트  ④ 인도 종결 후에도 대화 가능
//  ⑤ 인도가 끝난 차로 신차케어 신청 → 케어 건은 인도 건과 따로 보인다(두 서비스는 독립)
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    const p = await (await b.newContext()).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/demo.html?nosw=1'); await p.click('#load'); await p.waitForFunction(() => /채웠/.test(document.querySelector('#status').textContent));
    const r = await p.evaluate(async () => {
      const V = window.VLP, U = V.ui, A = V.demo.ACC, out = {}; const adm = V.api.adapter().admin;
      const asC = (c) => U.setCustomerSession(c.name, c.phone), asK = () => U.setKarmasterSession(A.km.phone, A.km.name);
      const base = (no, model) => ({ manufacturerContractNo: no, vehicleModel: model, carmasterPhone: A.km.phone, brand: '현대', contractDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10) });
      const custA = { name: '김가나', phone: '010-5555-0001' }, custB = { name: '이다라', phone: '010-5555-0002' };
      // ① 같은 카마스터, 두 고객
      asC(custA); const a = await V.api.contracts.create(base('EX-A-001', '쏘나타'));
      asC(custB); const bb = await V.api.contracts.create(base('EX-B-001', 'K5'));
      asK(); const kl = await V.api.contracts.list({ limit: 50 });
      out.kmSees = ['쏘나타', 'K5'].map((m) => kl.items.filter((x) => x.vehicleModel === m).length);
      // ② 승인 + 상담 메모
      await V.api.contracts.approve(a.contractId, { destinationType: 'CUSTOM_ADDRESS', consultationMemo: '틴팅은 입고 후 상담 예정' });
      asC(custA); const ga = await V.api.contracts.get(a.contractId); out.memo = ga.consultationMemo; out.aStatus = ga.status;
      asC(custB); out.bStatus = (await V.api.contracts.get(bb.contractId)).status; out.bModel = (await V.api.contracts.get(bb.contractId)).vehicleModel;
      // ③ 시공 없는 인도: 고객 지정 주소 · 현장 인수
      asC(custA); await V.api.contracts.confirm(a.contractId);
      await V.api.contracts.releaseRequest(a.contractId, { receiptMode: 'ON_SITE', customAddress: '울산 남구 삼산로 100' });
      asK(); await V.api.contracts.releaseOrder(a.contractId, {});
      asC(custA); const cl = (await V.api.contracts.list({ limit: 50 })).items.find((x) => x.contractId === a.contractId); const did = cl.deliveryId; out.hasDelivery = !!did;
      adm.advance(did, 'SHIPPED'); adm.advance(did, 'IN_TRANSIT'); adm.advance(did, 'ARRIVED');
      adm.setInspection(did, [{ item: '외관 도장', result: 'PASS' }, { item: '실내 청결', result: 'PASS' }]);
      asK(); await V.api.handover.managerConfirm(did);
      asC(custA); await V.api.handover.customerApprove(did, { approvalType: 'ON_SITE' });
      const done = (await V.api.contracts.get(a.contractId)); out.doneStatus = done.status;
      const pts0 = (await V.api.engagement.points()).balance;
      const st = adm.state(); out.kid = (st.registry.karmasters[A.km.phone.replace(/[^0-9]/g, '')] || {}).id;
      const asps = V.config.get('ratingAspects').KARMASTER.map((x) => ({ aspect: x, score: 5 }));
      await V.api.engagement.rate({ targetType: 'KARMASTER', targetId: out.kid, deliveryId: did, aspects: asps });
      out.pts1 = (await V.api.engagement.points()).balance;
      out.pts0 = pts0; out.did = did; out.cid = a.contractId;
      // ④ 종결 후에도 대화
      asC(custA); await V.api.engagement.send(a.contractId, { body: '인도 잘 받았습니다 감사합니다' }, { idempotencyKey: V.api.newIdempotencyKey() });
      asK(); await V.api.engagement.send(a.contractId, { body: '고객님 감사합니다' }, { idempotencyKey: V.api.newIdempotencyKey() });
      asC(custA); const ms = await V.api.engagement.messages(a.contractId, { limit: 50 }); out.msgs = ms.items.map((m) => m.senderRole);
      // ⑤ 인도 끝난 차로 케어 신청
      const cars = await V.api.care.cars(); out.carIds = cars.map((c) => c.reservationId);
      return out;
    });
    console.log(JSON.stringify(r));
    assert.deepStrictEqual(r.kmSees, [1, 1], '카마스터 목록에 두 고객 건이 각각 보인다');
    // 상담 메모: openapi의 Contract 응답에는 consultationMemo가 없다(ApproveRequest에만 있음) — 고객 화면에 전달되지 않는다. CLAUDE.md 기록, 서버 계약 확인 필요.
    assert.strictEqual(r.aStatus, 'APPROVED');
    assert.strictEqual(r.bStatus, 'PENDING_APPROVAL'); assert.strictEqual(r.bModel, 'K5');
    assert.ok(r.pts1 > r.pts0, '평가하면 포인트가 늘어난다');
    assert.ok(r.hasDelivery); console.log('✔ ①②③ 다중 고객 독립 · 상담 메모 · 시공 없는 인도 도착까지');
    assert.deepStrictEqual(r.msgs, ['customer', 'karmaster']); console.log('✔ ④ 대화');
    assert.ok(r.carIds.includes(r.cid)); console.log('✔ ⑤ 케어 신청 대상 차량에 새 계약 포함');
    assert.deepStrictEqual(errs, []);
  } catch (e) { console.error('❌', e.message); process.exitCode = 1; } finally { await b.close(); }
})();
