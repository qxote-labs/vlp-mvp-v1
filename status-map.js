/* status-map.js — 표시 상태 7종 <-> 저장 상태 5종 (실행계획서 3.3, BR-04). v6 stage 이름은 이 파일로만 번역한다.
 *
 *   표시(화면)       저장(플랫폼)    비고
 *   READY            PLANNED        release_ordered_at 있음
 *   DISPATCHED       SHIPPED
 *   IN_TRANSIT       IN_TRANSIT
 *   DELIVERED(도착)  ARRIVED        화면 문구는 "도착"
 *   CONFIRMED        DELIVERED      양측(카마스터 개인수령확인 + 고객 최종 승인) 확인 시 전환, "인도 종결"
 *   CUSTOMIZING      (없음)         인도 중 시공 이벤트에서 파생
 *   EXCEPTION        (없음)         지연 발생·해소 이벤트에서 파생 (화면에서는 배지)
 *
 * 주의: 저장 DELIVERED와 표시 DELIVERED는 다른 상태다. 저장 ARRIVED = 표시 DELIVERED("도착"), 저장 DELIVERED = 표시 CONFIRMED.
 */
(function (g) {
  'use strict';
  const STORAGE = ['PLANNED', 'SHIPPED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED'];
  const DISPLAY = ['READY', 'DISPATCHED', 'IN_TRANSIT', 'CUSTOMIZING', 'DELIVERED', 'CONFIRMED', 'EXCEPTION'];
  const STORAGE_TO_DISPLAY = { PLANNED: 'READY', SHIPPED: 'DISPATCHED', IN_TRANSIT: 'IN_TRANSIT', ARRIVED: 'DELIVERED', DELIVERED: 'CONFIRMED' };
  const DISPLAY_TO_STORAGE = { READY: 'PLANNED', DISPATCHED: 'SHIPPED', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'ARRIVED', CONFIRMED: 'DELIVERED', CUSTOMIZING: null, EXCEPTION: null };
  const DERIVED = ['CUSTOMIZING', 'EXCEPTION'];

  // 색에만 의존하지 않는 표시 문구 (2.5, PWA-12 검증: 7개 상태가 텍스트로도 구분)
  const LABEL = { READY: '출고 준비', DISPATCHED: '배차 완료', IN_TRANSIT: '탁송 중', CUSTOMIZING: '시공 중', DELIVERED: '도착', CONFIRMED: '인도 종결', EXCEPTION: '지연·예외' };

  // 단계 그래프 5단계(계약·출고·배송·도착·완료). 저장 상태 -> 현재 단계 인덱스. 배송 건이 아직 없으면(null) '계약' 단계.
  const STEPS = ['계약', '출고', '배송', '도착', '완료'];
  const STEP_OF_STORAGE = { PLANNED: 1, SHIPPED: 2, IN_TRANSIT: 2, ARRIVED: 3, DELIVERED: 4 };
  const stepIndex = (storageState) => (storageState == null ? 0 : STEP_OF_STORAGE[storageState]);

  // v6 store.js stage 이름 -> 표시 상태 (DELIVERY_STAGE_LABELS, 변경계획서 PWA-03)
  // v6 DELIVERED("탁송 완료")는 도착이므로 표시 DELIVERED, v6 CONFIRMED("거래 종결")는 표시 CONFIRMED.
  const V6_STAGE_TO_DISPLAY = { READY: 'READY', DISPATCHED: 'DISPATCHED', IN_TRANSIT: 'IN_TRANSIT', IN_TRANSIT_1: 'IN_TRANSIT', IN_TRANSIT_2: 'IN_TRANSIT', CUSTOMIZING: 'CUSTOMIZING', DELIVERED: 'DELIVERED', CONFIRMED: 'CONFIRMED', EXCEPTION: 'EXCEPTION' };

  function check(list, v, what) { if (!list.includes(v)) throw new Error('status-map: 알 수 없는 ' + what + ' 값 ' + v); }
  function toDisplay(storageState) { check(STORAGE, storageState, '저장 상태'); return STORAGE_TO_DISPLAY[storageState]; }
  /** 표시 -> 저장. CUSTOMIZING·EXCEPTION은 저장하지 않는 파생 상태라 null. */
  function toStorage(displayState) { check(DISPLAY, displayState, '표시 상태'); return DISPLAY_TO_STORAGE[displayState]; }
  const isDerived = (displayState) => DERIVED.includes(displayState);
  function fromV6Stage(stage) { if (!(stage in V6_STAGE_TO_DISPLAY)) throw new Error('status-map: 알 수 없는 v6 stage ' + stage); return V6_STAGE_TO_DISPLAY[stage]; }

  // ---- 이벤트 파생 ----
  /** 해소되지 않은 지연이 있는가: Raised마다 같은 exceptionId의 Resolved가 있는지 본다. */
  function hasOpenException(events) {
    const open = new Set();
    (events || []).forEach(e => {
      if (e.eventType === 'DeliveryExceptionRaised') open.add(e.payload.exceptionId);
      else if (e.eventType === 'DeliveryExceptionResolved') open.delete(e.payload.exceptionId);
    });
    return open.size > 0;
  }
  /**
   * 인도 중 시공(CUSTOMIZING) 진행 여부. [구현 결정, 확인 필요] 이벤트 16종에 "시공 종료" 신호가 없어서,
   * "고객에게 게시된 CUSTOMIZING 보강정보가 있고, 그 이후 상태 변경·위치 관측이 없으면" 진행 중으로 본다.
   * 배송이 다시 움직이면(DeliveryStateChanged/LocationObserved) 시공이 끝난 것으로 간주한다. 종료 이벤트가 정해지면 이 함수만 바꾼다.
   */
  function isCustomizing(storageState, events) {
    if (storageState !== 'SHIPPED' && storageState !== 'IN_TRANSIT') return false;
    let lastCustomizing = -1;
    const evs = events || [];
    evs.forEach((e, i) => { if (e.eventType === 'AugmentationPublished' && e.payload && e.payload.kind === 'CUSTOMIZING') lastCustomizing = i; });
    if (lastCustomizing < 0) return false;
    return !evs.slice(lastCustomizing + 1).some(e => e.eventType === 'DeliveryStateChanged' || e.eventType === 'LocationObserved');
  }
  /** 화면에 보일 표시 상태. 우선순위: 종결(CONFIRMED) > EXCEPTION > CUSTOMIZING > 저장 상태 매핑. */
  function deriveDisplay(input) {
    const base = toDisplay(input.storageState);
    if (base === 'CONFIRMED') return base;
    if (hasOpenException(input.events)) return 'EXCEPTION';
    if (isCustomizing(input.storageState, input.events)) return 'CUSTOMIZING';
    return base;
  }

  const api = { STORAGE, DISPLAY, DERIVED, STORAGE_TO_DISPLAY, DISPLAY_TO_STORAGE, LABEL, STEPS, toDisplay, toStorage, isDerived, fromV6Stage, hasOpenException, isCustomizing, deriveDisplay, stepIndex, V6_STAGE_TO_DISPLAY };
  g.VLP = g.VLP || {};
  g.VLP.statusMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
