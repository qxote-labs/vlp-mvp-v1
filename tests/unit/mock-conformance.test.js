// PWA-02 완료 검증: mock 응답이 openapi 스키마를 통과하는가 (계약과 목의 어긋남 방지, 변경계획서 4장)
// 모든 operation을 한 번 이상 호출하고, 성공·오류 응답을 전부 openapi로 검증한다.
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, setup, toReleased, toArrived, checkAgainstOpenapi, IDS, SITE1 } = require('./_helpers');

const REQUIRED = () => VLP.config.get('requiredShotSlots');
async function shoot(t, who, deliveryId, purpose, slot) {
  const init = await t.as(who).media.init(deliveryId, { purpose, slot, contentType: 'image/jpeg', sizeBytes: 1234, clientCreatedAt: new Date().toISOString() });
  await t.as(who).media.complete(init.mediaId);
  return init.mediaId;
}

test('34개 operation을 모두 호출하고 모든 응답이 openapi 스키마를 통과한다', async () => {
  const t = setup();
  const called = new Set();
  // --- 계약 ---
  const ids = await toReleased(t, { proxy: true });
  const list = await t.as('cust').contracts.list({ limit: 5 });
  assert.equal(list.items.length, 1);
  await t.as('km').contracts.list({ status: 'APPROVED' });
  await t.as('cust').contracts.get(ids.contractId);
  // reject: 별도 계약
  const c2 = await t.as('cust').contracts.create({ manufacturerContractNo: 'HK-2', vehicleModel: '쏘나타', carmasterPhone: IDS.km.phone });
  await t.as('km').contracts.reject(c2.contractId, { reasonCode: 'NOT_MY_CUSTOMER', note: '확인 불가' });
  // --- 접근(claim/grants/reissue): 미가입 카마스터 ---
  const c3 = await t.as('cust').contracts.create({ manufacturerContractNo: 'HK-3', vehicleModel: '그랜저', carmasterPhone: IDS.kmNew.phone });
  assert.match(c3.claimToken, /^\d{8}$/);
  await t.as('cust').contracts.get(c3.contractId);     // 승인 전(destinationType 없음) 상태도 스키마 검증 대상
  await t.as('cust').contracts.list({ status: 'PENDING_APPROVAL' });
  const grants0 = await t.as('kmNew').access.grants();
  assert.equal(grants0.items[0].status, 'PENDING_CLAIM');
  const re = await t.as('cust').access.reissue(grants0.items[0].grantId);
  assert.match(re.claimToken, /^\d{8}$/); assert.notEqual(re.claimToken, c3.claimToken);
  const grant = await t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: re.claimToken });
  assert.equal(grant.status, 'ACTIVE');
  assert.ok(grant.sessionToken, 'claim 응답에 세션 토큰');
  await t.as('kmNew').access.login({ phone: IDS.kmNew.phone, pin: '123456' });          // 확인번호 로그인
  const notes = await t.as('cust').notifications.list({ limit: 10 });                   // 앱 안 알림
  assert.ok(notes.items.length > 0 && notes.unreadCount > 0);
  await t.as('cust').notifications.read(notes.items[0].notificationId);
  await t.as('km').notifications.list({ unread: true });
  // --- 배송: 위치·보강·지연 ---
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT'); t.admin.observe(ids.deliveryId, '경북 구미');
  await t.as('cust').deliveries.get(ids.deliveryId);
  await t.as('cust').deliveries.timeline(ids.deliveryId, { limit: 10 });
  const loc0 = await t.as('cust').deliveries.location(ids.deliveryId);
  assert.equal(loc0.collectionStatus, 'COLLECTING');
  const aug = await t.as('km').deliveries.addAugmentation(ids.deliveryId, { kind: 'LOCATION', text: '대전 휴게소 경유', audience: 'CUSTOMER' });
  assert.equal(aug.status, 'DRAFT');
  const pub = await t.as('km').deliveries.publishAugmentation(ids.deliveryId, aug.augmentationId);
  assert.equal(pub.status, 'PUBLISHED');
  const ex = await t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'traffic' });
  assert.equal((await t.as('cust').deliveries.get(ids.deliveryId)).displayState, 'EXCEPTION');
  await t.as('admin').deliveries.resolveException(ids.deliveryId, ex.exceptionId);
  await t.as('admin').admin.collectionStatus();
  // --- 도착·시공사 대리 인수·이중 확인 ---
  t.admin.advance(ids.deliveryId, 'ARRIVED');
  const photoIds = [];
  for (const slot of REQUIRED()) photoIds.push(await shoot(t, 'shop', ids.deliveryId, 'REQUIRED_SHOT', slot));
  const stray = await shoot(t, 'shop', ids.deliveryId, 'OTHER');
  await t.as('shop').media.withdraw(stray);
  await t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: photoIds, note: '특이사항 없음' });
  await t.as('km').handover.managerConfirm(ids.deliveryId);
  await t.as('cust').handover.get(ids.deliveryId);
  const done = await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds, memo: '확인', signature: 'sig' });
  assert.ok(done.managerConfirmedAt && done.customerApprovedAt);
  assert.equal((await t.as('cust').deliveries.get(ids.deliveryId)).displayState, 'CONFIRMED');
  // --- 평가·포인트·대화·관리자 ---
  await t.as('cust').engagement.rate({ targetType: 'KARMASTER', targetId: t.admin.ids.karmaster1, deliveryId: ids.deliveryId, aspects: [{ aspect: '전문성', score: 5 }], comment: '좋았어요' });
  const pts = await t.as('cust').engagement.points();
  assert.equal(pts.balance, VLP.config.get('pointsPerRating'));
  await t.as('cust').engagement.send(ids.contractId, { body: '안녕하세요' });
  await t.as('km').engagement.send(ids.contractId, { body: '네 안녕하세요' });
  const msgs = await t.as('admin').engagement.messages(ids.contractId, { limit: 10 });
  assert.deepEqual(msgs.items.map(m => m.senderRole), ['customer', 'karmaster']); // 오래된 것 -> 최신(하단)
  const sv = await t.as('admin').admin.recordSensitiveView({ viewType: 'CHAT_FULL', contractId: ids.contractId, reasonCode: 'SUPERVISION' });
  assert.deepEqual(sv, { recorded: true, merged: false });

  // --- 호출된 모든 operation과 응답 검증 ---
  t.log.forEach(l => called.add(l.op));
  const missing = VLP.ops.list.map(o => o.name).filter(n => !called.has(n));
  assert.deepEqual(missing, [], '호출되지 않은 operation: ' + missing.join(', '));
  const errors = [];
  t.log.forEach(l => errors.push(...checkAgainstOpenapi(l.op, l.status, l.body)));
  assert.deepEqual(errors, []);
  assert.ok(t.log.length >= 45, "호출 수 " + t.log.length);
});

test('오류 응답 5종(401·404·409·422·429)도 Error 스키마와 코드 규칙을 따른다', async () => {
  const t = setup({ config: { claimMaxAttempts: 2 } });
  const seen = {};
  const grab = async (p, op) => { try { await p; } catch (e) { seen[e.status] = e; return e; } };
  t.f.session.clear();
  await grab(t.f.contracts.list(), 'contracts.list');                                      // 401
  await grab(t.as('cust').contracts.get('00000000-0000-4000-8000-000000000000'));          // 404
  const ids = await toReleased(t);
  await grab(t.as('km').contracts.approve(ids.contractId, { destinationType: 'DEALERSHIP' })); // 409 이미 승인됨
  await grab(t.as('cust').contracts.create({ vehicleModel: 'x' }));                        // 422
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'HK-9', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  assert.ok(c.claimToken);
  await grab(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: '00000000' }));
  await grab(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: '00000001' }));
  await grab(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken }));  // 잠금 -> 429
  assert.deepEqual(Object.keys(seen).sort(), ['401', '404', '409', '422', '429']);
  assert.deepEqual([401, 404, 409, 422, 429].map(s => seen[s].code), ['VLP-AUTH-401', 'VLP-RES-404', 'VLP-STATE-409', 'VLP-VAL-422', 'VLP-RATE-429']);
  const errs = [];
  t.log.filter(l => l.status >= 400).forEach(l => {
    errs.push(...(function () { const v = require('./_helpers').schemaValidator('Error'); return v(l.body) ? [] : v.errors.map(e => l.op + ' ' + e.message); })());
    errs.push(...checkAgainstOpenapi(l.op, l.status, l.body));
  });
  assert.deepEqual(errs, []);
});

test('계약번호 형식 SS-YYYYMM-NNNN, 같은 달 순번 증가', async () => {
  const t = setup();
  const a = await t.as('cust').contracts.create({ manufacturerContractNo: 'A-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  const b = await t.as('cust').contracts.create({ manufacturerContractNo: 'A-2', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  assert.match(a.serviceContractNo, /^SS-\d{6}-\d{4}$/);
  assert.equal(Number(b.serviceContractNo.slice(-4)) - Number(a.serviceContractNo.slice(-4)), 1);
});
