// 권한 없는 호출이 "실제로" 거부되는지 직접 호출해 확인한다 (CLAUDE.md 검증 규칙, 실행계획서 9·12장).
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, setup, toReleased, toArrived, IDS, SITE1, SITE2 } = require('./_helpers');

const code = async (p) => { try { await p; return null; } catch (e) { return e.status + ':' + e.code; } };
const NF = '404:VLP-RES-404', CONFLICT = '409:VLP-STATE-409', VAL = '422:VLP-VAL-422';
const FAKE = '00000000-0000-4000-8000-000000000000';
const KEY = 'k'.repeat(20);

test('신원이 없으면 모든 operation 401', async () => {
  const t = setup();
  for (const op of VLP.ops.list) {
    const res = await t.adapter.request({ op: op.name, method: op.method, path: op.path, pathParams: { id: FAKE, aid: FAKE, eid: FAKE, mid: FAKE }, query: {}, body: {}, idempotencyKey: KEY, identity: null });
    assert.equal(res.status, 401, op.name); assert.equal(res.body.code, 'VLP-AUTH-401');
  }
});

test('허용되지 않은 역할은 모든 operation 404 (존재 여부를 알리지 않는다)', async () => {
  const t = setup();
  const byRole = { customer: IDS.cust, karmaster: IDS.km, shop: IDS.shop, admin: IDS.admin };
  let checked = 0;
  for (const op of VLP.ops.list) for (const [role, idn] of Object.entries(byRole)) {
    if (op.roles.includes(role)) continue;
    const res = await t.adapter.request({ op: op.name, method: op.method, path: op.path, pathParams: { id: FAKE, aid: FAKE, eid: FAKE, mid: FAKE }, query: {}, body: {}, idempotencyKey: KEY, identity: idn });
    assert.equal(res.status, 404, op.name + ' as ' + role); assert.equal(res.body.code, 'VLP-RES-404'); checked++;
  }
  assert.ok(checked > 50, 'checked ' + checked);
});

test('클라이언트가 보낸 role 값은 신뢰하지 않는다 (역할 위조 시도)', async () => {
  const t = setup();
  // 고객이 body에 role을 끼워 보내도 카마스터 전용 승인은 열리지 않는다
  const ids = await t.as('cust').contracts.create({ manufacturerContractNo: 'X-1', vehicleModel: '쏘나타', carmasterPhone: IDS.km.phone });
  assert.equal(await code(t.as('cust').contracts.approve(ids.contractId, { destinationType: 'DEALERSHIP', role: 'karmaster' })), NF);
  // 신원 객체의 role만 서버(어댑터)가 본다: 다른 고객의 계약은 고객 신원이라도 404
  assert.equal(await code(t.as('cust2').contracts.get(ids.contractId)), NF);
});

test('남의 건·범위 밖 건은 404: 다른 고객, 다른 카마스터, 인도지 밖 시공사', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  assert.equal(await code(t.as('cust2').contracts.get(ids.contractId)), NF);
  assert.equal(await code(t.as('cust2').deliveries.get(ids.deliveryId)), NF);
  assert.equal(await code(t.as('cust2').handover.get(ids.deliveryId)), NF);
  assert.equal(await code(t.as('cust2').engagement.messages(ids.contractId)), NF);
  assert.equal(await code(t.as('cust2').engagement.send(ids.contractId, { body: '침입' })), NF);
  assert.equal(await code(t.as('km2').contracts.get(ids.contractId)), NF);                      // 다른 카마스터
  assert.equal(await code(t.as('km2').deliveries.addAugmentation(ids.deliveryId, { kind: 'NOTE', text: 'x' })), NF);
  assert.equal(await code(t.as('km2').handover.managerConfirm(ids.deliveryId)), NF);
  assert.equal(await code(t.as('shop2').deliveries.get(ids.deliveryId)), NF);                    // 인도지 소속이 아닌 시공사
  assert.equal(await code(t.as('shop2').handover.proxyReceipt(ids.deliveryId, { mediaIds: [FAKE] })), NF);
  assert.equal((await t.as('cust2').contracts.list()).items.length, 0);                          // 목록에도 안 나온다
  assert.equal((await t.as('km2').contracts.list()).items.length, 0);
});

test('시공사는 인도지가 자기 소속일 때만 접근, 영업소/고객 지정 주소 건은 거부', async () => {
  const t = setup();
  const proxyIds = await toReleased(t, { proxy: true, mfr: 'S-1' });   // 인도지 = 제휴 시공소(shop-1 소속)
  assert.ok((await t.as('shop').deliveries.get(proxyIds.deliveryId)).deliveryId);
  const onSite = await toReleased(t, { mfr: 'S-2' });                    // 인도지 = 영업소(시공사 없음)
  assert.equal(await code(t.as('shop').deliveries.get(onSite.deliveryId)), NF);
  assert.equal(await code(t.as('shop').contracts.get(onSite.contractId)), NF);
});

test('승인 전 카마스터에게는 최소 정보만: 응답에 고객 연락처·제조사 계약번호·상세가 없다 (서버 마스킹)', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'SECRET-123', vehicleModel: '아이오닉 6', carmasterPhone: IDS.km.phone, trim: '프레스티지', color: '화이트', memo: '개인메모', contractDate: '2026-09-01' });
  const one = await t.as('km').contracts.get(c.contractId);
  const list = await t.as('km').contracts.list({ status: 'PENDING_APPROVAL' });
  for (const view of [one, list.items[0]]) {
    assert.equal(view.masked, true);
    assert.deepEqual(Object.keys(view).sort(), ['contractId', 'customerDisplayName', 'expiresAt', 'masked', 'serviceContractNo', 'status', 'vehicleModel']);
    const json = JSON.stringify(view);
    ['SECRET-123', '010-1111-0001', '프레스티지', '개인메모', '홍길동', IDS.cust.phone].forEach(s => assert.ok(!json.includes(s), '노출됨: ' + s));
    assert.equal(view.customerDisplayName, '홍*동');
  }
  // 승인 후에는 전체 정보
  await t.as('km').contracts.approve(c.contractId, { destinationType: 'DEALERSHIP' });
  const after = await t.as('km').contracts.get(c.contractId);
  assert.equal(after.masked, false); assert.equal(after.manufacturerContractNo, 'SECRET-123');
});

test('미가입 카마스터는 claim 전에는 건의 존재도 알 수 없다', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'N-1', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  assert.equal(await code(t.as('kmNew').contracts.get(c.contractId)), NF);
  assert.equal((await t.as('kmNew').contracts.list()).items.length, 0);
  const g = await t.as('kmNew').access.grants();
  assert.deepEqual(Object.keys(g.items[0]).sort(), ['expiresAt', 'grantId', 'status']);   // contractId도 숨김
  await t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken });
  const seen = await t.as('kmNew').contracts.get(c.contractId);
  assert.equal(seen.masked, true);                                                          // claim 후에도 승인 전까지는 마스킹
});

test('조회번호는 등록 응답에서만 평문: 저장소·이벤트·알림·타임라인·재조회 어디에도 없다', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'T-1', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  const token = c.claimToken;
  assert.match(token, /^\d{8}$/);
  const dump = JSON.stringify(t.admin.state());
  assert.ok(!dump.includes(token), '상태 덤프에 평문 존재');
  assert.ok(!JSON.stringify(t.admin.events()).includes(token) && !JSON.stringify(t.admin.notifications()).includes(token));
  assert.ok(!JSON.stringify(t.storage._m).includes(token), '저장소(localStorage 대용)에 평문 존재');
  // 재조회 경로 어디에도 없다
  const again = JSON.stringify([await t.as('cust').contracts.get(c.contractId), await t.as('cust').contracts.list(), await t.as('kmNew').access.grants()]);
  assert.ok(!again.includes(token));
  // 응답 로그 중 token이 나오는 것은 등록 응답 1건뿐
  const hits = t.log.filter(l => JSON.stringify(l.body).includes(token));
  assert.deepEqual(hits.map(h => h.op), ['contracts.create']);
  // 알림에는 일반 문구 + 참조뿐
  t.admin.notifications().forEach(n => assert.ok(n.refType && n.refId && n.text && !/\d{8}/.test(n.text)));
});

test('claim: 시도 상한(설정값) 초과 시 429 잠금, 맞는 번호도 잠금 중에는 거부, 시간이 지나면 풀린다', async () => {
  const t = setup({ config: { claimMaxAttempts: 3, claimLockMinutes: 10 } });
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'L-1', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  for (let i = 0; i < 3; i++) assert.equal(await code(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: '1234567' + i })), NF);
  assert.equal(await code(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken })), '429:VLP-RATE-429');
  t.admin.advanceTime(11 * 60e3);
  const ok = await t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken });
  assert.equal(ok.status, 'ACTIVE');
});

test('claim: 다른 전화번호로는 맞는 번호를 알아도 열 수 없다 (전화번호 일치 필수)', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'P-1', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  const other = { userId: 'km-77', role: 'karmaster', phone: '010-7777-7777', name: '다른사람' };
  t.f.session.set(other);
  assert.equal(await code(t.f.access.claim({ pin: '123456', pinConfirm: '123456', phone: other.phone, claimToken: c.claimToken })), NF);
  assert.equal(await code(t.f.access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken })), NF);   // 번호만 도용해도 신원 불일치
  assert.equal(await code(t.as('kmNew').contracts.get(c.contractId)), NF);                                   // 여전히 미개방
});

test('미승인 48시간 후 자동 만료(설정값): EXPIRED, 승인·claim 불가, 재발급하면 되살아난다', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'E-1', vehicleModel: '쏘나타', carmasterPhone: IDS.kmNew.phone });
  const g = (await t.as('kmNew').access.grants()).items[0];
  t.admin.advanceTime(49 * 3600e3);
  const view = await t.as('cust').contracts.get(c.contractId);
  assert.equal(view.status, 'EXPIRED');
  assert.ok(t.admin.events().some(e => e.eventType === 'ContractExpired') && t.admin.events().some(e => e.eventType === 'AccessGrantExpired'));
  assert.equal(await code(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken })), NF);
  const re = await t.as('cust').access.reissue(g.grantId);
  assert.equal((await t.as('cust').contracts.get(c.contractId)).status, 'PENDING_APPROVAL');
  assert.equal((await t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: re.claimToken })).status, 'ACTIVE');
  assert.equal(await code(t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken })), NF); // 옛 번호는 무효
});

test('만료 시간은 설정으로 바뀐다 (코드에 박혀 있지 않다)', async () => {
  const t = setup({ config: { unapprovedExpiryHours: 1 } });
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'C-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  t.admin.advanceTime(61 * 60e3);
  assert.equal((await t.as('cust').contracts.get(c.contractId)).status, 'EXPIRED');
});

test('거절 후 같은 제조사 계약번호로 재등록 가능, 승인/대기 중이면 중복 409', async () => {
  const t = setup();
  const mk = () => t.as('cust').contracts.create({ manufacturerContractNo: 'D-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  const a = await mk();
  assert.equal(await code(mk()), CONFLICT);
  await t.as('km').contracts.reject(a.contractId, { reasonCode: 'WRONG' });
  assert.equal(await code(t.as('km').contracts.approve(a.contractId, { destinationType: 'DEALERSHIP' })), CONFLICT);
  assert.ok((await mk()).contractId);
});

test('필수 3개(제조사 계약번호, 차량 모델, 카마스터 연락처) 누락 시 422와 누락 목록', async () => {
  const t = setup();
  for (const miss of ['manufacturerContractNo', 'vehicleModel', 'carmasterPhone']) {
    const body = { manufacturerContractNo: 'M-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone }; delete body[miss];
    try { await t.as('cust').contracts.create(body); assert.fail('통과하면 안 됨'); } catch (e) { assert.equal(e.status, 422); assert.deepEqual(e.details.missing, [miss]); }
  }
});

test('단계 건너뛰기 거부: 확인 전 출고 요청, 요청 전 출고 의뢰, 이중 확인', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'F-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  assert.equal(await code(t.as('cust').contracts.confirm(c.contractId)), CONFLICT);                     // 승인 전 확인
  await t.as('km').contracts.approve(c.contractId, { destinationType: 'DEALERSHIP' });
  assert.equal(await code(t.as('cust').contracts.releaseRequest(c.contractId, { deliverySiteId: SITE2, receiptMode: 'ON_SITE' })), CONFLICT); // 확인 전 출고
  await t.as('cust').contracts.confirm(c.contractId);
  assert.equal(await code(t.as('cust').contracts.confirm(c.contractId)), CONFLICT);
  assert.equal(await code(t.as('km').contracts.releaseOrder(c.contractId, {})), CONFLICT);              // 출고 요청 없이 의뢰
});

test('원격 인수 위임: 동의 없으면 422, 시공사 없는 인도지에서는 대리 인수 불가', async () => {
  const t = setup();
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'R-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  await t.as('km').contracts.approve(c.contractId, { destinationType: 'AFFILIATED_SHOP' }); await t.as('cust').contracts.confirm(c.contractId);
  assert.equal(await code(t.as('cust').contracts.releaseRequest(c.contractId, { deliverySiteId: SITE1, receiptMode: 'REMOTE_PROXY' })), VAL);
  assert.equal(await code(t.as('cust').contracts.releaseRequest(c.contractId, { customAddress: '울산 어딘가', receiptMode: 'REMOTE_PROXY', proxyConsent: true })), VAL);
  assert.equal(await code(t.as('cust').contracts.releaseRequest(c.contractId, { deliverySiteId: SITE2, receiptMode: 'REMOTE_PROXY', proxyConsent: true })), VAL);
  assert.equal(await code(t.as('cust').contracts.releaseRequest(c.contractId, { receiptMode: 'ON_SITE' })), VAL);   // 인도지 없음
});

test('보강정보 초안은 고객·시공사 응답에 없고, 게시하면 보인다', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT');
  const a = await t.as('km').deliveries.addAugmentation(ids.deliveryId, { kind: 'NOTE', text: '내부용 초안 문구' });
  const texts = async (who) => JSON.stringify((await t.as(who).deliveries.timeline(ids.deliveryId)).items);
  assert.ok(!(await texts('cust')).includes('내부용 초안 문구'));
  assert.ok(!(await texts('shop')).includes('내부용 초안 문구'));
  assert.ok((await texts('km')).includes('내부용 초안 문구') && (await texts('admin')).includes('내부용 초안 문구'));
  await t.as('km').deliveries.publishAugmentation(ids.deliveryId, a.augmentationId);
  assert.ok((await texts('cust')).includes('내부용 초안 문구'));
  assert.equal(await code(t.as('km').deliveries.publishAugmentation(ids.deliveryId, a.augmentationId)), CONFLICT);
  assert.equal(await code(t.as('cust').deliveries.addAugmentation(ids.deliveryId, { kind: 'NOTE', text: 'x' })), NF);       // 고객은 보강 불가
});

test('배송 응답에 기사 개인 연락처가 없다 (BR-10): 탁송사 대표번호만', async () => {
  const t = setup();
  const ids = await toReleased(t);
  const d = await t.as('cust').deliveries.get(ids.deliveryId);
  assert.deepEqual(Object.keys(d.deliveryCompany).sort(), ['mainPhone', 'name']);
  assert.ok(!/driver|기사/i.test(JSON.stringify(d)));
});

test('지연 사유: 코드는 설정 목록만, 기타는 직접 입력 필수, 진행 중 지연이 있으면 중복 거부', async () => {
  const t = setup();
  const ids = await toReleased(t);
  t.admin.advance(ids.deliveryId, 'SHIPPED');
  assert.equal(await code(t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'aliens' })), VAL);
  assert.equal(await code(t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'other' })), VAL);
  const x = await t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'other', note: '직접 입력' });
  assert.equal(await code(t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'weather' })), CONFLICT);
  assert.equal(await code(t.as('cust').deliveries.raiseException(ids.deliveryId, { reasonCode: 'weather' })), NF);          // 고객은 불가
  await t.as('km').deliveries.resolveException(ids.deliveryId, x.exceptionId);
  assert.equal(await code(t.as('km').deliveries.resolveException(ids.deliveryId, x.exceptionId)), CONFLICT);
});

test('위치 수집 상태: 배차 전 NOT_STARTED -> COLLECTING -> (자동 수집 끊기면) STALE -> 도착 후 STOPPED', async () => {
  const t = setup();
  const ids = await toReleased(t);
  const st = async () => (await t.as('cust').deliveries.location(ids.deliveryId)).collectionStatus;
  assert.equal(await st(), 'NOT_STARTED');
  t.admin.advance(ids.deliveryId, 'SHIPPED'); assert.equal(await st(), 'COLLECTING');
  t.admin.advance(ids.deliveryId, 'IN_TRANSIT'); t.admin.observe(ids.deliveryId, '경북 구미');
  t.admin.advanceTime(31 * 60e3); assert.equal(await st(), 'STALE');
  const stale = await t.as('admin').admin.collectionStatus();
  assert.equal(stale.items[0].collectionStatus, 'STALE'); assert.ok(stale.items[0].staleMinutes >= 31);
  t.admin.advance(ids.deliveryId, 'ARRIVED'); assert.equal(await st(), 'STOPPED');
  const loc = await t.as('cust').deliveries.location(ids.deliveryId);
  assert.equal(loc.latest.sourceType, 'AUTO'); assert.ok(loc.destinationAddress);
});

test('사진: 이미지만, 필수 촬영 슬롯 검증, 남의 사진 회수 불가, 종결 후 회수 불가', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  toArrived(t, ids);
  assert.equal(await code(t.as('shop').media.init(ids.deliveryId, { purpose: 'OTHER', contentType: 'application/pdf' })), VAL);
  assert.equal(await code(t.as('shop').media.init(ids.deliveryId, { purpose: 'REQUIRED_SHOT', slot: 'NOPE', contentType: 'image/jpeg' })), VAL);
  const m = await t.as('shop').media.init(ids.deliveryId, { purpose: 'OTHER', contentType: 'image/png' });
  assert.equal(await code(t.as('km').media.complete(m.mediaId)), NF);                    // 업로더가 아니다
  await t.as('shop').media.complete(m.mediaId);
  assert.equal(await code(t.as('shop').media.complete(m.mediaId)), CONFLICT);
  assert.equal(await code(t.as('shop2').media.withdraw(m.mediaId)), NF);
  assert.equal(await code(t.as('cust').media.withdraw(m.mediaId)), NF);
});

async function proxyReady(t, ids) {
  toArrived(t, ids);
  const photoIds = [];
  for (const slot of VLP.config.get('requiredShotSlots')) {
    const init = await t.as('shop').media.init(ids.deliveryId, { purpose: 'REQUIRED_SHOT', slot, contentType: 'image/jpeg' });
    await t.as('shop').media.complete(init.mediaId); photoIds.push(init.mediaId);
  }
  return photoIds;
}

test('대리 인수: 필수 촬영이 끝나지 않으면 422(누락 슬롯 안내), 도착 전에는 409', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  assert.equal(await code(t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: [FAKE] })), CONFLICT); // 도착 전
  toArrived(t, ids);
  const init = await t.as('shop').media.init(ids.deliveryId, { purpose: 'REQUIRED_SHOT', slot: 'EXTERIOR_FRONT', contentType: 'image/jpeg' });
  await t.as('shop').media.complete(init.mediaId);
  try { await t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: [init.mediaId] }); assert.fail('통과하면 안 됨'); }
  catch (e) { assert.equal(e.status, 422); assert.equal(e.details.subcode, 'SHOTS_INCOMPLETE'); assert.ok(e.details.missing.includes('DASHBOARD_ODOMETER') && !e.details.missing.includes('EXTERIOR_FRONT')); }
  assert.equal(await code(t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: [] })), VAL);
});

test('원격 승인: 사진 전부 열람 전 거부, 카마스터 확인 전 거부, 검수 FAIL은 사유 필수, 양측 완료 시 종결', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  const photoIds = await proxyReady(t, ids);
  await t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: photoIds });
  assert.equal(await code(t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds })), CONFLICT); // 카마스터 확인 전
  await t.as('km').handover.managerConfirm(ids.deliveryId);
  assert.equal(await code(t.as('km').handover.managerConfirm(ids.deliveryId)), CONFLICT);                                                         // 중복
  try { await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds.slice(1) }); assert.fail('통과하면 안 됨'); }
  catch (e) { assert.equal(e.details.subcode, 'PHOTOS_NOT_VIEWED'); assert.deepEqual(e.details.unseen, [photoIds[0]]); }
  assert.equal((await t.as('cust').deliveries.get(ids.deliveryId)).displayState, 'DELIVERED');       // 아직 도착(한쪽만 확인)
  t.admin.setInspection(ids.deliveryId, [{ item: '외관', result: 'PASS' }, { item: '계기판', result: 'FAIL' }]);
  try { await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds }); assert.fail('통과하면 안 됨'); }
  catch (e) { assert.equal(e.details.subcode, 'INSPECTION_FAIL_OVERRIDE_REQUIRED'); }
  const done = await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds, overrideReason: '경미한 흠집, 수용' });
  assert.equal(done.approvalType, 'REMOTE');
  const d = await t.as('cust').deliveries.get(ids.deliveryId);
  assert.equal(d.storageState, 'DELIVERED'); assert.equal(d.displayState, 'CONFIRMED');
  const types = t.admin.events().map(e => e.eventType);
  ['ManagerAcceptanceConfirmed', 'CustomerAcceptanceConfirmed', 'DeliveryCompleted', 'ProxyReceiptRecorded', 'AccessGrantExpired'].forEach(x => assert.ok(types.includes(x), x));
  assert.equal(await code(t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photoIds })), CONFLICT);
});

test('현장 입회(ON_SITE) 승인: 원격 위임이 없는 건은 REMOTE 승인 불가, 도착 전 승인 불가, 순서와 무관하게 양측이면 종결', async () => {
  const t = setup();
  const ids = await toReleased(t);
  assert.equal(await code(t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'ON_SITE' })), CONFLICT);   // 도착 전
  toArrived(t, ids);
  assert.equal(await code(t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: [] })), VAL);
  await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'ON_SITE' });                                  // 고객이 먼저
  assert.equal((await t.as('cust').deliveries.get(ids.deliveryId)).displayState, 'DELIVERED');
  await t.as('km').handover.managerConfirm(ids.deliveryId);
  assert.equal((await t.as('cust').deliveries.get(ids.deliveryId)).displayState, 'CONFIRMED');
});

test('평가: 종결 전 거부, 평가 대상 불일치 거부, 중복 거부, 설정 외 항목 거부, 포인트는 서비스별 적립', async () => {
  const t = setup();
  const ids = await toReleased(t);
  const rate = (o) => t.as('cust').engagement.rate(Object.assign({ targetType: 'KARMASTER', targetId: t.admin.ids.karmaster1, deliveryId: ids.deliveryId, aspects: [{ aspect: '전문성', score: 4 }] }, o));
  assert.equal(await code(rate()), CONFLICT);                                       // CONFIRMED 이전
  toArrived(t, ids); await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'ON_SITE' }); await t.as('km').handover.managerConfirm(ids.deliveryId);
  assert.equal(await code(rate({ targetId: t.admin.ids.karmaster2 })), VAL);         // 이 건의 카마스터가 아님
  assert.equal(await code(rate({ aspects: [{ aspect: '전문성', score: 6 }] })), VAL);
  assert.equal(await code(rate({ aspects: [{ aspect: '없는항목', score: 3 }] })), VAL);
  assert.equal(await code(t.as('cust2').engagement.rate({ targetType: 'KARMASTER', targetId: t.admin.ids.karmaster1, deliveryId: ids.deliveryId, aspects: [{ aspect: '전문성', score: 3 }] })), NF); // 남의 건
  await rate();
  assert.equal(await code(rate()), CONFLICT);                                        // 중복
  assert.equal(await code(t.as('km').engagement.points()), NF);                      // 포인트는 고객만
});

test('대화: 관리자는 읽기 전용(전송 404), 2000자 초과 422, 이전 대화는 커서로 이어서 읽는다', async () => {
  const t = setup();
  const ids = await toReleased(t);
  assert.equal(await code(t.as('admin').engagement.send(ids.contractId, { body: '관리자 발언' })), NF);
  assert.equal(await code(t.as('cust').engagement.send(ids.contractId, { body: 'x'.repeat(2001) })), VAL);
  assert.equal(await code(t.as('cust').engagement.send(ids.contractId, { body: '   ' })), VAL);
  for (let i = 1; i <= 5; i++) await t.as(i % 2 ? 'cust' : 'km').engagement.send(ids.contractId, { body: '메시지' + i });
  // 사유를 남기기 전에는 본문이 비어 있다(BR-12)
  const hidden = await t.as('admin').engagement.messages(ids.contractId, { limit: 10 });
  assert.ok(hidden.items.length === 5 && hidden.items.every(m => m.masked === true && m.body === '' && m.senderRole), '사유 없이 본문 노출');
  await t.as('admin').admin.recordSensitiveView({ viewType: 'CHAT_FULL', contractId: ids.contractId, reasonCode: 'COMPLAINT' });
  const p1 = await t.as('admin').engagement.messages(ids.contractId, { limit: 3 });
  assert.equal(p1.items.length, 3); assert.ok(p1.nextCursor);
  const p2 = await t.as('admin').engagement.messages(ids.contractId, { limit: 3, cursor: p1.nextCursor });
  assert.deepEqual(p1.items.concat(p2.items).map(m => m.body), ['메시지1', '메시지2', '메시지3', '메시지4', '메시지5']);
  assert.equal(p2.nextCursor, null);
  assert.equal(await code(t.as('admin').engagement.messages(ids.contractId, { cursor: '@@@' })), VAL);
});

test('민감 열람: 사유 코드 필수(설정 목록), 합산 시간(설정) 안의 반복은 한 건으로 합쳐진다', async () => {
  const t = setup({ config: { sensitiveViewWindowMinutes: 10 } });
  const ids = await toReleased(t);
  const rec = (o) => t.as('admin').admin.recordSensitiveView(Object.assign({ viewType: 'CHAT_FULL', contractId: ids.contractId, reasonCode: 'COMPLAINT' }, o));
  assert.equal(await code(rec({ reasonCode: 'CURIOSITY' })), VAL);
  assert.equal(await code(rec({ contractId: FAKE })), NF);
  assert.equal((await rec()).merged, false);
  t.admin.advanceTime(5 * 60e3); assert.equal((await rec()).merged, true);
  t.admin.advanceTime(20 * 60e3); assert.equal((await rec()).merged, false);        // 합산 시간 지남
  assert.equal(t.admin.sensitiveViews().length, 2);
});

test('멱등성: 같은 키 재전송은 부작용 없이 같은 응답, 다른 본문이면 422, 키가 없거나 짧으면 422', async () => {
  const t = setup();
  const body = { manufacturerContractNo: 'I-1', vehicleModel: 'x', carmasterPhone: IDS.kmNew.phone };
  const opts = { idempotencyKey: 'idem-key-0123456789' };
  const a = await t.as('cust').contracts.create(body, opts);
  const b = await t.as('cust').contracts.create(body, opts);                 // 큐 재전송 시나리오
  assert.equal(b.contractId, a.contractId); assert.equal(b.serviceContractNo, a.serviceContractNo);
  assert.match(a.claimToken, /^\d{8}$/); assert.equal(b.claimToken, null);          // 재전송 응답에는 조회번호를 다시 싣지 않는다(저장 금지) -> 복구는 reissue
  assert.equal(t.admin.state().contracts.length, 1);
  assert.equal(t.admin.events().filter(e => e.eventType === 'ContractRegistered').length, 1);
  assert.equal(await code(t.as('cust').contracts.create(Object.assign({}, body, { vehicleModel: 'y' }), opts)), VAL);
  assert.equal(await code(t.as('cust').contracts.create({ manufacturerContractNo: 'I-2', vehicleModel: 'x', carmasterPhone: IDS.km.phone }, { idempotencyKey: 'short' })), VAL);
  const raw = await t.adapter.request({ op: 'contracts.create', method: 'POST', path: '/lifecycle/contracts', body, idempotencyKey: null, identity: IDS.cust });
  assert.equal(raw.status, 422);
  // facade는 키를 지정하지 않아도 매번 새 키를 만든다 -> 같은 번호 재등록은 중복 409
  assert.equal(await code(t.as('cust').contracts.create({ manufacturerContractNo: 'I-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone })), CONFLICT);
});

test('facade: 명령에는 Idempotency-Key(16자 이상)가 자동으로 붙고, 조회에는 붙지 않는다', async () => {
  const t = setup();
  const seen = []; t.f.onRequest(r => seen.push([r.op, r.idempotencyKey]));
  await t.as('cust').contracts.create({ manufacturerContractNo: 'Z-1', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  await t.as('cust').contracts.list();
  assert.ok(seen[0][1].length >= 16 && seen[0][1].length <= 128); assert.equal(seen[1][1], null);
  await assert.rejects(() => t.f.deliveries.get(), /경로 변수/);                            // 경로 변수 누락은 호출 전에 막는다
});

test('대화: 열람 합산 시간이 지나면 다시 본문이 가려지고, 고객·카마스터에게는 항상 보인다, 새 메시지 알림은 내용 없이 상대에게만', async () => {
  const t = setup({ config: { sensitiveViewWindowMinutes: 10 } });
  const ids = await toReleased(t);
  await t.as('cust').engagement.send(ids.contractId, { body: '비밀 내용 123' });
  const km0 = (await t.as('km').notifications.list({})).items.length;
  await t.as('km').engagement.send(ids.contractId, { body: '카마스터 답변' });
  assert.ok((await t.as('km').engagement.messages(ids.contractId, {})).items.every(m => m.body && !m.masked));
  assert.ok((await t.as('cust').engagement.messages(ids.contractId, {})).items.every(m => m.body && !m.masked));
  await t.as('admin').admin.recordSensitiveView({ viewType: 'CHAT_FULL', contractId: ids.contractId, reasonCode: 'SUPERVISION' });
  assert.ok((await t.as('admin').engagement.messages(ids.contractId, {})).items.every(m => m.body));
  t.admin.advanceTime(11 * 60e3);
  assert.ok((await t.as('admin').engagement.messages(ids.contractId, {})).items.every(m => m.masked === true));
  const notes = (await t.as('cust').notifications.list({})).items.filter(n => n.text.includes('새 메시지'));
  assert.equal(notes.length, 1); assert.ok(!JSON.stringify(notes).includes('카마스터 답변'), '알림에 내용 노출');
  assert.equal((await t.as('km').notifications.list({})).items.filter(n => n.text.includes('새 메시지')).length, 1, 'km 알림 수 ' + km0);
});
