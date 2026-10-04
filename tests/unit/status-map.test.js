// PWA-03: 상태 매핑 전체 케이스 (실행계획서 3.3, 12장 "단위: 상태 매핑 전체 케이스")
const test = require('node:test'), assert = require('node:assert/strict');
const { VLP, doc } = require('./_helpers');
const M = VLP.statusMap;
const ev = (eventType, payload) => ({ eventType, payload: payload || {} });

test('저장 5종 -> 표시: 매핑 표 전체', () => {
  assert.deepEqual(M.STORAGE.map(M.toDisplay), ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED']);
});
test('표시 7종 -> 저장: 파생 상태(CUSTOMIZING·EXCEPTION)는 저장 값이 없다', () => {
  assert.deepEqual(M.DISPLAY.map(M.toStorage), ['PLANNED', 'SHIPPED', 'IN_TRANSIT', null, 'ARRIVED', 'DELIVERED', null]);
  assert.ok(M.isDerived('CUSTOMIZING') && M.isDerived('EXCEPTION') && !M.isDerived('READY'));
});
test('왕복: 저장을 가진 표시 상태는 toDisplay(toStorage(x)) === x', () => {
  M.DISPLAY.filter(d => !M.isDerived(d)).forEach(d => assert.equal(M.toDisplay(M.toStorage(d)), d));
});
test('핵심 함정: 저장 ARRIVED는 표시 DELIVERED("도착"), 저장 DELIVERED는 표시 CONFIRMED', () => {
  assert.equal(M.toDisplay('ARRIVED'), 'DELIVERED');
  assert.equal(M.toDisplay('DELIVERED'), 'CONFIRMED');
});
test('양측 확인 전에는 ARRIVED(도착), 확인 후 DELIVERED -> CONFIRMED', () => {
  assert.equal(M.deriveDisplay({ storageState: 'ARRIVED', events: [ev('ManagerAcceptanceConfirmed')] }), 'DELIVERED'); // 한쪽만 확인
  assert.equal(M.deriveDisplay({ storageState: 'DELIVERED', events: [ev('ManagerAcceptanceConfirmed'), ev('CustomerAcceptanceConfirmed'), ev('DeliveryCompleted')] }), 'CONFIRMED');
});
test('EXCEPTION: 지연 발생 이벤트로 파생, 해소되면 원래 상태로 돌아온다', () => {
  const raised = ev('DeliveryExceptionRaised', { exceptionId: 'x1' });
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [raised] }), 'EXCEPTION');
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [raised, ev('DeliveryExceptionResolved', { exceptionId: 'x1' })] }), 'IN_TRANSIT');
  // 두 건 중 하나만 해소하면 여전히 예외
  const two = [raised, ev('DeliveryExceptionRaised', { exceptionId: 'x2' }), ev('DeliveryExceptionResolved', { exceptionId: 'x1' })];
  assert.equal(M.deriveDisplay({ storageState: 'SHIPPED', events: two }), 'EXCEPTION');
});
test('CUSTOMIZING: 게시된 시공 보강정보가 있고 이후 배송이 움직이기 전까지', () => {
  const pub = ev('AugmentationPublished', { kind: 'CUSTOMIZING' });
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [pub] }), 'CUSTOMIZING');
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [pub, ev('DeliveryStateChanged')] }), 'IN_TRANSIT');
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [pub, ev('LocationObserved')] }), 'IN_TRANSIT');
  assert.equal(M.deriveDisplay({ storageState: 'PLANNED', events: [pub] }), 'READY');      // 출고 준비 중에는 시공 상태가 아님
  assert.equal(M.deriveDisplay({ storageState: 'ARRIVED', events: [pub] }), 'DELIVERED');
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: [ev('AugmentationPublished', { kind: 'NOTE' })] }), 'IN_TRANSIT');
});
test('우선순위: 종결(CONFIRMED)은 어떤 파생 상태보다 앞서고, EXCEPTION은 CUSTOMIZING보다 앞선다', () => {
  const evs = [ev('AugmentationPublished', { kind: 'CUSTOMIZING' }), ev('DeliveryExceptionRaised', { exceptionId: 'x1' })];
  assert.equal(M.deriveDisplay({ storageState: 'IN_TRANSIT', events: evs }), 'EXCEPTION');
  assert.equal(M.deriveDisplay({ storageState: 'DELIVERED', events: evs }), 'CONFIRMED');
});
test('v6 stage 이름 번역표 (DELIVERED=탁송 완료 -> 도착, CONFIRMED=거래 종결 -> 인도 종결)', () => {
  assert.deepEqual(['READY', 'DISPATCHED', 'IN_TRANSIT', 'IN_TRANSIT_1', 'IN_TRANSIT_2', 'CUSTOMIZING', 'DELIVERED', 'CONFIRMED', 'EXCEPTION'].map(M.fromV6Stage),
    ['READY', 'DISPATCHED', 'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT', 'CUSTOMIZING', 'DELIVERED', 'CONFIRMED', 'EXCEPTION']);
  assert.throws(() => M.fromV6Stage('DRIVER_ASSIGNED'));
});
test('알 수 없는 값은 조용히 넘어가지 않고 오류', () => {
  assert.throws(() => M.toDisplay('SHIPPING')); assert.throws(() => M.toStorage('ARRIVED'));
});
test('7개 표시 상태 모두 서로 다른 한글 문구가 있다 (색 외 텍스트 구분, PWA-12)', () => {
  assert.equal(new Set(M.DISPLAY.map(d => M.LABEL[d])).size, 7);
});
test('단계 그래프 5단계: 계약·출고·배송·도착·완료', () => {
  assert.deepEqual(M.STEPS, ['계약', '출고', '배송', '도착', '완료']);
  assert.deepEqual([null, ...M.STORAGE].map(M.stepIndex), [0, 1, 2, 2, 3, 4]);
});
test('openapi의 DisplayState·StorageState 열거와 코드가 같다', () => {
  assert.deepEqual(M.DISPLAY.slice().sort(), doc.components.schemas.DisplayState.enum.slice().sort());
  assert.deepEqual(M.STORAGE.slice().sort(), doc.components.schemas.StorageState.enum.slice().sort());
});
