// S2: 타임라인의 보강정보·지연 식별자는 카마스터/관리자에게만, 초안은 고객에게 없음, 같은 시각 정렬 안정
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, toReleased, toArrived, checkAgainstOpenapi } = require('./_helpers');

test('타임라인: 초안·augmentationId·audience는 내부 응답에만, 고객에게는 게시 후에만', async () => {
  const t = setup(); const ids = await toReleased(t);
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT');
  const aug = await t.as('km').deliveries.addAugmentation(ids.deliveryId, { kind: 'NOTE', text: '비 때문에 천천히 이동 중', audience: 'CUSTOMER' });
  const kmView = await t.as('km').deliveries.timeline(ids.deliveryId, {});
  const draft = kmView.items.find(e => e.type === 'AUGMENTATION_DRAFT');
  assert.equal(draft.augmentationId, aug.augmentationId); assert.equal(draft.audience, 'CUSTOMER'); assert.equal(draft.published, false);
  const custBefore = await t.as('cust').deliveries.timeline(ids.deliveryId, {});
  assert.ok(!custBefore.items.some(e => e.text && e.text.includes('비 때문에')), '초안이 고객에게 보임');
  await t.as('km').deliveries.publishAugmentation(ids.deliveryId, aug.augmentationId);
  const custAfter = await t.as('cust').deliveries.timeline(ids.deliveryId, {});
  const seen = custAfter.items.find(e => e.text && e.text.includes('비 때문에'));
  assert.ok(seen && seen.published === true);
  assert.equal(seen.augmentationId, undefined); assert.equal(seen.audience, undefined);
  t.log.forEach(l => assert.deepEqual(checkAgainstOpenapi(l.op, l.status, l.body), []));
});

test('지연 항목은 exceptionId를 가지며 해소 항목과 짝이 맞는다', async () => {
  const t = setup(); const ids = await toReleased(t);
  t.admin.advance(ids.deliveryId, 'SHIPPED');
  const ex = await t.as('km').deliveries.raiseException(ids.deliveryId, { reasonCode: 'traffic' });
  await t.as('km').deliveries.resolveException(ids.deliveryId, ex.exceptionId);
  const tl = await t.as('cust').deliveries.timeline(ids.deliveryId, {});
  const r = tl.items.find(e => e.type === 'EXCEPTION_RAISED'), s = tl.items.find(e => e.type === 'EXCEPTION_RESOLVED');
  assert.equal(r.exceptionId, ex.exceptionId); assert.equal(s.exceptionId, ex.exceptionId);
});

test('같은 시각의 위치 관측·타임라인은 나중에 쌓인 것이 최신으로 안정 정렬된다', async () => {
  const t = setup({}); const ids = await toReleased(t);
  t.adapter.admin.setNow(1790000000000); // 시각 고정: 모두 같은 시각
  t.admin.advance(ids.deliveryId, 'SHIPPED'); t.admin.advance(ids.deliveryId, 'IN_TRANSIT');
  ['A', 'B', 'C'].forEach(r => t.admin.observe(ids.deliveryId, r));
  const loc = await t.as('cust').deliveries.location(ids.deliveryId);
  assert.deepEqual(loc.history.map(h => h.regionText), ['C', 'B', 'A']); assert.equal(loc.latest.regionText, 'C');
  const tl = await t.as('cust').deliveries.timeline(ids.deliveryId, {});
  const locs = tl.items.filter(e => e.type === 'LOCATION').map(e => e.text);
  assert.deepEqual(locs, ['C', 'B', 'A']);
});

test('S3: 인수 사진 보기 주소(handover.media)와 평가 대상(ratingTargets)이 화면에 필요한 값을 준다', async () => {
  const t = setup(); const ids = await toReleased(t, { proxy: true }); toArrived(t, ids);
  const shots = require('./_helpers').VLP.config.get('requiredShotSlots');
  for (const slot of shots) { const m = await t.as('shop').media.init(ids.deliveryId, { purpose: 'REQUIRED_SHOT', slot, contentType: 'image/jpeg', sizeBytes: 10 }); await t.as('shop').media.complete(m.mediaId); }
  const h = await t.as('cust').handover.get(ids.deliveryId);
  assert.equal(h.media.length, shots.length); assert.ok(h.media.every(m => m.url && m.mediaId && m.slot && m.purpose === 'REQUIRED_SHOT'));
  assert.deepEqual(h.media.map(m => m.mediaId).sort(), h.mediaIds.slice().sort());
  const d = await t.as('cust').deliveries.get(ids.deliveryId);
  assert.deepEqual(d.ratingTargets.map(x => x.targetType).sort(), ['DELIVERY_COMPANY', 'KARMASTER', 'SHOP']);
  t.log.forEach(l => assert.deepEqual(checkAgainstOpenapi(l.op, l.status, l.body), []));
});
