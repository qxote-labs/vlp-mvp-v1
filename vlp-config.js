/* vlp-config.js — 정책 설정 (실행계획서 11장). 미결 값은 코드에 박지 않고 여기서만 정한다.
 * 브라우저에서는 localStorage 'vlp_policy' JSON으로 덮어쓸 수 있고, 테스트·목 서버는 VLP.config.set()으로 바꾼다.
 * 값 옆의 상태 표기는 실행계획서 11·14장 기준이다.
 */
(function (g) {
  'use strict';
  const DEFAULTS = {
    // ---- 접근·조회번호 (BR-02, 14장: 수치는 JEFLIX 보안 기준 미결 -> 초기값) ----
    claimTtlHours: 48,            // 조회번호 유효시간 [미결: 초기값]
    claimMaxAttempts: 5,          // 조회번호 시도 상한 [미결: 초기값]
    claimLockMinutes: 15,         // 시도 상한 초과 후 잠금 시간 [임의 초기값, 미결]
    unapprovedExpiryHours: 48,    // 미승인 자동 만료 (11장)
    // ---- 계약 등록·승인 화면 (S1) ----
    rejectReasonCodes: [          // 카마스터 거절 사유 코드 [제안: openapi는 코드 목록을 정하지 않음]
      { code: 'NOT_MY_CONTRACT', label: '제가 체결한 계약이 아닙니다' },
      { code: 'WRONG_INFO', label: '입력 내용이 계약서와 다릅니다' },
      { code: 'DUPLICATE', label: '중복 등록입니다' },
      { code: 'OTHER', label: '기타' },
    ],
    claimNoticeTemplate: '[VLP 신차인도] {customer} 고객님의 계약이 등록되었습니다.\n카마스터 연락처(필수 입력): {karmasterPhone}\n서비스 계약번호: {no}\n조회번호: {token}\n(유효 {hours}시간, 1회용) VLP 앱의 조회번호 화면에서 위 연락처와 조회번호를 그대로 입력해 주세요.\n바로 열기: {link}',
    deliverySites: [              // 인도지 목록 [미결: openapi에 인도지 조회 API가 없어 목 레지스트리 값을 설정으로 둔다]
      { siteId: '33333333-3333-4333-8333-111111111111', name: '울산 제휴 시공소', type: 'AFFILIATED_SHOP', hasShop: true },
      { siteId: '33333333-3333-4333-8333-222222222222', name: '현대 울산 전시장', type: 'DEALERSHIP', hasShop: false },
    ],
    pinLength: 6,                 // 미가입 카마스터 확인번호 자릿수 [제안: 6자리 숫자, 미결]
    unregisteredGraceDays: 30,    // 마지막 계약 종료 후 이 기간이 지나면 미가입 카마스터 접근 불가(휴면) [제안, 미결]
    sessionHours: 12,             // 미가입 카마스터 세션 유효 시간 [임의 초기값]
    notifyUnconfirmedHours: 24,   // 카마스터 미확인 시 고객에게 리마인드 [제안, 미결]
    notifyExpiryWarnHours: 6,     // 만료 몇 시간 전에 임박 알림 [제안, 미결]
    // ---- 채널 A (시스템 SMS) ----
    systemSmsEnabled: false,      // off로 시작, 활성 시점 미결 (BR-01, PLAT-03)
    // ---- 민감 열람 (BR-12) ----
    sensitiveViewWindowMinutes: 30, // 열람 로그 합산 시간 [미결: 예 30분]
    sensitiveViewReasonCodes: ['SUPERVISION', 'COMPLAINT', 'EXCEPTION_HANDLING'], // 감독·민원·예외 처리 [제안]
    sensitiveViewReasonLabels: { SUPERVISION: '감독·점검', COMPLAINT: '민원 처리', EXCEPTION_HANDLING: '예외 상황 처리' },
    chatPageSize: 30,             // 대화 처음 보여 주는 개수. 이전 대화 보기를 누를 때마다 같은 만큼 더 [임의 초기값]
    // ---- 위치 수집 (BR-07, BR-14) ----
    locationStaleMinutes: 30,     // 자동 수집이 이 시간 이상 없으면 STALE [임의 초기값]
    // ---- 지연 사유 코드 v1 (11장: VLP 확정, API가 검증) ----
    delayReasonCodes: ['traffic', 'weather', 'vehicle_issue', 'accident', 'dispatch_delay', 'customer_schedule', 'paperwork', 'peak_season', 'other'],
    delayReasonLabels: { traffic: '교통정체', weather: '기상악화', vehicle_issue: '차량 정비·고장', accident: '교통사고', dispatch_delay: '탁송사·기사 배정 지연', customer_schedule: '고객 일정 변경 요청', paperwork: '서류·행정 처리 지연', peak_season: '성수기 물량 폭주', other: '기타' }, // v6 DELAY_REASON_OPTIONS 계승
    // ---- 위치 안내 (PWA-13: 지도 라이브러리 없이 지역 문구 + 외부 길찾기 링크) ----
    navLinkTemplate: 'https://map.kakao.com/link/search/{q}', // 길찾기 연결 서비스는 미결 [임의 초기값]. {q}=주소(URL 인코딩)
    locationNotice: '위치는 지도 좌표가 아니라 지나는 지역을 알려 드리는 안내이며, 수집 지연이 있을 수 있어요.',
    // ---- 사진 업로드 큐 (PWA-18) ----
    uploadRetryMs: 15000,         // 연결이 끊겼을 때 다시 시도하는 간격 [임의 초기값]
    photoMaxPx: 1024,             // 올리기 전 긴 변 줄임 [임의 초기값]
    photoQuality: 0.7,            // JPEG 품질 [임의 초기값]
    // ---- 인수 (BR-05, BR-06) ----
    requiredShotLabels: { EXTERIOR_FRONT: '외관 앞', EXTERIOR_REAR: '외관 뒤', EXTERIOR_LEFT: '외관 왼쪽', EXTERIOR_RIGHT: '외관 오른쪽', DASHBOARD_ODOMETER: '계기판·주행거리', NOTES: '특이사항' },
    requiredShotSlots: ['EXTERIOR_FRONT', 'EXTERIOR_REAR', 'EXTERIOR_LEFT', 'EXTERIOR_RIGHT', 'DASHBOARD_ODOMETER', 'NOTES'], // 외관 사방·계기판/주행거리·특이사항
    // ---- 평가 (BR-11, BR-13: 항목·기한 미결) ----
    ratingAspects: {              // v6 축 계승 [미결]
      KARMASTER: ['전문성', '응대속도', '친절도'],
      SHOP: ['시공품질', '일정준수', '가격정확도'],
      DELIVERY_COMPANY: ['시간 준수', '차량 상태', '응대'], // 탁송 평가 항목 미결 — 목업의 예시값(정해지면 이 설정만 교체)
    },
    customerCarSwitcher: 'menu',  // 고객 PC(≥1280) 차량 전환: menu(좌측 메뉴 '내 차량' 하위 목록, 사용자 선택 10-03) | rail | chips. 1건이면 하위 목록 없이 바로 상세
    karmasterLayout: 'top', // 카마스터 담당 고객 화면: top(기본, 사용자 확정 10-03: 상단 메뉴 + 상태 가로 띠 + 목록|상세) | side(이전: 좌측 메뉴, ?lay=side)
    customerLayout: 'b',  // 구매자 태블릿·PC: b(기본: 상단 메뉴 + 1대면 상세만·2대 이상이면 상태 칩 줄) | a(좌측 메뉴 시안) | old(이전)
    stepDescriptions: ['계약 내용을 확인합니다', '출고를 요청하고 공장에 의뢰합니다', '차량이 이동 중입니다', '도착하면 사진을 보고 인수를 승인합니다', '인도가 완료되고 평가를 남길 수 있습니다'],
    firstEntryGuide: true, // 처음 들어온 고객에게 전체 과정 안내 시트 1회(구성안 2.5)
    historyVisible: 5,            // 이력 탭 진행 기록 기본 표시 건수 [임의 초기값]
    ratingAspectsHandover: {      // 인도 건 평가 중 시공사 = 차량 구매 때 요청한 옵션(예: 썬팅) 시공 결과 만족도. 신차케어의 시공사 평가(ratingAspects.SHOP)와 항목이 다르다 [미결]
      SHOP: ['옵션 시공 만족도'],
    },
    // ---- 신차케어 (잠정: openapi에 케어 API 없음 · PKG-C 요청서 미전달. care-api.js 참고) ----
    careSteps: ['입고', '작업', '검수', '출차', '수령'], // 구성안 5단계 [구성안 기준, 단계 설명은 미결]
    careReceiveModes: [{ code: 'VISIT', label: '직접 방문 수령' }, { code: 'SHOP_DELIVERY', label: '시공사 배송' }], // 케어 = '수령 방식' [구성안: 방문 기본, 시공사 배송]
    careDefaultReceiveMode: 'VISIT',
    careIntakeRoutes: [{ code: 'CUSTOMER_VISIT', label: '고객 방문' }, { code: 'DELIVERY_TAKEOVER', label: '배송 인수(유형 A)' }, { code: 'SHOP_PICKUP', label: '시공사 수령(유형 C)' }], // 시공사가 입고 확인 때 기록 [구성안 8.3. 유형 B는 문서에 없음 — 문서 확인 필요]
    careDefaultIntakeRoute: 'CUSTOMER_VISIT',
    careIntakeShots: ['앞', '뒤', '좌', '우', '계기판', '특이사항'], // 입고 확인 필수 촬영 6컷 [구성안 5.3]
    careMaxPhotos: 6,             // 작업 중 현장 사진 상한 [구성안 5.3, v6은 3장]
    careShopQueues: [{ id: 'quote', label: '견적 요청' }, { id: 'intake', label: '입고 대기' }, { id: 'work', label: '작업 중' }, { id: 'inspect', label: '검수 대기' }, { id: 'dispute', label: '이의 대응' }, { id: 'out', label: '출차·완료' }], // 마지막 칩은 구성안 5개 큐 밖의 구현 결정(출차 후 시공사 행동이 있어서)
    careDisputeMaxRounds: 2,      // 이의→보완→재검수 허용 횟수. 넘기면 운영자 중재로 접수 [제안 10-03, 사용자 승인. 확정 수치는 미결 — 이 설정만 교체. null이면 제한 없음]
    handoverShopId: 'a',          // 신차인도 대리 인수를 맡는 인도지 시공소와 연결되는 시공업체 계정(v6 계정 id). 나머지 업체는 대리 인수 건이 없다 [미결: 인도지 시공소와 케어 시공사의 연결 방식, 서버 확정 시 교체]
    pointsPerRating: 100,         // [임의 초기값]
    // ---- 서비스 계약번호 ----
    serviceContractNoPrefix: 'SS',
    // ---- 어댑터 (PWA-02: 전환은 이 한 줄. 실 API 전환 PLAT-07은 JEFLIX 회신 후) ----
    adapter: 'mock',              // 'mock' | 'http'
    httpBaseUrl: '',              // http 어댑터용. 실제 URL은 JEFLIX가 정한다 [미결]
    // ---- 폴링 (실시간 방식 미결 -> 폴링 대체안 유지) ----
    pollIntervalMs: 3000,
    pushProvider: '',        // PWA-24: 푸시 제공자(웹푸시 등). 비어 있으면 앱 안 알림만 사용(D-33)
    vapidPublicKey: '',      // PWA-24: 웹푸시 공개키. 서버/제공자 확정 후 설정
  };
  let overrides = {};
  try { if (typeof localStorage !== 'undefined') overrides = JSON.parse(localStorage.getItem('vlp_policy') || '{}') || {}; } catch (e) { overrides = {}; }
  const cfg = Object.assign({}, DEFAULTS, overrides);
  const api = {
    get(k) { return cfg[k]; },
    all() { return Object.assign({}, cfg); },
    set(patch) { Object.assign(cfg, patch); return api.all(); },
    reset() { Object.keys(cfg).forEach(k => delete cfg[k]); Object.assign(cfg, DEFAULTS); },
    defaults: DEFAULTS,
  };
  g.VLP = g.VLP || {};
  g.VLP.config = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
