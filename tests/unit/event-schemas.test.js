// API-02: 이벤트 스키마마다 샘플 payload를 검증하고, 목이 발행하는 실제 이벤트도 같은 스키마를 통과해야 한다.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Ajv = require('ajv'), addFormats = require('ajv-formats');
const { setup, toReleased, toArrived, IDS, root } = require('./_helpers');

const dir = path.join(root, 'contracts', 'events');
const names = fs.readdirSync(dir).filter(f => f.endsWith('.schema.json')).map(f => f.replace('.schema.json', '')).sort();
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
names.forEach(n => ajv.addSchema(JSON.parse(fs.readFileSync(path.join(dir, n + '.schema.json'), 'utf8'))));
const validatorFor = (n) => ajv.getSchema('https://vlp.invalid/schemas/events/' + n + '.schema.json');
const sample = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'samples', n + '.json'), 'utf8'));

// 실행계획서 5장에 나열된 이벤트 이름 (Raised/Resolved 등은 각각 별개 이벤트로 센다)
const PLAN_EVENTS = ['ContractRegistered', 'ContractApprovedByCarmaster', 'ContractConfirmedByCustomer', 'ContractExpired', 'ReleaseRequested', 'ReleaseOrdered', 'DeliveryStateChanged', 'LocationObserved', 'AugmentationPublished', 'DeliveryExceptionRaised', 'DeliveryExceptionResolved', 'MediaPublished', 'MediaWithdrawn', 'ManagerAcceptanceConfirmed', 'CustomerAcceptanceConfirmed', 'DeliveryCompleted', 'ProxyReceiptRecorded', 'AccessGrantClaimed', 'AccessGrantExpired', 'RatingSubmitted', 'PointsAwarded'];

test('5장에 나열된 이벤트 이름마다 스키마와 샘플이 있다', () => {
  assert.deepEqual(names, PLAN_EVENTS.slice().sort());
  assert.equal(names.length, 21);
});
test('각 스키마는 자기 샘플 payload를 통과한다', () => {
  names.forEach(n => { const v = validatorFor(n); assert.ok(v(sample(n)), n + ': ' + JSON.stringify(v.errors)); });
});
test('다른 이벤트의 샘플은 통과하지 못한다 (eventType 고정)', () => {
  const v = validatorFor('ContractExpired'); assert.equal(v(sample('ContractApprovedByCarmaster')), false);
});
test('정의되지 않은 필드는 거부: 조회번호·전화번호·좌표를 payload에 싣는 순간 실패', () => {
  ['ContractRegistered', 'AccessGrantClaimed', 'LocationObserved', 'MediaPublished'].forEach(n => {
    const v = validatorFor(n);
    ['claimToken', 'phone', 'lat', 'url'].forEach(k => { const s = sample(n); s.payload[k] = 'x'; assert.equal(v(s), false, n + ' + ' + k); });
  });
  const top = sample('ContractRegistered'); top.claimToken = '12345678'; assert.equal(validatorFor('ContractRegistered')(top), false); // 봉투에도 불가
});
test('필수 필드 누락은 거부', () => {
  names.forEach(n => {
    const s = sample(n); delete s.occurredAt; assert.equal(validatorFor(n)(s), false, n);
    const keys = Object.keys(sample(n).payload); if (keys.length) { const p = sample(n); delete p.payload[keys[0]]; assert.equal(validatorFor(n)(p), false, n + ' payload'); }
  });
});
test('배송 단위 이벤트는 deliveryId가 필수(null 불가), 계약 단위 이벤트는 null 허용', () => {
  const del = sample('DeliveryStateChanged'); del.deliveryId = null; assert.equal(validatorFor('DeliveryStateChanged')(del), false);
  const con = sample('ContractExpired'); con.deliveryId = null; assert.ok(validatorFor('ContractExpired')(con));
});

test('목이 실제로 발행한 이벤트가 전부 스키마를 통과한다 (전체 흐름 + 만료)', async () => {
  const t = setup();
  const ids = await toReleased(t, { proxy: true });
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT'); t.admin.observe(ids.deliveryId, '대전');
  const a = await t.as('km').deliveries.addAugmentation(ids.deliveryId, { kind: 'LOCATION', text: '추풍령', audience: 'CUSTOMER' });
  await t.as('km').deliveries.publishAugmentation(ids.deliveryId, a.augmentationId);
  const x = await t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'weather' });
  await t.as('km').deliveries.resolveException(ids.deliveryId, x.exceptionId);
  t.admin.advance(ids.deliveryId, 'ARRIVED');
  const photos = [];
  for (const slot of require('./_helpers').VLP.config.get('requiredShotSlots')) { const m = await t.as('shop').media.init(ids.deliveryId, { purpose: 'REQUIRED_SHOT', slot, contentType: 'image/jpeg' }); await t.as('shop').media.complete(m.mediaId); photos.push(m.mediaId); }
  const extra = await t.as('shop').media.init(ids.deliveryId, { purpose: 'OTHER', contentType: 'image/jpeg' }); await t.as('shop').media.complete(extra.mediaId); await t.as('shop').media.withdraw(extra.mediaId);
  await t.as('shop').handover.proxyReceipt(ids.deliveryId, { mediaIds: photos });
  await t.as('km').handover.managerConfirm(ids.deliveryId);
  await t.as('cust').handover.customerApprove(ids.deliveryId, { approvalType: 'REMOTE', viewedMediaIds: photos });
  await t.as('cust').engagement.rate({ targetType: 'SHOP', targetId: t.admin.state().registry.shops[0].shopId, deliveryId: ids.deliveryId, aspects: [{ aspect: '시공품질', score: 5 }] });
  // 미가입 카마스터 claim + 만료
  const c = await t.as('cust').contracts.create({ manufacturerContractNo: 'EV-2', vehicleModel: 'x', carmasterPhone: IDS.kmNew.phone });
  await t.as('kmNew').access.claim({ pin: '123456', pinConfirm: '123456', phone: IDS.kmNew.phone, claimToken: c.claimToken });
  await t.as('cust').contracts.create({ manufacturerContractNo: 'EV-3', vehicleModel: 'x', carmasterPhone: IDS.km.phone });
  t.admin.advanceTime(50 * 3600e3); t.admin.sweepNow();
  const evs = t.admin.events();
  const bad = evs.filter(e => !validatorFor(e.eventType)(e)).map(e => e.eventType + ' ' + JSON.stringify(validatorFor(e.eventType).errors));
  assert.deepEqual(bad, []);
  const kinds = new Set(evs.map(e => e.eventType));
  ['ContractRegistered', 'ContractApprovedByCarmaster', 'ContractConfirmedByCustomer', 'ReleaseRequested', 'ReleaseOrdered', 'DeliveryStateChanged', 'LocationObserved', 'AugmentationPublished', 'DeliveryExceptionRaised', 'DeliveryExceptionResolved', 'MediaPublished', 'MediaWithdrawn', 'ManagerAcceptanceConfirmed', 'CustomerAcceptanceConfirmed', 'DeliveryCompleted', 'ProxyReceiptRecorded', 'AccessGrantClaimed', 'AccessGrantExpired', 'RatingSubmitted', 'PointsAwarded', 'ContractExpired']
    .forEach(k => assert.ok(kinds.has(k), '발행되지 않음: ' + k));
  assert.equal(kinds.size, 21);
  assert.ok(!JSON.stringify(evs).includes(c.claimToken));
});
