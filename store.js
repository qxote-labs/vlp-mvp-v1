/* store.js (v6)
 * 4개 역할(구매자/카마스터/시공업체/관리자)이 공유하는 저장소.
 * localStorage에 저장하고, storage 이벤트 + 0.5초 폴링으로 모든 창에 실시간 반영한다.
 *
 * 핵심 설계 (v6 — 서비스 구조 재편):
 *  - 제조사(현대기아) 정책상 카마스터가 온라인으로 개별 영업(상담 예약)을 진행할 수 없어,
 *    "신차인도서비스"와 "신차 케어 서비스"를 완전히 독립된 두 서비스로 분리했다.
 *
 *  [신차인도서비스] 카마스터가 오프라인 상담 후 계약 내용을 앱에 1차 기록(계약등록)
 *    -> 고객이 확인(계약확정) -> 고객이 최종 수령지와 함께 출고 요청 -> 카마스터가 공장에 출고 의뢰.
 *    이후 배송 단계는 현대글로비스 신차배송조회 5단계를 기준으로 한 Enum(r.stage)으로 관리한다:
 *    READY(출고처리/준비) -> DISPATCHED(탁송사인수) -> IN_TRANSIT(탁송중, 필요 시 EXCEPTION으로
 *    수동 전환 가능) -> [destinationType이 AFFILIATED_SHOP(제휴 시공소 경유)이면: IN_TRANSIT(TO_SHOP) ->
 *    CUSTOMIZING(카마스터가 시공완료 확인) -> IN_TRANSIT(TO_DESTINATION)] -> DELIVERED(도착, 카마스터
 *    개인수령확인 + 고객 최종인수승인 양쪽이 모두 끝나야) -> CONFIRMED — 이 시점이 카마스터 역할의
 *    종료 지점이다(READY/DISPATCHED는 데모에서 출고 의뢰 즉시 완료 처리된다, requestRelease 참고).
 *    목적지 유형(destinationType: DEALERSHIP/AFFILIATED_SHOP/CUSTOM_ADDRESS)은 카마스터가 지정한
 *    협력업체에서 진행하는 옵션 작업(hasCustomizing, destinationType에서 파생) 여부를 포함해 오프라인
 *    계약 시점에 이미 정해지는 것이라 이 화면에서 다시 묻지 않는다.
 *
 *  [신차 케어 서비스] 신차인도서비스와 시간적으로 완전히 분리된 독립 서비스 — data.reservations에
 *    종속되지 않고 data.careOrders에 최상위로 저장된다. 고객은 "내 차량"(=자신이 등록한 신차인도서비스
 *    예약들) 중 하나를 골라 시작하며, 그 차가 아직 출고 전이든 이미 받은 차든 상관없다(신청 시점에 차량·
 *    고객 정보를 그대로 복사해온다 — 이후 원본 예약이 바뀌어도 이 주문엔 영향 없다). 시공사를 온라인에서
 *    바로 검색·선택(카마스터와 달리 오프라인 제약 없음) -> 기본 패키지 + 추가옵션 + 요청사항으로 견적을
 *    요청 -> 시공사가 가격을 결정해 회신 -> 고객이 확인(계약 완료) -> 시공사가 입고를 직접 확인(어떻게
 *    차가 왔는지는 상관하지 않는다) -> 작업중 -> 최종검수 -> 고객 검수(오너 단독) -> 출차 -> 2차 배송
 *    -> 수령(오너 단독) -> 사후처리(정찰제 확인 -> 평가 -> 포인트 적립).
 *
 *  - 두 서비스는 완전히 독립적으로 포인트를 적립한다: 신차인도서비스는 카마스터 평가,
 *    신차 케어 서비스는 시공사 평가가 각각의 포인트 적립 트리거다. 평가는 완료 즉시 또는 이후
 *    처리 이력에서 언제든("평가 대기") 남길 수 있다.
 *  - 카마스터/시공사는 평점 검색을 위해 다차원(항목별) 평가를 받는다.
 *  - 배송 구간은 "타이머 기반 자동 시뮬레이션"으로 진행되며, 각 화면이 Store를 읽을 때마다(load() 내부 _tick)
 *    도착 시점이 지난 배송을 자동으로 도착 처리하고, 지나간 체크포인트마다 이력(log)에 기록한다. 신차인도
 *    서비스 예약과 신차 케어 서비스 주문 둘 다 각자의 transit을 독립적으로 가질 수 있다.
 */

const STORE_KEY = 'auto_mvp_store_v6';
const TRANSIT_DURATION_MS = 8000; // 데모용 배송 소요시간(실제로는 실시간 GPS 기반). 8초.

// 서비스 완료 + 평가 제출 시 지급하는 플랫폼 기본 포인트. 두 서비스가 독립적으로 각각 지급한다.
const POINT_REWARD_DELIVERY = 20000; // 신차인도서비스 완료 + 카마스터 평가
const POINT_REWARD_AFTERMARKET = 30000; // 신차 케어 서비스 완료 + 시공사 평가

// 기존 3개 샵은 이미 검증을 통과한 것으로 간주한다(verificationStatus: 'approved') — 신규 슬라이스인
// Shop 독립 레지스트리(4.3절) 도입 이전부터 있던 데모 시드 데이터이므로 소급 심사를 요구하지 않는다.
const DEFAULT_SHOPS = [
  { id: 'a', name: '울산 A샵', rating: 4.8, reviews: 127, count: 340, warranty: 12, hours: 3, tags: ['PPF 전문', '당일 시공'], priceAdj: 0, address: '울산광역시 남구 OO동 123-45', bonusPoint: 0, phone: '010-3333-4401',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '1234567890', businessRepresentativeName: '울산에이샵대표', businessStartDate: '2015-03-02', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
  { id: 'b', name: '울산 B샵', rating: 4.6, reviews: 89, count: 210, warranty: 6, hours: 4, tags: ['넓은 주차공간', '대차 지원'], priceAdj: 0, address: '울산광역시 중구 OO동 45-6', bonusPoint: 0, phone: '010-3333-4402',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '2234567890', businessRepresentativeName: '울산비샵대표', businessStartDate: '2017-07-11', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
  { id: 'c', name: '울산 C샵', rating: 4.9, reviews: 56, count: 98, warranty: 12, hours: 3, tags: ['최고 평점', '신생 인증점'], priceAdj: 40000, address: '울산광역시 남구 OO동 88-1', bonusPoint: 0, phone: '010-3333-4403',
    ownerUserId: null, groupIds: ['g_ulsan'], verificationStatus: 'approved', businessRegistrationNumber: '3234567890', businessRepresentativeName: '울산씨샵대표', businessStartDate: '2022-01-20', businessVerifiedAt: Date.now(), businessRegistrationDocUrl: '' },
];

const DEFAULT_KARMASTERS = [
  { id: 'k1', name: '김도현 카마스터', nickname: '도현매니저', nameDisplayMode: 'nickname', rating: 4.9, reviews: 212, groupIds: ['g_ulsan'], tags: ['출고 전문', '리퍼럴 인증'], preferredShopId: 'a', pin: '1111', phone: '010-2222-3301', bonusPoint: 0 },
  { id: 'k2', name: '박서연 카마스터', nickname: '서연카마스터', nameDisplayMode: 'nickname', rating: 4.7, reviews: 154, groupIds: ['g_ulsan'], tags: ['신속 상담'], preferredShopId: 'c', pin: '2222', phone: '010-2222-3302', bonusPoint: 0 },
  { id: 'k3', name: '이준호 카마스터', nickname: '준호쓰카', nameDisplayMode: 'nickname', rating: 4.95, reviews: 301, groupIds: ['g_busan', 'g_ulsan'], tags: ['VIP 응대', '리퍼럴 인증'], preferredShopId: 'b', pin: '3333', phone: '010-2222-3303', bonusPoint: 0 },
];

// Group(그룹/커뮤니티) 카탈로그 — user-account-role-model-spec.md 1.3절. type은 참고용 분류일 뿐 엄격한
// 단일 enum이 아니다(하나의 그룹이 여러 성격을 동시에 가질 수 있음). 실제 서비스라면 슈퍼바이저가
// 운영 중 계속 늘려가는 카탈로그이므로, 여기 seed는 최소 예시일 뿐이다.
const DEFAULT_GROUPS = [
  { groupId: 'g_ulsan', name: '울산', type: 'region', description: '울산광역시 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_busan', name: '부산', type: 'region', description: '부산광역시 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_gyeonggi', name: '경기', type: 'region', description: '경기 권역', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_import_dealer', name: '수입차 딜러 커뮤니티', type: 'community', description: '수입차 판매 관련 정보 교류 커뮤니티', createdBy: 'system', createdAt: Date.now() },
  { groupId: 'g_ev_service', name: '전기차 정비 네트워크', type: 'industry', description: '전기차 정비·서비스 전문 네트워크', createdBy: 'system', createdAt: Date.now() },
];

// 관리자 세분화 — user-account-role-model-spec.md 1.3/4.5/7장. 슈퍼바이저는 전체 플랫폼, 커뮤니티관리자는
// assignedGroupIds에 배정된 Group(들)로 조회·승인 범위가 제한된다.
const DEFAULT_ADMINS = [
  { id: 'admin_super', name: '박총괄 슈퍼바이저', adminScope: 'super', assignedGroupIds: [], phone: '010-9000-0001' },
  { id: 'admin_ulsan', name: '이지역 커뮤니티관리자', adminScope: 'community', assignedGroupIds: ['g_ulsan'], phone: '010-9000-0002' },
];

const CHECKPOINTS_FROM_SHOP = ['시공업체 출발', '시내 구간 이동 중', '고객 근처 도착', '고객에게 배송 도착'];

const PACKAGES = [
  { id: 'basic', name: '베이직', price: 980000, desc: '틴팅 기본 등급 · 유리막 코팅', items: ['틴팅(전 유리, 기본 등급)', '유리막 코팅'] },
  { id: 'standard', name: '스탠다드', price: 1480000, desc: '중급 반사/비반사 · PPF 4종 팩', rec: true, items: ['틴팅(전 유리, 중급 반사/비반사)', 'PPF 4종 부위(도어캐치·후미등·범퍼 하단 등)', '유리막 코팅'] },
  { id: 'premium', name: '프리미엄', price: 2180000, desc: '전면 범퍼 PPF · 가죽시트 코팅', items: ['전면 범퍼 전체 PPF', '가죽시트 코팅', '유리막 코팅'] },
];

// 신차 케어 서비스 추가옵션 카탈로그 — 시공사 간 동일한 표준 항목·가격을 쓰며, 항목명+가격으로만 구성한다
// (서비스/부품비용/서비스료 분해는 이번 단계에서는 하지 않는다). 필요시 이 배열에 항목만 추가하면 확장된다.
const OPTION_CATALOG = [
  { id: 'blackbox', name: '블랙박스 장착', price: 250000 },
  { id: 'door_ppf', name: '도어 하부 PPF 추가', price: 80000 },
  { id: 'headlight_ppf', name: '헤드라이트 PPF', price: 60000 },
  { id: 'trim_wrap', name: '실내 트림 랩핑', price: 120000 },
];

// 평점 항목 — 카마스터/시공사 각각 다차원으로 관리한다. 항목별 가중치를 반영한 통합점수 산정 방식은
// 추후 결정 과제이며, 지금은 항목별 단순 평균 + 전체 평균만 계산한다.
const RATING_DIMS_KARMASTER = [
  { id: 'expertise', label: '전문성' },
  { id: 'speed', label: '응대속도' },
  { id: 'kindness', label: '친절도' },
];
const RATING_DIMS_SHOP = [
  { id: 'quality', label: '시공품질' },
  { id: 'schedule', label: '일정준수' },
  { id: 'priceAccuracy', label: '가격정확도' },
];

// 시공업체가 실제로 조작(버튼 클릭)하는 3단계. '고객검수대기'는 여기 포함되지 않는다 — 오너의 확인으로만
// 진행되는 별도 게이트이기 때문이다. short는 화면에 노출되는 버튼 라벨, code는 내부 식별자.
const SHOP_STAGES = [
  { code: '입고완료', short: '입고완료', title: '신차 입고 및 정밀 검수', info: '도장면 단차·스크래치 확인' },
  { code: '작업중', short: '작업중', title: '마스킹 및 시공 작업 중', info: '차량 보호 마스킹 후 작업 진행' },
  { code: '최종검수', short: '작업완료', title: '작업 완료 및 청구 정리', info: '시공 완료, 청구 내역 정리' },
];
// 화면 표시(타임라인)용 전체 신차 케어 서비스 단계. 시공업체가 조작하지 않는 고객검수/출차 단계도 포함한다.
const SHOP_DISPLAY_STAGES = [
  ...SHOP_STAGES,
  { code: '고객검수대기', title: '고객 검수 확인 (오너)', info: '시공 품질을 확인해야 출차가 진행됩니다' },
  { code: '출차완료', title: '출차 완료', info: '시공업체에서 출차, 배송 대기' },
];

// 지연 사유 코드 표준셋 — 현대글로비스는 물론 업계 전반에 공개된 표준이 없어(택배 표준약관 등 조사 결과),
// new-car-delivery-tracking-ui-items-spec.md 2.2절의 자체 제정 v1 잠정안을 그대로 채택한다.
const DELAY_REASON_OPTIONS = [
  { code: 'traffic', label: '교통정체' },
  { code: 'weather', label: '기상악화' },
  { code: 'vehicle_issue', label: '차량 정비·고장' },
  { code: 'accident', label: '교통사고' },
  { code: 'dispatch_delay', label: '탁송사·기사 배정 지연' },
  { code: 'customer_schedule', label: '고객 일정 변경 요청' },
  { code: 'paperwork', label: '서류·행정 처리 지연' },
  { code: 'peak_season', label: '성수기 물량 폭주' },
  { code: 'other', label: '기타' },
];
function delayReasonLabel(code) { const f = DELAY_REASON_OPTIONS.find(o => o.code === code); return f ? f.label : ''; }

// 목적지 유형(DestinationType, 탁송 계약 시점 확정) — new-car-delivery-tracking-service-spec.md 4.1절.
// hasCustomizing(구 needsService)은 별도 필드로 저장하지 않고 destinationType에서 파생시킨다 — 두 값이
// 어긋날 일이 애초에 없도록(AFFILIATED_SHOP일 때만 커스터마이징을 거친다는 게 정의 그 자체이므로).
const DESTINATION_TYPE_OPTIONS = [
  { code: 'DEALERSHIP', label: '영업소 직행' },
  { code: 'AFFILIATED_SHOP', label: '제휴 시공소 경유(커스터마이징)' },
  { code: 'CUSTOM_ADDRESS', label: '고객 지정 장소로 배송' },
];
function destinationTypeLabel(t) { const f = DESTINATION_TYPE_OPTIONS.find(o => o.code === t); return f ? f.label : '미정'; }
function hasCustomizing(r) { return !!(r && r.destinationType === 'AFFILIATED_SHOP'); }

// ---- 카마스터 표시 이름(닉네임/실명) — user-account-role-model-spec.md 3장/4.2/5장 ----
// brandsHandled[]는 별도 필드로 저장하지 않고, 그 카마스터가 담당한 계약들의 carBrand에서 매번
// 계산한다(v1.7 "자동 유추가 기본값" 원칙 — 다만 본인이 수동으로 덮어쓰는 기능까지는 구현하지 않았다).
function brandsHandledFor(karmasterId) {
  const reservations = (window.Store ? window.Store.getReservationsByKarmaster(karmasterId) : []);
  const brands = new Set();
  reservations.forEach(r => { if (r.carBrand) brands.add(r.carBrand); });
  return Array.from(brands);
}
// hyundai_kia(현대/기아 소속) / other(그 외 브랜드) / none(연결된 계약 없음) — brandsHandled에서 파생.
function brandAffiliationFor(karmasterId) {
  const brands = brandsHandledFor(karmasterId);
  if (!brands.length) return 'none';
  return (brands.includes('현대') || brands.includes('기아')) ? 'hyundai_kia' : 'other';
}
// 고객 화면에 노출할 카마스터 표시명 — hyundai_kia 소속이면 nameDisplayMode를 무시하고 닉네임으로
// 강제한다(제조사 정책, 5장). 이 강제 대상인데 닉네임이 아직 없으면(실제 서비스라면 가입 시 필수
// 설정이지만, 이 MVP의 온보딩 폼은 닉네임 입력을 아직 받지 않는다) 실명으로 새지 않도록 마스킹된
// 전화번호로 대체한다 — 반면 강제 대상이 아닌 카마스터가 그냥 아직 닉네임을 안 정한 경우는 보호해야
// 할 정책이 없으므로 실명을 그대로 보여준다(데모 편의).
function karmasterDisplayName(k) {
  if (!k) return '카마스터';
  const forced = brandAffiliationFor(k.id) === 'hyundai_kia';
  const mode = forced ? 'nickname' : (k.nameDisplayMode || 'nickname');
  if (mode === 'real_name') return k.name;
  if (k.nickname && k.nickname.trim()) return k.nickname;
  return forced ? (window.Store ? window.Store.maskPhone(k.phone) : k.name) : k.name;
}

// ---- 관리자 스코프 필터링 — user-account-role-model-spec.md 1.3절 "오더의 스코프는 처리하는
// 카마스터/시공업체가 어느 Group에 속해 있는가로 정해진다" ----
// 슈퍼바이저(adminScope: 'super')는 항상 전체를 본다. 커뮤니티관리자는 배정된 assignedGroupIds와
// 겹치는 Group에 속한 카마스터/시공업체가 처리하는 건만 볼 수 있다 — 아직 카마스터/시공업체가
// 배정되지 않은 건(예: 고객요청 단계에서 미등록 카마스터 지정)은 스코프가 정해지지 않았으므로
// 커뮤니티관리자에게는 보이지 않는다(슈퍼바이저만 볼 수 있다).
function reservationInAdminScope(r, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  const km = window.Store ? window.Store.getKarmaster(r.karmasterId) : null;
  if (!km) return false;
  return (km.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}
function careOrderInAdminScope(c, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  const shop = window.Store ? window.Store.getShop(c.shopId) : null;
  if (!shop) return false;
  return (shop.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}
function shopInAdminScope(s, admin) {
  if (!admin || admin.adminScope !== 'community') return true;
  return (s.groupIds || []).some(gid => (admin.assignedGroupIds || []).includes(gid));
}

// Layer 2(매니저 보강) 데이터 구조. 원칙(service-spec.md 3.2/7장): 텍스트성 필드(ETA/위치코멘트/지연사유/
// 공정현황)는 "초안 저장" 시점에는 고객에게 반영되지 않고, "게시" 액션을 거쳐야 published로 넘어간다.
// 사진(인수 완료/커스터마이징 현장)만 예외로 업로드 즉시 게시되며 회수(내리기)만 제공한다.
// 기사 성명/연락처·내부 특이사항 메모는 애초에 게시 대상이 아닌 내부 전용 필드라 draft에만 존재한다.
function _emptyAugmentation() {
  return {
    draft: { driverName: '', driverPhone: '', eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '', internalMemo: '' },
    published: { eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '', publishedAt: null },
    deliveryPhotos: [], // 인수 완료 사진 { src, label, uploadedAt, withdrawn }
    customizingPhotos: [], // 커스터마이징 현장 사진 (같은 구조)
    auditLog: [], // { t, action, detail } — 게시/회수 이력
  };
}

// 데모/스토리보드 편의용 시드 예약 — 매번 계약등록→승인→확정을 손으로 밟지 않아도 "이미 진행 중인
// 사례"를 곧바로 열어볼 수 있도록 기가입 고객 2명의 예약을 미리 심어둔다. id를 10-202601-9xxx 대역에
// 고정해, seq로 자동 채번되는 실제 예약(10-YYYYMM-0001…)과 절대 겹치지 않게 한다.
const DEFAULT_RESERVATIONS = [
  {
    id: '10-202601-9001',
    createdAt: Date.now() - 6 * 86400000,
    stage: 'CONFIRMED', // 이미 인도 완료 — 신차 케어 서비스를 곧바로 시연할 수 있는 "내 차량"이 된다
    confirmCode: '910001',
    karmasterId: 'k1', pendingKarmasterPhone: '',
    customer: { name: '김민준', phone: '010-7777-1000', nickname: '' },
    carModel: '아반떼 하이브리드', carBrand: '현대', contractNumber: 'HD-2026-1001', trim: '인스퍼레이션', color: '화이트', contractDate: '2026-08-15',
    destinationType: 'DEALERSHIP', consultMemo: '', karmasterShopName: '',
    ownerReleaseRequested: true, deliveryAddress: '영업소',
    transit: null, transitStage: 'NONE',
    isManagerConfirmed: true, isCustomerApproved: true,
    deliveredAt: Date.now() - 2 * 86400000,
    inspectionResult: 'ok', inspectionNote: '', customerPhotos: [], signature: null,
    exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null,
    augmentation: _emptyAugmentation(),
    karmasterRated: false, karmasterPointsEarned: 0,
    messages: [{ from: 'customer', text: '계약 내용을 확인하고 승인해 주세요. (자동 안내)', t: Date.now() - 6 * 86400000 }],
    karmasterUnread: false,
    log: [
      { t: Date.now() - 6 * 86400000, msg: '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' },
      { t: Date.now() - 5 * 86400000, msg: '카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: 아반떼 하이브리드, 목적지 유형: 영업소 직행' },
      { t: Date.now() - 5 * 86400000, msg: '고객이 계약 내용을 확인했습니다' },
      { t: Date.now() - 3 * 86400000, msg: '도착 완료 — 영업소 (DELIVERED)' },
      { t: Date.now() - 2 * 86400000, msg: '카마스터가 개인수령확인을 완료했습니다' },
      { t: Date.now() - 2 * 86400000, msg: '고객이 최종 인수를 승인했습니다 — 신차인도서비스 완료 (CONFIRMED)' },
    ],
  },
  {
    // 김민준의 두 번째(더 오래된) 완료 이력 — "내 계약 확인"이 단건이 아니라 진짜 이력 목록(복수건)을
    // 보여주는 모습도 데모로 바로 확인할 수 있게 한다. 카마스터 평가까지 이미 끝낸 상태로 둬서, 위
    // 예약(평가 대기중)과 상태 차이도 보여준다.
    id: '10-202510-9003',
    createdAt: Date.now() - 130 * 86400000,
    stage: 'CONFIRMED',
    confirmCode: '910003',
    karmasterId: 'k3', pendingKarmasterPhone: '',
    customer: { name: '김민준', phone: '010-7777-1000', nickname: '' },
    carModel: '쏘나타', carBrand: '현대', contractNumber: 'HD-2025-5001', trim: '', color: '펄 화이트', contractDate: '2025-11-01',
    destinationType: 'DEALERSHIP', consultMemo: '', karmasterShopName: '',
    ownerReleaseRequested: true, deliveryAddress: '영업소',
    transit: null, transitStage: 'NONE',
    isManagerConfirmed: true, isCustomerApproved: true,
    deliveredAt: Date.now() - 125 * 86400000,
    inspectionResult: 'ok', inspectionNote: '', customerPhotos: [], signature: null,
    exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null,
    augmentation: _emptyAugmentation(),
    karmasterRated: true, karmasterPointsEarned: 20000,
    messages: [],
    karmasterUnread: false,
    log: [
      { t: Date.now() - 130 * 86400000, msg: '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' },
      { t: Date.now() - 129 * 86400000, msg: '카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: 쏘나타, 목적지 유형: 영업소 직행' },
      { t: Date.now() - 129 * 86400000, msg: '고객이 계약 내용을 확인했습니다' },
      { t: Date.now() - 126 * 86400000, msg: '도착 완료 — 영업소 (DELIVERED)' },
      { t: Date.now() - 125 * 86400000, msg: '카마스터가 개인수령확인을 완료했습니다' },
      { t: Date.now() - 125 * 86400000, msg: '고객이 최종 인수를 승인했습니다 — 신차인도서비스 완료 (CONFIRMED)' },
      { t: Date.now() - 124 * 86400000, msg: '고객이 카마스터를 평가했습니다 — 포인트 20,000P 적립' },
    ],
  },
  {
    id: '10-202601-9002',
    createdAt: Date.now() - 3 * 86400000,
    stage: 'CUSTOMIZING', // 진행중인 사례 — 스텝바 펄스·배송 상세정보 패널을 곧바로 확인할 수 있다
    confirmCode: '910002',
    karmasterId: 'k2', pendingKarmasterPhone: '',
    customer: { name: '이서연', phone: '010-7777-2000', nickname: '' },
    carModel: '쏘렌토 하이브리드', carBrand: '기아', contractNumber: 'KIA-2026-2002', trim: '시그니처', color: '그레이', contractDate: '2026-08-20',
    destinationType: 'AFFILIATED_SHOP', consultMemo: '', karmasterShopName: '울산오토라운지',
    ownerReleaseRequested: true, deliveryAddress: '영업소',
    transit: null, transitStage: 'NONE',
    isManagerConfirmed: false, isCustomerApproved: false,
    deliveredAt: null, inspectionResult: null, inspectionNote: '', customerPhotos: [], signature: null,
    exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null,
    augmentation: Object.assign(_emptyAugmentation(), {
      draft: { driverName: '최기사', driverPhone: '010-4444-5501', eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '1일차 틴팅 완료, 2일차 PPF 작업 중', internalMemo: '' },
      published: { eta: '', locationNote: '', delayReasonCode: '', delayReasonNote: '', customizingProgress: '1일차 틴팅 완료, 2일차 PPF 작업 중', publishedAt: Date.now() - 86400000 },
    }),
    karmasterRated: false, karmasterPointsEarned: 0,
    messages: [{ from: 'customer', text: '계약 내용을 확인하고 승인해 주세요. (자동 안내)', t: Date.now() - 3 * 86400000 }],
    karmasterUnread: false,
    log: [
      { t: Date.now() - 3 * 86400000, msg: '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' },
      { t: Date.now() - 3 * 86400000, msg: '카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: 쏘렌토 하이브리드, 목적지 유형: 제휴 시공소 경유(커스터마이징)' },
      { t: Date.now() - 2 * 86400000, msg: '고객이 계약 내용을 확인했습니다' },
      { t: Date.now() - 1 * 86400000, msg: '차량이 지정업체(울산오토라운지)에 도착했습니다 — 카마스터의 시공완료 확인 대기 (CUSTOMIZING)' },
    ],
  },
  {
    // 세 번째 데모 — DELIVERED(도착은 했지만 카마스터 개인수령확인·고객 최종인수승인 둘 다 아직)
    // 상태를 곧바로 보여준다. transit이 없는 정적인 상태라 시드로 심어도 시간에 따라 저절로
    // 바뀌지 않는다(IN_TRANSIT과 달리 만료 타이머가 없다).
    id: '10-202601-9004',
    createdAt: Date.now() - 4 * 86400000,
    stage: 'DELIVERED',
    confirmCode: '910004',
    karmasterId: 'k1', pendingKarmasterPhone: '',
    customer: { name: '박지훈', phone: '010-7777-3000', nickname: '' },
    carModel: 'K5', carBrand: '기아', contractNumber: 'KIA-2026-4001', trim: '', color: '실버', contractDate: '2026-08-22',
    destinationType: 'CUSTOM_ADDRESS', consultMemo: '', karmasterShopName: '',
    ownerReleaseRequested: true, deliveryAddress: '울산광역시 남구 자택',
    transit: null, transitStage: 'NONE',
    isManagerConfirmed: false, isCustomerApproved: false,
    deliveredAt: Date.now() - 3600000, inspectionResult: null, inspectionNote: '', customerPhotos: [], signature: null,
    exceptionReason: '', exceptionPrevStage: null, exceptionPausedAt: null,
    augmentation: _emptyAugmentation(),
    karmasterRated: false, karmasterPointsEarned: 0,
    messages: [{ from: 'customer', text: '계약 내용을 확인하고 승인해 주세요. (자동 안내)', t: Date.now() - 4 * 86400000 }],
    karmasterUnread: false,
    log: [
      { t: Date.now() - 4 * 86400000, msg: '고객이 계약내역을 등록했습니다 — 카마스터 승인 대기' },
      { t: Date.now() - 4 * 86400000, msg: '카마스터가 계약 내용을 검토하고 승인했습니다 — 차종: K5, 목적지 유형: 고객 지정 장소로 배송' },
      { t: Date.now() - 3 * 86400000, msg: '고객이 계약 내용을 확인했습니다' },
      { t: Date.now() - 3600000, msg: '도착 완료 — 울산광역시 남구 자택 (DELIVERED)' },
    ],
  },
];

// 데모용 시드 신차 케어 서비스 주문 — 위 시드 예약 중 이미 인도 완료된 건(10-202601-9001)에 연결해,
// "작업중" 상태를 곧바로 보여준다. id도 20-202601-9xxx 대역에 고정해 careSeq 자동 채번과 안 겹친다.
// 겸임 시연: 울산 B샵 대표(010-3333-4402)는 시공사이면서 다른 시공사(C샵)에 케어를 맡긴 고객이기도 하다.
const DEFAULT_USERS = [{ userId: 'u-demo-b-owner', phone: '010-3333-4402', name: '박대표', nickname: '', createdAt: 1, roleAttributes: [{ role: 'customer', active: true, attachedAt: 1 }, { role: 'shop', active: true, attachedAt: 1 }] }];
const DEFAULT_CARE_ORDERS = [
  {
    id: '20-202601-9001', reservationId: '10-202601-9001',
    customer: { name: '김민준', phone: '010-7777-1000', nickname: '' },
    carModel: '아반떼 하이브리드', trim: '인스퍼레이션', color: '화이트',
    createdAt: Date.now() - 86400000,
    shopId: 'a', mode: 'online',
    package: PACKAGES.find(p => p.id === 'standard'),
    options: [OPTION_CATALOG.find(o => o.id === 'blackbox')],
    customRequest: '',
    quotedPrice: 1730000, status: '작업중', ownerConfirmed: false, intakeRoute: 'CUSTOMER_VISIT',
    pointsUsed: 0, chargedPrice: null, chargeNote: '', priceMatch: null,
    disputed: false, disputeReason: '', shopRated: false, shopPointsEarned: 0,
    photos: [], transit: null,
    log: [
      { t: Date.now() - 86400000, msg: '신차 케어 서비스 신청 — 시공사: 울산 A샵 (온라인 즉시견적) · 대상 차량: 아반떼 하이브리드 (10-202601-9001)' },
      { t: Date.now() - 86400000, msg: '시공사 견적 회신 — 1,730,000원' },
      { t: Date.now() - 82800000, msg: '고객이 견적 확인 — 신차 케어 서비스 계약 완료' },
      { t: Date.now() - 43200000, msg: '시공 상태 변경 → 작업중' },
    ],
  },
  // 업체별 화면이 달라 보이도록 B샵·C샵에도 시드 한 건씩(데모 고객 이서연·박지훈)
  {
    id: '20-202601-9002', reservationId: null,
    customer: { name: '이서연', phone: '010-7777-2000', nickname: '' },
    carModel: '쏘렌토 하이브리드', trim: '프레스티지', color: '블랙',
    createdAt: Date.now() - 7200000, shopId: 'b', mode: 'visit',
    package: PACKAGES.find(p => p.id === 'basic'), options: [], customRequest: '틴팅 농도 상담 원합니다',
    quotedPrice: null, status: 'requested', ownerConfirmed: false,
    pointsUsed: 0, chargedPrice: null, chargeNote: '', priceMatch: null,
    disputed: false, disputeReason: '', shopRated: false, shopPointsEarned: 0, photos: [], transit: null,
    log: [{ t: Date.now() - 7200000, msg: '신차 케어 서비스 신청 — 시공사: 울산 B샵 (방문 후 협의)' }],
  },
  {
    id: '20-202601-9003', reservationId: null,
    customer: { name: '박지훈', phone: '010-7777-3000', nickname: '' },
    carModel: '아이오닉 6', trim: '프레스티지', color: '그레이',
    createdAt: Date.now() - 172800000, shopId: 'c', mode: 'online',
    package: PACKAGES.find(p => p.id === 'premium'), options: [OPTION_CATALOG.find(o => o.id === 'headlight_ppf')], customRequest: '',
    quotedPrice: 2320000, status: 'confirmed', ownerConfirmed: false,
    pointsUsed: 0, chargedPrice: null, chargeNote: '', priceMatch: null,
    disputed: false, disputeReason: '', shopRated: false, shopPointsEarned: 0, photos: [], transit: null,
    log: [
      { t: Date.now() - 172800000, msg: '신차 케어 서비스 신청 — 시공사: 울산 C샵 (온라인 즉시견적)' },
      { t: Date.now() - 169200000, msg: '시공사 견적 회신 — 2,320,000원' },
      { t: Date.now() - 165600000, msg: '고객이 견적 확인 — 신차 케어 서비스 계약 완료' },
    ],
  },
];


// ===== 시연·테스트·검증용 케어 사례 (단계·분기마다 한 건 이상) =====
// 새 화면(고객·시공사·관리자)의 모든 분기를 바로 눈으로 보고 시험할 수 있게 둔 기본 데이터다. 번호 9004~9022.
// 한 단계마다 어느 시공사·어느 고객에게 보이는지는 CARE_DEMO_GUIDE에 적어 둔다(demo.html이 보여 준다).
const SAMPLE_PALETTES = [
  ['#dbe9f7', '#2f6fa8'], ['#e7f3dd', '#4c7a2a'], ['#fbe8d9', '#b5651d'], ['#f3e2f0', '#8a3f7a'],
];
const _SHOTS = ['앞', '뒤', '좌', '우', '계기판', '특이사항'];
function _careDemo(o) {
  const H = 3600e3, now = Date.now(), pkg = PACKAGES.find(p => p.id === (o.pkg || 'standard'));
  const opts = (o.opts || []).map(id => OPTION_CATALOG.find(x => x.id === id));
  const c = {
    id: o.id, reservationId: null, customer: { name: o.cn, phone: o.cp, nickname: '' }, carModel: o.car, trim: o.trim || '', color: o.color || '',
    createdAt: now - (o.ago || 48) * H, shopId: o.shop, mode: o.mode || 'online', package: pkg, options: opts, customRequest: o.req || '',
    quotedPrice: o.quoted == null ? null : o.quoted, status: o.status, ownerConfirmed: false, intakeRoute: o.route || null, receiveMode: o.recv || 'VISIT',
    pointsUsed: o.points || 0, chargedPrice: o.charged == null ? null : o.charged, chargeNote: o.note || '', priceMatch: o.pm === undefined ? null : o.pm,
    disputed: !!o.disputed, escalated: !!o.escalated, disputeRounds: o.rounds || 0, disputeReason: o.reason || '', shopRated: !!o.rated, shopPointsEarned: o.rated ? 3000 : 0,
    photos: (o.photos || []).map((l, i) => ({ src: generateSamplePhoto(i, l), label: l, withdrawn: !!(o.withdrawn || []).includes(i) })), transit: null,
    mileage: o.km == null ? null : o.km, intakePhotos: o.route && o.intake !== false ? _SHOTS.map((l, i) => ({ label: l, src: generateSamplePhoto(i, l) })) : [],
    messages: (o.msgs || []).map((m, i) => ({ messageId: o.id + '-m' + i, senderRole: m[0], body: m[1], createdAt: new Date(now - (m[2] == null ? 5 : m[2]) * H).toISOString(), key: null })),
    log: (o.log || []).map(l => ({ t: now - l[0] * H, msg: l[1] })),
  };
  if (o.transit) c.transit = { active: true, startedAt: now, durationMs: 24 * H, destination: o.transit, checkpoints: CHECKPOINTS_FROM_SHOP, lastLoggedIdx: 0, legKind: 'to_owner' };
  return c;
}
const CARE_DEMO_GUIDE = [
  ['20-202601-9004', '울산 A샵 · 최수민', '최종검수 — 추가 금액 입력 전(시공사: 검수 요청 필요)'],
  ['20-202601-9005', '울산 A샵 · 최수민', '고객 검수 대기 — 추가 금액 청구 + 포인트 사용'],
  ['20-202601-9006', '울산 A샵 · 정하늘', '이의 1회째 — 시공사 보완 중(채팅 있음)'],
  ['20-202601-9007', '울산 A샵 · 정하늘', '이의 한도 초과 — 운영자 중재 중'],
  ['20-202601-9008', '울산 C샵 · 한도윤', '입고 완료 — 시공사 수령(유형 C), 주행거리 기록'],
  ['20-202601-9009', '울산 C샵 · 한도윤', '출차 완료 — 시공사 배송(배송 시작 전)'],
  ['20-202601-9010', '울산 C샵 · 한도윤', '수령 대기 — 방문 수령'],
  ['20-202601-9011', '울산 C샵 · 오지안', '출차 완료 후 배송 중 — 도착지 표시'],
  ['20-202601-9012', '울산 A샵 · 오지안', '견적 회신 후 고객 확인 대기'],
  ['20-202601-9013', '울산 B샵 · 윤서아', '수령 확인 — 정찰제 확인 대기'],
  ['20-202601-9014', '울산 B샵 · 윤서아', '정찰제 불일치 제보 — 운영자 확인'],
  ['20-202601-9015', '울산 B샵 · 윤서아', '정찰제 확인 완료 — 평가 대기'],
  ['20-202601-9016', '울산 B샵 · 윤서아', '모든 과정 완료(평가 포함)'],
  ['20-202601-9017', '울산 B샵 · 오지안', '견적 요청 — 방문 후 협의, 요청사항 길게'],
  ['20-202601-9018', '울산 C샵 · 최수민', '입고 대기 — 배송 인수(유형 A) 경로 예정'],
  ['20-202601-9019', '울산 A샵 · 한도윤', '작업 중 — 현장 사진 회수 1장 포함, 채팅 있음'],
  ['20-202601-9020', '울산 C샵 · 박대표', '작업 중 — 울산 B샵 대표가 고객으로 맡긴 건(고객+시공사 겸임 시연)'],
];
(function () {
  const L = (...a) => a;
  const base = [
    { id: '20-202601-9004', cn: '최수민', cp: '010-7777-4000', car: '그랜저', trim: '캘리그래피', color: '블랙', shop: 'a', pkg: 'premium', opts: ['trim_wrap'], quoted: 2300000, status: '최종검수', route: 'CUSTOMER_VISIT', km: 14, photos: ['시공 후 정면', '측면'],
      log: [L(60, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(58, '시공사 견적 회신 — 2,300,000원'), L(55, '고객이 견적 확인 — 신차 케어 서비스 계약 완료'), L(30, '입고 확인 — 고객 방문'), L(10, '시공 상태 변경 → 작업중'), L(2, '시공 상태 변경 → 최종검수')] },
    { id: '20-202601-9005', cn: '최수민', cp: '010-7777-4000', car: '쏘나타', trim: '프리미엄', color: '화이트', shop: 'a', quoted: 1480000, charged: 1600000, note: '도어 하부 추가 보강(+120,000원)', points: 20000, status: '고객검수대기', route: 'CUSTOMER_VISIT', photos: ['완성 1', '완성 2', '완성 3'],
      msgs: [['shop', '시공 마무리됐어요. 추가 보강 작업이 있어 청구 확인 부탁드려요.', 3]],
      log: [L(70, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(68, '시공사 견적 회신 — 1,480,000원'), L(66, '고객이 견적 확인 — 신차 케어 서비스 계약 완료'), L(40, '입고 확인 — 고객 방문'), L(4, '실제 청구액 입력 — 견적가 1,480,000원 + 추가 120,000원'), L(4, '시공업체가 고객 검수를 요청했습니다')] },
    { id: '20-202601-9006', cn: '정하늘', cp: '010-7777-5000', car: '아이오닉 5', trim: '프레스티지', color: '블루', shop: 'a', quoted: 1480000, charged: 1480000, status: '고객검수대기', route: 'DELIVERY_TAKEOVER', disputed: true, rounds: 1, reason: '문 하단 기포가 보입니다', photos: ['도어 하단'],
      msgs: [['customer', '문 하단 기포가 보여요. 확인 부탁드립니다.', 20], ['shop', '확인했습니다. 내일 오전에 보완하겠습니다.', 18]],
      log: [L(90, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(88, '시공사 견적 회신 — 1,480,000원'), L(80, '고객이 견적 확인'), L(50, '입고 확인 — 배송 인수'), L(22, '시공업체가 고객 검수를 요청했습니다'), L(20, '⚠ 고객 검수 불만족 제기(1회째) — 사유: 문 하단 기포가 보입니다')] },
    { id: '20-202601-9007', cn: '정하늘', cp: '010-7777-5000', car: 'EV6', trim: 'GT-Line', color: '그레이', shop: 'a', quoted: 1730000, charged: 1730000, status: '고객검수대기', route: 'CUSTOMER_VISIT', disputed: true, escalated: true, rounds: 3, reason: '보완 후에도 같은 부위 들뜸', photos: ['보닛'],
      msgs: [['customer', '두 번 보완했는데도 같은 곳이 들떠요.', 6]],
      log: [L(100, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(60, '입고 확인 — 고객 방문'), L(30, '⚠ 고객 검수 불만족 제기(1회째)'), L(20, '시공업체 보완 완료 — 고객 재검수 요청'), L(12, '⚠ 고객 검수 불만족 제기(2회째)'), L(8, '시공업체 보완 완료 — 고객 재검수 요청'), L(6, '⚠ 고객 검수 불만족 제기(3회째, 운영자 중재 요청) — 사유: 보완 후에도 같은 부위 들뜸')] },
    { id: '20-202601-9008', cn: '한도윤', cp: '010-7777-6000', car: '셀토스', trim: '노블레스', color: '오렌지', shop: 'c', quoted: 980000, status: '입고완료', route: 'SHOP_PICKUP', km: 12, ago: 30,
      log: [L(30, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(28, '시공사 견적 회신 — 980,000원'), L(26, '고객이 견적 확인'), L(3, '입고 확인 — 시공사 수령(유형 C)')] },
    { id: '20-202601-9009', cn: '한도윤', cp: '010-7777-6000', car: '스포티지', trim: '시그니처', color: '실버', shop: 'c', pkg: 'basic', quoted: 980000, charged: 980000, status: '출차완료', route: 'CUSTOMER_VISIT', recv: 'SHOP_DELIVERY', photos: ['완성'],
      log: [L(80, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(40, '입고 확인 — 고객 방문'), L(6, '고객 검수(출차 승인) (오너)')] },
    { id: '20-202601-9010', cn: '한도윤', cp: '010-7777-6000', car: '카니발', trim: '프레스티지', color: '블랙', shop: 'c', quoted: 1480000, charged: 1480000, status: '수령대기', route: 'CUSTOMER_VISIT', recv: 'VISIT', photos: ['완성'],
      msgs: [['shop', '내일부터 수령 가능합니다. 방문 전 연락 주세요.', 2]],
      log: [L(80, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(40, '입고 확인 — 고객 방문'), L(8, '고객 검수(출차 승인) (오너)'), L(2, '수령 준비 완료 — 고객 방문 수령 대기')] },
    { id: '20-202601-9011', cn: '오지안', cp: '010-7777-7000', car: '팰리세이드', trim: '캘리그래피', color: '그린', shop: 'c', pkg: 'premium', quoted: 2180000, charged: 2180000, status: '출차완료', route: 'CUSTOMER_VISIT', recv: 'SHOP_DELIVERY', transit: '울산 남구 삼산로 100', photos: ['완성'],
      log: [L(90, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(44, '입고 확인 — 고객 방문'), L(10, '고객 검수(출차 승인) (오너)'), L(0.2, '시공 완료 — 오너에게 재배송 시작')] },
    { id: '20-202601-9012', cn: '오지안', cp: '010-7777-7000', car: '투싼', trim: '인스퍼레이션', color: '화이트', shop: 'a', quoted: 1230000, status: 'quoted', ago: 5,
      log: [L(5, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(3, '시공사 견적 회신 — 1,230,000원')] },
    { id: '20-202601-9013', cn: '윤서아', cp: '010-7777-8000', car: '코나 일렉트릭', trim: '인스퍼레이션', color: '옐로', shop: 'b', pkg: 'basic', quoted: 980000, charged: 980000, status: '수령확인', pm: null, route: 'CUSTOMER_VISIT', photos: ['완성'],
      log: [L(120, '신차 케어 서비스 신청 — 시공사: 울산 B샵'), L(60, '입고 확인 — 고객 방문'), L(20, '고객 검수(출차 승인) (오너)'), L(2, '최종 수령 확인 (오너)')] },
    { id: '20-202601-9014', cn: '윤서아', cp: '010-7777-8000', car: '니로', trim: '시그니처', color: '블루', shop: 'b', quoted: 1480000, charged: 1780000, note: '추가 PPF(+300,000원)', status: '수령확인', pm: false, route: 'CUSTOMER_VISIT', photos: ['완성'],
      msgs: [['customer', '견적보다 30만원이 더 나왔는데 사전 설명이 없었어요.', 8]],
      log: [L(130, '신차 케어 서비스 신청 — 시공사: 울산 B샵'), L(70, '입고 확인 — 고객 방문'), L(12, '실제 청구액 입력 — 견적가 1,480,000원 + 추가 300,000원'), L(9, '최종 수령 확인 (오너)'), L(8, '정찰제 불일치 제보')] },
    { id: '20-202601-9015', cn: '윤서아', cp: '010-7777-8000', car: '레이', trim: '프레스티지', color: '민트', shop: 'b', pkg: 'basic', quoted: 980000, charged: 980000, status: '수령확인', pm: true, route: 'CUSTOMER_VISIT', photos: ['완성'],
      log: [L(150, '신차 케어 서비스 신청 — 시공사: 울산 B샵'), L(90, '입고 확인 — 고객 방문'), L(30, '최종 수령 확인 (오너)'), L(29, '정찰제 이행 확인(일치)')] },
    { id: '20-202601-9016', cn: '윤서아', cp: '010-7777-8000', car: 'G80', trim: '프레스티지', color: '블랙', shop: 'b', pkg: 'premium', quoted: 2180000, charged: 2180000, status: '수령확인', pm: true, rated: true, route: 'SHOP_PICKUP', recv: 'SHOP_DELIVERY', photos: ['완성'], ago: 240,
      log: [L(240, '신차 케어 서비스 신청 — 시공사: 울산 B샵'), L(200, '입고 확인 — 시공사 수령(유형 C)'), L(100, '최종 수령 확인 (오너)'), L(99, '정찰제 이행 확인(일치)'), L(98, '시공사 평가 제출')] },
    { id: '20-202601-9017', cn: '오지안', cp: '010-7777-7000', car: '아반떼 N', trim: '', color: '레드', shop: 'b', mode: 'visit', status: 'requested', ago: 1, intake: false,
      req: '선팅 농도는 전면 70%, 측후면 15%로 부탁드립니다. 블랙박스는 직접 가져온 제품(아이나비)으로 장착하고, 하이패스 단말기 위치도 상담하고 싶습니다. 시공 중 차량 내부 사진을 여러 장 보내 주세요.',
      log: [L(1, '신차 케어 서비스 신청 — 시공사: 울산 B샵 (방문 후 협의)')] },
    { id: '20-202601-9018', cn: '최수민', cp: '010-7777-4000', car: '펠리세이드 하이브리드', trim: '프레스티지', color: '화이트', shop: 'c', quoted: 1480000, status: 'confirmed', ago: 20, opts: ['blackbox'],
      log: [L(20, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(18, '시공사 견적 회신 — 1,480,000원'), L(16, '고객이 견적 확인 — 신차 케어 서비스 계약 완료')] },
    { id: '20-202601-9019', cn: '한도윤', cp: '010-7777-6000', car: 'K8', trim: '시그니처', color: '화이트', shop: 'a', quoted: 1480000, status: '작업중', route: 'CUSTOMER_VISIT', km: 8, photos: ['전면', '후면', '측면'], withdrawn: [1],
      msgs: [['customer', '작업 사진 보니 후면은 다시 찍어 주세요.', 9], ['shop', '네, 회수하고 다시 올릴게요.', 8]],
      log: [L(50, '신차 케어 서비스 신청 — 시공사: 울산 A샵'), L(48, '시공사 견적 회신 — 1,480,000원'), L(44, '고객이 견적 확인'), L(20, '입고 확인 — 고객 방문'), L(8, '현장 사진 회수: 후면')] },
    { id: '20-202601-9020', cn: '박대표', cp: '010-3333-4402', car: '쏘렌토', trim: '프레스티지', color: '그레이', shop: 'c', quoted: 1480000, status: '작업중', route: 'CUSTOMER_VISIT', km: 5, photos: ['전면'],
      log: [L(30, '신차 케어 서비스 신청 — 시공사: 울산 C샵'), L(28, '시공사 견적 회신 — 1,480,000원'), L(26, '고객이 견적 확인'), L(10, '입고 확인 — 고객 방문')] },
  ];
  base.forEach(o => DEFAULT_CARE_ORDERS.push(_careDemo(o)));
  // 기존 시드 1건에도 대화를 붙인다(고객 김민준 ↔ 울산 A샵)
  const c1 = DEFAULT_CARE_ORDERS.find(c => c.id === '20-202601-9001');
  if (c1) c1.messages = [{ messageId: '9001-m0', senderRole: 'customer', body: '블랙박스는 어느 위치에 달리나요?', createdAt: new Date(Date.now() - 20 * 3600e3).toISOString(), key: null }, { messageId: '9001-m1', senderRole: 'shop', body: '룸미러 뒤쪽 중앙에 장착합니다.', createdAt: new Date(Date.now() - 19 * 3600e3).toISOString(), key: null }];
})();

function _emptyStore() {
  return { reservations: DEFAULT_RESERVATIONS.slice(), careOrders: DEFAULT_CARE_ORDERS.slice(), shops: DEFAULT_SHOPS, karmasters: DEFAULT_KARMASTERS, groups: DEFAULT_GROUPS, admins: DEFAULT_ADMINS, seq: 0, careSeq: 0, pointWallets: {}, ratings: [], users: [], unclaimedKarmasters: [] };
}

const Store = {
  _cache: null,
  _lastRaw: null,
  _listeners: [],

  load() {
    const raw = localStorage.getItem(STORE_KEY);
    if (!(raw !== this._lastRaw || !this._cache)) return this._cache;
    this._lastRaw = raw;
    this._cache = raw ? JSON.parse(raw) : _emptyStore();
    if (!this._cache.reservations) this._cache.reservations = [];
    if (!this._cache.careOrders) this._cache.careOrders = [];
    // 시드 예약/케어 주문(v6.40)은 _emptyStore()를 거칠 때(=localStorage가 완전히 비어있을 때)만
    // 들어간다 — 이 앱을 이미 써봐서 localStorage에 예전 데이터가 남아있는 브라우저에서는 raw가
    // 있으므로 절대 채워지지 않는다. 어느 쪽이든 항상 보이도록, 없으면 여기서 멱등하게 끼워넣는다.
    DEFAULT_RESERVATIONS.forEach(seed => { if (!this._cache.reservations.some(r => r.id === seed.id)) this._cache.reservations.push(seed); });
    DEFAULT_CARE_ORDERS.forEach(seed => { if (!this._cache.careOrders.some(c => c.id === seed.id)) this._cache.careOrders.push(seed); });
    if (!this._cache.shops) this._cache.shops = DEFAULT_SHOPS;
    if (!this._cache.karmasters) this._cache.karmasters = DEFAULT_KARMASTERS;
    delete this._cache.drivers; // [PWA-01] 이전 localStorage에 남은 driver 계정 데이터 제거
    if (!this._cache.admins) this._cache.admins = DEFAULT_ADMINS;
    if (!this._cache.groups) this._cache.groups = DEFAULT_GROUPS;
    if (!this._cache.pointWallets) this._cache.pointWallets = {};
    if (!this._cache.ratings) this._cache.ratings = [];
    if (!this._cache.users) this._cache.users = [];
    DEFAULT_USERS.forEach(seed => { if (!this._cache.users.some(u => (u.phone || '').replace(/[^0-9]/g, '') === seed.phone.replace(/[^0-9]/g, ''))) this._cache.users.push(JSON.parse(JSON.stringify(seed))); });
    if (!this._cache.unclaimedKarmasters) this._cache.unclaimedKarmasters = [];
    this._tick(this._cache);
    return this._cache;
  },

  // 배송 타이머가 만료된 건(신차인도서비스 예약 + 신차 케어 서비스 주문 각각 독립적으로)을 자동으로
  // "도착" 처리하고, 중간에 통과한 위치 체크포인트도 시간과 함께 이력(log)에 기록한다.
  _tick(data) {
    let changed = false;
    (data.reservations || []).forEach(r => {
      if (!r.transit || !r.transit.active) return;
      if (r.stage === 'EXCEPTION') return; // 지연/예외 상태에서는 배송 시계를 멈춘다 — 매니저가 재개해야 다시 진행된다
      const elapsed = Date.now() - r.transit.startedAt;
      if (elapsed >= r.transit.durationMs) { this._arriveReservation(r); changed = true; }
      else if (this._logCheckpoint(r)) changed = true;
    });
    (data.careOrders || []).forEach(c => {
      if (!c.transit || !c.transit.active) return;
      const elapsed = Date.now() - c.transit.startedAt;
      if (elapsed >= c.transit.durationMs) { this._arriveCareOrder(c); changed = true; }
      else if (this._logCheckpoint(c)) changed = true;
    });
    if (changed) this._persist(data, null);
  },

  _logCheckpoint(entity) {
    const idx = this._checkpointIdx(entity.transit);
    if (idx > (entity.transit.lastLoggedIdx || 0)) {
      for (let i = (entity.transit.lastLoggedIdx || 0) + 1; i <= idx; i++) {
        entity.log = (entity.log || []).concat([{ t: Date.now(), msg: `위치 업데이트 — ${entity.transit.checkpoints[i]}` }]);
      }
      entity.transit.lastLoggedIdx = idx;
      return true;
    }
    return false;
  },

  _checkpointIdx(transit) {
    const pct = Math.min(1, (Date.now() - transit.startedAt) / transit.durationMs);
    const cps = transit.checkpoints || [];
    return Math.min(cps.length - 1, Math.floor(pct * cps.length));
  },

  // 목적지에 맞는 위치 체크포인트를 포함한 transit 객체를 만든다. legKind는
  // 신차인도서비스가 카마스터 지정업체를 경유하는 경우(A-경로)에만 의미가 있다 — 'to_shop'이면 도착해도
  // 오너의 수령확인으로 이어지지 않고 카마스터의 시공완료 확인을 기다린다(_arriveReservation 참고).
  _buildTransit(destination, checkpoints, legKind) {
    return { active: true, startedAt: Date.now(), durationMs: TRANSIT_DURATION_MS, destination, checkpoints, lastLoggedIdx: 0, legKind: legKind || 'to_owner' };
  },

  // 신차인도서비스 도착. 카마스터 지정업체(A-경로)로 향하는 1차 구간이었다면 오너 수령확인으로 바로
  // 넘어가지 않고 '시공중'에서 멈춘다 — 카마스터가 업체와 소통해 시공완료를 확인해야 다음(오너에게로
  // 재배송) 구간이 시작된다. 이 과정은 고객·신차 케어 서비스와 완전히 무관한 카마스터-업체 간 별개
  // 거래라, 고객 화면에는 진행 상황만 알릴 뿐 어떤 액션도 요구하지 않는다.
  _arriveReservation(r) {
    const dest = r.transit.destination;
    const legKind = r.transit.legKind;
    r.transit = null;
    r.transitStage = 'NONE';
    if (legKind === 'to_shop') {
      r.log = (r.log || []).concat([{ t: Date.now(), msg: `차량이 지정업체(${dest})에 도착했습니다 — 카마스터의 시공완료 확인 대기 (CUSTOMIZING)` }]);
      r.stage = 'CUSTOMIZING';
      return;
    }
    r.log = (r.log || []).concat([{ t: Date.now(), msg: `도착 완료 — ${dest} (DELIVERED)` }]);
    r.stage = 'DELIVERED';
    r.deliveredAt = Date.now();
  },
  // 신차 케어 서비스 도착(시공 완료 후 오너에게 재배송): 오너의 "수령확인" 게이트로 이어진다.
  _arriveCareOrder(c) {
    c.transit = null;
    c.log = (c.log || []).concat([{ t: Date.now(), msg: '도착 완료 — 오너' }]);
    c.status = '수령대기';
    c.ownerConfirmed = false;
  },

  _persist(data) {
    this._cache = data;
    const raw = JSON.stringify(data);
    this._lastRaw = raw;
    localStorage.setItem(STORE_KEY, raw);
    this._notify();
  },

  save(data) { this._persist(data); },

  reset() {
    localStorage.removeItem(STORE_KEY);
    this._cache = null;
    this._lastRaw = null;
    this._notify();
  },

  getShops() { return this.load().shops; },
  // 승인된(verificationStatus: 'approved') 업체만 — 고객에게 노출되는 목록은 항상 이걸 써야 한다
  // (user-account-role-model-spec.md 4.3절: "승인 전에는 고객에게 노출되지 않는다"). 레거시 필드가 없는
  // 레코드(verificationStatus undefined)는 이 필드가 생기기 전부터 있던 데이터이므로 승인된 것으로 본다.
  getApprovedShops() { return this.load().shops.filter(s => !s.verificationStatus || s.verificationStatus === 'approved'); },
  getShop(id) { return this.load().shops.find(s => s.id === id) || null; },
  getShopByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().shops.find(s => (s.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  // ---- 시공업체(Shop) 독립 레지스트리 — 신규 등록·승인 워크플로 (user-account-role-model-spec.md 4.3절) ----
  // 실제 국세청 "사업자등록정보 진위확인" Open API는 이 데모에서 호출할 수 없으므로, 형식 검증(10자리
  // 사업자등록번호)과 필수값 입력 여부만으로 통과/실패를 시뮬레이션한다 — 실패 사유 문구에 "데모
  // 시뮬레이션"임을 명시해 실제 API 연동으로 오인하지 않도록 한다.
  registerShop({ name, phone, businessRegistrationNumber, businessRepresentativeName, businessStartDate, businessRegistrationDocUrl, groupIds }) {
    const bn = (businessRegistrationNumber || '').replace(/[^0-9]/g, '');
    if (bn.length !== 10) return { error: 'FORMAT', message: '사업자등록번호는 숫자 10자리여야 합니다.' };
    if (!(businessRepresentativeName || '').trim() || !(businessStartDate || '').trim()) {
      return { error: 'VERIFY_FAILED', message: '사업자등록정보 진위확인에 실패했습니다(데모 시뮬레이션) — 대표자성명과 개업일자를 정확히 입력해 주세요.' };
    }
    const data = this.load();
    data.shops = data.shops || [];
    const dup = data.shops.find(s => s.businessRegistrationNumber === bn && ['pending', 'approved'].includes(s.verificationStatus));
    if (dup) return { error: 'DUPLICATE', message: '이미 등록된 사업자입니다.' };
    const shop = {
      id: 's' + Date.now(), name: (name || '').trim(), phone: phone || '',
      rating: 0, reviews: 0, count: 0, warranty: 0, hours: 0, tags: [], priceAdj: 0, address: '', bonusPoint: 0,
      ownerUserId: null, groupIds: (groupIds || []).slice(),
      verificationStatus: 'pending',
      businessRegistrationNumber: bn, businessRepresentativeName: (businessRepresentativeName || '').trim(),
      businessStartDate, businessVerifiedAt: Date.now(), businessRegistrationDocUrl: businessRegistrationDocUrl || '',
    };
    data.shops.push(shop);
    this.save(data);
    this.touchUserRole(phone, businessRepresentativeName, 'shop');
    return { shop };
  },
  approveShop(id) {
    const data = this.load();
    const idx = (data.shops || []).findIndex(s => s.id === id);
    if (idx === -1) return null;
    data.shops[idx] = Object.assign({}, data.shops[idx], { verificationStatus: 'approved' });
    this.save(data);
    return data.shops[idx];
  },
  rejectShop(id) {
    const data = this.load();
    const idx = (data.shops || []).findIndex(s => s.id === id);
    if (idx === -1) return null;
    data.shops[idx] = Object.assign({}, data.shops[idx], { verificationStatus: 'rejected' });
    this.save(data);
    return data.shops[idx];
  },

  getKarmasters() { return this.load().karmasters; },
  getKarmaster(id) { return this.load().karmasters.find(k => k.id === id) || null; },
  getKarmasterByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().karmasters.find(k => (k.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },
  // ---- 카마스터 표시 이름(닉네임/실명) — user-account-role-model-spec.md 3장/4.2절 ----
  // 닉네임 전역 유일성은 이 데모에서는 카마스터끼리만 비교한다(User.nickname과의 전체 통합은 범위 밖).
  // 대소문자·공백을 정규화한 뒤 비교한다.
  isKarmasterNicknameTaken(nickname, excludeId) {
    const norm = (nickname || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!norm) return false;
    return this.load().karmasters.some(k => k.id !== excludeId && (k.nickname || '').trim().toLowerCase().replace(/\s+/g, '') === norm);
  },
  setKarmasterProfile(id, { nickname, nameDisplayMode }) {
    const data = this.load();
    const idx = data.karmasters.findIndex(k => k.id === id);
    if (idx === -1) return null;
    const patch = {};
    if (nickname !== undefined) patch.nickname = (nickname || '').trim();
    if (nameDisplayMode !== undefined) patch.nameDisplayMode = nameDisplayMode;
    data.karmasters[idx] = Object.assign({}, data.karmasters[idx], patch);
    this.save(data);
    return data.karmasters[idx];
  },

  // ---- 관리자(슈퍼바이저/커뮤니티관리자) — user-account-role-model-spec.md 4.5/7장 ----
  getAdmins() { return this.load().admins; },
  getAdmin(id) { return this.load().admins.find(a => a.id === id) || null; },
  getAdminByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    return this.load().admins.find(a => (a.phone || '').replace(/[^0-9]/g, '') === norm) || null;
  },

  // ---- 통합 사용자(User) — "한 사람 = 하나의 계정 + 여러 역할 속성" (user-account-role-model-spec.md 1.1/3장) ----
  // 전화번호를 공통 식별자로 삼아, 구매자/카마스터/시공업체 중 어느 역할로 로그인하거나 최초로
  // 그 역할이 발생(예: 구매자는 최초 계약 등록 시점)해도 같은 User 아래 역할 속성(roleAttributes)이
  // 쌓이도록 한다 — 카마스터가 개인적으로 신차를 구매하면 같은 전화번호 아래 karmaster+customer 속성이
  // 함께 존재하는 식으로 "겸임(상호주의)"을 자연스럽게 표현한다. 이 MVP에서는 실명 인증·OTP·역할별
  // 세부 데이터(Group/Shop 레지스트리 등)까지는 구현하지 않고, 식별자 통합과 역할 속성 누적만 다룬다.
  touchUserRole(phone, name, role) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return null;
    const data = this.load();
    data.users = data.users || [];
    let u = data.users.find(x => (x.phone || '').replace(/[^0-9]/g, '') === norm);
    if (!u) {
      u = { userId: 'u' + Date.now() + Math.floor(Math.random() * 1000), phone, name: name || '', nickname: '', createdAt: Date.now(), roleAttributes: [] };
      data.users.push(u);
    } else if (name && !u.name) {
      u.name = name; // 구매자 로그인처럼 이름이 매번 함께 오는 경로에서, 아직 이름이 비어 있으면 채워준다
    }
    if (!u.roleAttributes.some(ra => ra.role === role)) {
      u.roleAttributes.push({ role, active: true, attachedAt: Date.now() });
    }
    this.save(data);
    return u;
  },
  getUsers() { return (this.load().users || []).slice().sort((a, b) => b.createdAt - a.createdAt); },
  // 전화번호 뒷자리를 마스킹한 표시용 문자열 — 미가입 카마스터는 본인이 정한 닉네임이 없으므로, 고객이
  // 이미 전화번호로 그 사람을 인지하는 흐름과 자연스럽게 이어지도록 이 형태로만 표시한다(4.2절).
  maskPhone(phone) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits.length !== 11) return phone || '';
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-**${digits.slice(9)}`;
  },

  // 검색 화면 등 "아직 가입하지 않은 사람"만 보여줘야 하는 곳에서 쓴다 — 이미 가입해 실제 카마스터로
  // 연동된(linkedUserId가 채워진) 레코드는 이제 일반 카마스터 목록 쪽에서 보여지므로 여기서는 뺀다.
  getUnclaimedKarmasters() { return (this.load().unclaimedKarmasters || []).filter(u => !u.linkedUserId); },

  // ---- Group(그룹/커뮤니티) 카탈로그 (user-account-role-model-spec.md 1.3절) ----
  // 그룹 생성은 슈퍼바이저만 할 수 있다는 원칙만 UI 쪽에서 지키면 되고(이 데모에서는 관리자 계정이
  // 슈퍼바이저를 겸한다), 카마스터/시공업체가 카탈로그에서 그룹을 고르는 것 자체는 승인이 필요 없다.
  getGroups() { return (this.load().groups || []).slice(); },
  getGroup(id) { return (this.load().groups || []).find(g => g.groupId === id) || null; },
  createGroup({ name, type, description }, createdByUserId) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const data = this.load();
    data.groups = data.groups || [];
    const group = { groupId: 'g' + Date.now(), name: trimmed, type: type || 'region', description: (description || '').trim(), createdBy: createdByUserId || 'admin', createdAt: Date.now() };
    data.groups.push(group);
    this.save(data);
    return group;
  },

  // ---- 신차인도서비스 예약 = "내 차량" ----
  getReservations() { return this.load().reservations.slice().sort((a, b) => b.createdAt - a.createdAt); },
  getReservationsByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return [];
    return this.getReservations().filter(r => (r.customer.phone || '').replace(/[^0-9]/g, '') === norm);
  },
  getReservationsByKarmaster(kid) { return this.getReservations().filter(r => r.karmasterId === kid); },
  getReservation(id) { return this.load().reservations.find(r => r.id === id) || null; },
  // 구매자 데모 로그인용 고정 목록 — DEFAULT_RESERVATIONS의 기가입 고객 2명을 그대로 노출한다.
  // 실제 예약이 새로 쌓여도 이 목록 자체는 흔들리지 않는, 다른 4개 역할과 같은 성격의 "빠른 로그인"이다.
  getDemoCustomers() {
    return [
      { name: '김민준', phone: '010-7777-1000', note: '신차인도서비스는 완료 · 신차 케어 서비스는 별도로 진행중' },
      { name: '이서연', phone: '010-7777-2000', note: '커스터마이징 진행중' },
      { name: '박지훈', phone: '010-7777-3000', note: '차량 도착 · 인수 확인 대기중' },
      { name: '최수민', phone: '010-7777-4000', note: '신차케어: 최종검수·추가 금액 청구·입고 대기(3건)' },
      { name: '정하늘', phone: '010-7777-5000', note: '신차케어: 이의 보완 중 · 운영자 중재 중' },
      { name: '한도윤', phone: '010-7777-6000', note: '신차케어: 입고(시공사 수령)·출차·수령 대기·작업 중' },
      { name: '오지안', phone: '010-7777-7000', note: '신차케어: 배송 중 · 견적 확인 대기 · 견적 요청' },
      { name: '윤서아', phone: '010-7777-8000', note: '신차케어: 정찰제 확인·불일치·평가 대기·완료' },
      { name: '박대표', phone: '010-3333-4402', note: '울산 B샵 대표(시공사) · 고객으로 C샵에 케어 작업 중 — 역할 전환 시연' },
    ];
  },

  _update(id, patch, logMsg) {
    const data = this.load();
    const idx = data.reservations.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const updated = Object.assign({}, data.reservations[idx], patch);
    if (logMsg) updated.log = (updated.log || []).concat([{ t: Date.now(), msg: logMsg }]);
    data.reservations[idx] = updated;
    this.save(data);
    return updated;
  },

  // 계약번호 포맷: "SS-YYYYMM-NNNN" (서비스유형-등록연월-일련번호).
  //  - SS: 서비스유형(10=신차인도서비스, 20=신차 케어 서비스) — 두 서비스는 완전히 독립된 계약이라 번호 자체도 분리했다.
  //  - YYYYMM: 이 앱에 등록(디지털화)된 연월 — 실제 계약일자(contractDate)와는 다를 수 있다(예: 계약은 미리, 등록은 나중에).
  //  - NNNN: 해당 서비스유형 내에서 몇 번째 계약인지(전체 누적), 서비스유형별로 별도 카운터를 쓴다.
  _fmtReservationId(serviceCode, seqNum) {
    const now = new Date();
    const yyyymm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
    return `${serviceCode}-${yyyymm}-${String(seqNum).padStart(4, '0')}`;
  },



  // ---- Layer 2: 매니저 보강 정보 (ETA/위치코멘트/지연사유/커스터마이징 공정현황 + 인수·공정 사진) ----
  // 레거시 레코드(이 필드가 생기기 전에 만들어진 예약) 대비 안전한 기본값을 돌려준다.
  getAugmentation(r) { return (r && r.augmentation) || _emptyAugmentation(); },
  // "게시하기" — 전달된 draftPatch를 먼저 초안에 반영한 뒤, 텍스트성 필드(ETA/위치코멘트/지연사유/공정현황)만
  // published로 복사한다. 기사 성명·연락처·내부 메모는 원칙적으로 게시 대상이 아니라 draft에만 남는다.
  publishAugmentation(id, draftPatch) {
    const r = this.getReservation(id);
    if (!r) return r;
    const aug = Object.assign({}, this.getAugmentation(r));
    aug.draft = Object.assign({}, aug.draft, draftPatch || {});
    const d = aug.draft;
    aug.published = Object.assign({}, aug.published, {
      eta: d.eta, locationNote: d.locationNote, delayReasonCode: d.delayReasonCode, delayReasonNote: d.delayReasonNote,
      customizingProgress: d.customizingProgress, publishedAt: Date.now(),
    });
    aug.auditLog = (aug.auditLog || []).concat([{ t: Date.now(), action: '게시', detail: 'ETA/위치코멘트/지연사유/공정현황 텍스트 게시' }]);
    return this._update(id, { augmentation: aug }, '매니저가 배송 보강 정보를 게시했습니다 — 고객 화면에 반영됨');
  },

  // 관리자/카마스터용: 배송 즉시 도착 처리 (데모 단축). 신차인도서비스 예약과 신차 케어 서비스 주문
  // 둘 다 각자 transit을 가질 수 있어서 같은 id로 두 군데 다 찾아본다.
  forceArrive(id) {
    const data = this.load();
    const r = data.reservations.find(x => x.id === id);
    if (r && r.transit) { this._arriveReservation(r); this.save(data); return r; }
    const c = data.careOrders.find(x => x.id === id);
    if (c && c.transit) { this._arriveCareOrder(c); this.save(data); return c; }
    return null;
  },


  // ---- 신차 케어 서비스: 최상위 독립 엔티티 ----
  getCareOrders() { return this.load().careOrders.slice().sort((a, b) => b.createdAt - a.createdAt); },
  getCareOrdersByPhone(phone) {
    const norm = (phone || '').replace(/[^0-9]/g, '');
    if (!norm) return [];
    return this.getCareOrders().filter(c => (c.customer.phone || '').replace(/[^0-9]/g, '') === norm);
  },
  getCareOrder(id) { return this.load().careOrders.find(c => c.id === id) || null; },
  /** 시연용: 시드 케어 사례(9001~9020)를 처음 상태로 되돌린다(그 사이 바뀐 단계·대화·사진은 사라진다). 새로 만든 신청은 그대로 둔다. */
  resetCareDemoCases() {
    const data = this.load(); const ids = DEFAULT_CARE_ORDERS.map(c => c.id);
    data.careOrders = data.careOrders.filter(c => !ids.includes(c.id)).concat(JSON.parse(JSON.stringify(DEFAULT_CARE_ORDERS)));
    this.save(data); return ids.length;
  },
  /** 케어 건 대화(고객↔시공사). 같은 Idempotency-Key는 한 번만 저장한다. */
  addCareMessage(id, role, text, key) {
    const c = this.getCareOrder(id); const body = String(text || '').trim();
    if (!c || !body) return null;
    const msgs = c.messages || [];
    if (key) { const dup = msgs.find((m) => m.key === key); if (dup) return dup; }
    const m = { messageId: 'cm' + Date.now().toString(36) + msgs.length, senderRole: role, body, createdAt: new Date().toISOString(), key: key || null };
    this._updateCare(id, { messages: msgs.concat([m]) }, null);
    return m;
  },
  /** 대화 읽음 표시: role(customer|shop)이 마지막으로 읽은 시각. 상대 메시지 중 그 이후 것이 "안 읽음"이다. */
  markCareChatRead(id, role) {
    const c = this.getCareOrder(id); if (!c) return null;
    const last = (c.messages || []).slice(-1)[0]; const cur = (c.chatRead || {})[role];
    if (!last || (cur && cur >= last.createdAt)) return c; // 바뀔 게 없으면 저장하지 않는다(폴링 재렌더 방지)
    return this._updateCare(id, { chatRead: Object.assign({}, c.chatRead, { [role]: last.createdAt }) }, null);
  },
  /** 관리자 대화 열람 기록(누가·언제·사유). 같은 사유로 창 안에서는 다시 묻지 않는다. */
  recordCareChatView(id, adminName, reasonCode) {
    const c = this.getCareOrder(id); if (!c) return null;
    return this._updateCare(id, { chatViews: (c.chatViews || []).concat([{ at: Date.now(), by: adminName || '관리자', reason: reasonCode }]) }, null);
  },
  _updateCare(id, patch, logMsg) {
    const data = this.load();
    const idx = data.careOrders.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const updated = Object.assign({}, data.careOrders[idx], patch);
    if (logMsg) updated.log = (updated.log || []).concat([{ t: Date.now(), msg: logMsg }]);
    data.careOrders[idx] = updated;
    this.save(data);
    return updated;
  },

  // "내 차량"(=신차인도서비스로 등록한 예약) 중 하나를 골라 신청한다. 그 예약이 아직 출고 전이든
  // 이미 받은 차든 상관없다. 차량·고객 정보는 신청 시점에 그 예약에서 그대로 복사해온다.
  requestCareOrder({ reservationId, shopId, mode, packageId, optionIds, customRequest, source: srcIn }) {
    // PWA: 새 모델의 내 차량(계약)은 v6 예약이 아니므로 호출 쪽이 차량·고객 정보를 source로 직접 넘길 수 있다(care-api.js)
    const source = srcIn || this.getReservation(reservationId);
    if (!source) return null;
    const pkg = PACKAGES.find(p => p.id === packageId);
    const options = (optionIds || []).map(oid => OPTION_CATALOG.find(o => o.id === oid)).filter(Boolean);
    const shop = this.getShop(shopId);
    const data = this.load();
    data.careSeq = (data.careSeq || 0) + 1;
    const id = this._fmtReservationId('20', data.careSeq);
    const order = {
      id, reservationId,
      customer: source.customer,
      carModel: source.carModel, trim: source.trim, color: source.color,
      createdAt: Date.now(),
      shopId, mode, package: pkg, options,
      customRequest: customRequest || '',
      quotedPrice: null, status: 'requested', ownerConfirmed: false,
      pointsUsed: 0, chargedPrice: null, chargeNote: '', priceMatch: null,
      disputed: false, disputeReason: '', shopRated: false, shopPointsEarned: 0,
      photos: [], transit: null,
      log: [{ t: Date.now(), msg: `신차 케어 서비스 신청 — 시공사: ${shop ? shop.name : ''} (${mode === 'online' ? '온라인 즉시견적' : '방문 협의'}) · 대상 차량: ${source.carModel || ''} (${reservationId})` }],
    };
    data.careOrders.push(order);
    this.save(data);
    return order;
  },
  aftermarketSuggestedPrice(am) {
    if (!am || !am.package) return 0;
    return am.package.price + (am.options || []).reduce((s, o) => s + o.price, 0);
  },
  respondCareQuote(id, price) {
    return this._updateCare(id, { quotedPrice: price, status: 'quoted' }, `시공사 견적 회신 — ${fmtMoney(price)}`);
  },
  confirmCareQuote(id, pointsUsed) {
    const c = this.getCareOrder(id);
    if (!c) return null;
    const balance = this.getPointBalance(c.customer.phone);
    const used = Math.max(0, Math.min(pointsUsed || 0, balance, c.quotedPrice || 0));
    const updated = this._updateCare(id, { status: 'confirmed', pointsUsed: used },
      `고객이 견적 확인 — 신차 케어 서비스 계약 완료${used ? ` · 포인트 ${used.toLocaleString()}P 사용` : ''}`);
    if (used > 0) {
      const data = this.load();
      this._adjustPoints(data, c.customer.phone, -used, `신차 케어 서비스 결제 사용 (${id})`);
      this.save(data);
    }
    return updated;
  },

  // ---- 신차 케어 서비스: 입고 ~ 시공업체 처리 ----
  // 차가 실제로 어떻게 시공사에 도착했는지(신차인도서비스 배송에 얹혀 왔든, 고객이 나중에 직접 몰고
  // 왔든)는 이 서비스가 상관할 바 아니다 — 시공사가 "입고 확인"을 누르는 것 자체로 그 사실을 확정한다.
  confirmCareDropoff(id, intakeRoute, extra) {
    const c = this.getCareOrder(id);
    if (!c || c.status !== 'confirmed') return c;
    const patch = { status: '입고완료', intakeRoute: intakeRoute || (window.VLP && VLP.config.get('careDefaultIntakeRoute')) || 'CUSTOMER_VISIT' };
    if (extra && extra.mileage != null) patch.mileage = extra.mileage;
    if (extra && extra.intakePhotos) patch.intakePhotos = extra.intakePhotos;
    return this._updateCare(id, patch, '입고 확인 — 시공 개시' + (extra && extra.intakePhotos ? ` (사전 촬영 ${extra.intakePhotos.length}장)` : ''));
  },
  setCareShopStage(id, code) {
    const c = this.getCareOrder(id);
    if (!c) return null;
    return this._updateCare(id, { status: code }, `시공 상태 변경 → ${code}`);
  },
  addCareSamplePhoto(id, generateFn) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const photos = (c.photos || []).slice();
    if (photos.filter(p => !p.withdrawn).length >= ((window.VLP && VLP.config.get('careMaxPhotos')) || 3)) return c;
    photos.push({ src: generateFn(photos.length, `현장 사진 ${photos.length + 1}`), label: `샘플 사진 ${photos.length + 1}`, withdrawn: false });
    return this._updateCare(id, { photos }, `샘플 이미지 추가 (${photos.length}번째)`);
  },
  addCareUploadedPhoto(id, dataUrl, filename) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const photos = (c.photos || []).slice();
    if (photos.filter(p => !p.withdrawn).length >= ((window.VLP && VLP.config.get('careMaxPhotos')) || 3)) return c;
    photos.push({ src: dataUrl, label: filename || `업로드 사진 ${photos.length + 1}`, withdrawn: false });
    return this._updateCare(id, { photos }, `실제 파일 업로드: ${filename} (${photos.length}번째)`);
  },
  // 카마스터 쪽 인수완료/커스터마이징 사진(_withdrawPhoto)과 같은 원칙 — 잘못 올린 사진을 고쳐 올리는
  // 게 아니라, 소프트 삭제(withdrawn:true) + 이력 로그로 "회수"만 가능하게 한다. 3장 상한 계산에서도
  // 빠지므로 회수 후 그 자리에 다시 올릴 수 있다.
  withdrawCarePhoto(id, idx) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const photos = (c.photos || []).slice();
    if (!photos[idx] || photos[idx].withdrawn) return c;
    photos[idx] = Object.assign({}, photos[idx], { withdrawn: true });
    return this._updateCare(id, { photos }, `현장 사진 회수: ${photos[idx].label}`);
  },
  // 견적가(사전 확정)에 추가금액·작업내역을 더해 한 번에 청구액을 확정한다.
  setCareCharged(id, extra, note) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    const base = c.quotedPrice || 0;
    const price = base + (extra || 0);
    const priceLine = extra > 0 ? `견적가 ${fmtMoney(base)} + 추가 ${fmtMoney(extra)}` : '견적가 동일';
    return this._updateCare(id, { chargedPrice: price, chargeNote: note || '' }, `실제 청구액 입력 — ${priceLine}${note ? ` / 작업 내역: ${note}` : ''}`);
  },
  requestCareInspection(id) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    return this._updateCare(id, { status: '고객검수대기', ownerConfirmed: false }, '시공업체가 고객 검수를 요청했습니다 (출차 전 확인 필요)');
  },

  // ---- 신차 케어 서비스: 오너 단독 확인 게이트 (고객검수대기 → 출차완료 / 수령대기 → 수령확인) ----
  // 카마스터는 신차인도서비스 완료 시점에 이미 역할이 끝났으므로, 이 게이트들은 카마스터 확인을 요구하지 않는다.
  ownerConfirmCare(id) {
    const c = this.getCareOrder(id);
    if (!c) return c;
    if (c.status === '고객검수대기') return this._updateCare(id, { status: '출차완료', ownerConfirmed: true }, '고객 검수(출차 승인) (오너)');
    if (c.status === '수령대기') return this._updateCare(id, { status: '수령확인', ownerConfirmed: true }, '최종 수령 확인 (오너)');
    return c;
  },
  // 이의 → 시공사 보완 → 고객 재검수(PWA 추가). 상태는 '고객검수대기' 그대로 두고 disputed로 '보완 중'을 나타낸다.
  // 횟수를 넘긴 이의는 escalated(운영자 중재)로 접수된다. 한도는 호출 쪽(care-api, 설정 careDisputeMaxRounds)이 정한다.
  raiseCareDispute(id, reason, opts) {
    const c = this.getCareOrder(id); if (!c) return null;
    const esc = !!(opts && opts.escalated);
    return this._updateCare(id, { disputed: true, escalated: esc, disputeReason: reason || '', disputeRounds: (c.disputeRounds || 0) + 1 }, `⚠ 고객 검수 불만족 제기(${(c.disputeRounds || 0) + 1}회째${esc ? ', 운영자 중재 요청' : ''}) — 사유: ${reason || '(미입력)'}`);
  },
  completeCareRework(id) {
    const c = this.getCareOrder(id); if (!c || !c.disputed || c.escalated) return c;
    return this._updateCare(id, { disputed: false }, '시공업체 보완 완료 — 고객 재검수 요청');
  },
  resolveCareDispute(id) {
    return this._updateCare(id, { disputed: false, escalated: false }, '품질 이의제기 처리 완료 (관리자 확인)');
  },
  // 신차 케어 서비스에서만 존재하는 개념 — 사전 확정 견적과 실제 청구액이 같았는지 오너가 확인한다.
  answerCarePriceCheck(id, match) {
    return this._updateCare(id, { priceMatch: match }, match ? '정찰제 이행 확인(일치)' : '정찰제 불일치 제보');
  },
  // 시공 완료 후 2차 배송(오너에게) 시작 — 신차 케어 서비스 자신의 독립된 배송이다.
  startCareSecondLeg(id) {
    return this._updateCare(id, { transit: this._buildTransit('오너', CHECKPOINTS_FROM_SHOP) }, '시공 완료 — 오너에게 재배송 시작');
  },
  // 방문 수령: 출차 후 시공사가 "수령 준비 완료"를 누르면 고객 수령 확인 단계로 넘어간다(배송은 없음)
  readyCareForPickup(id) {
    const c = this.getCareOrder(id); if (!c || c.status !== '출차완료') return c;
    return this._updateCare(id, { status: '수령대기', ownerConfirmed: false }, '수령 준비 완료 — 고객 방문 수령 대기');
  },

  // ---- 평점 시스템 (카마스터/시공사 다차원 평가) ----
  // 완료 즉시 남길 수도 있고, 처리 이력에서 "평가 대기" 건을 찾아 이후에 남길 수도 있다 — 완료 시점에
  // 강제하지 않는다. 평가 제출 자체가 각 서비스의 포인트 적립 트리거다. 카마스터 평가는 신차인도서비스
  // 예약을, 시공사 평가는 신차 케어 서비스 주문을 대상으로 한다 — 서로 다른 최상위 엔티티라 따로 처리한다.
  ratingDims(targetType) { return targetType === 'karmaster' ? RATING_DIMS_KARMASTER : RATING_DIMS_SHOP; },
  submitRating(targetType, targetId, refId, scores, comment) {
    const data = this.load();
    data.ratings = data.ratings || [];
    if (targetType === 'karmaster') {
      const idx = data.reservations.findIndex(x => x.id === refId);
      if (idx === -1) return null;
      const r = data.reservations[idx];
      data.ratings.push({ id: 'RT' + Date.now() + Math.floor(Math.random() * 1000), targetType, targetId, reservationId: refId, phone: r.customer.phone, scores, comment: comment || '', createdAt: Date.now() });
      const provider = data.karmasters.find(k => k.id === targetId);
      const total = POINT_REWARD_DELIVERY + ((provider && provider.bonusPoint) || 0);
      this._adjustPoints(data, r.customer.phone, total, `카마스터 평가 리워드 (${refId})`);
      const updated = Object.assign({}, r, { karmasterRated: true, karmasterPointsEarned: total });
      updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `카마스터 평가 제출 — 포인트 ${total.toLocaleString()}P 적립` }]);
      data.reservations[idx] = updated;
      this.save(data);
      return updated;
    }
    const idx = data.careOrders.findIndex(x => x.id === refId);
    if (idx === -1) return null;
    const c = data.careOrders[idx];
    data.ratings.push({ id: 'RT' + Date.now() + Math.floor(Math.random() * 1000), targetType, targetId, careOrderId: refId, phone: c.customer.phone, scores, comment: comment || '', createdAt: Date.now() });
    const provider = data.shops.find(s => s.id === targetId);
    const total = POINT_REWARD_AFTERMARKET + ((provider && provider.bonusPoint) || 0);
    this._adjustPoints(data, c.customer.phone, total, `시공사 평가 리워드 (${refId})`);
    const updated = Object.assign({}, c, { shopRated: true, shopPointsEarned: total });
    updated.log = (updated.log || []).concat([{ t: Date.now(), msg: `시공사 평가 제출 — 포인트 ${total.toLocaleString()}P 적립` }]);
    data.careOrders[idx] = updated;
    this.save(data);
    return updated;
  },
  getRatingsFor(targetType, targetId) {
    const list = (this.load().ratings || []).filter(r => r.targetType === targetType && r.targetId === targetId);
    const dims = this.ratingDims(targetType);
    const avgByDim = {};
    dims.forEach(d => {
      const vals = list.map(r => r.scores[d.id]).filter(v => typeof v === 'number');
      avgByDim[d.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const overallVals = [];
    list.forEach(r => dims.forEach(d => { if (typeof r.scores[d.id] === 'number') overallVals.push(r.scores[d.id]); }));
    const overall = overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : null;
    return { count: list.length, avgByDim, overall, list };
  },


  // ---- 포인트 지갑 (전화번호 기준) — 계좌이체 없이, 앱 내 결제에서 현금처럼 차감된다 ----
  _adjustPoints(data, phone, delta, reason) {
    if (!phone) return;
    const wallet = data.pointWallets[phone] || { balance: 0, history: [] };
    wallet.balance = Math.max(0, wallet.balance + delta);
    wallet.history = wallet.history.concat([{ t: Date.now(), delta, reason }]);
    data.pointWallets[phone] = wallet;
  },
  getPointBalance(phone) { return (this.load().pointWallets[phone] || { balance: 0 }).balance; },

  onChange(cb) {
    this._listeners.push(cb);
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY) { this._cache = null; this._lastRaw = null; cb(); }
    });
    // 0.5초마다 배송 만료 여부만 조용히 확인한다 (load() 내부의 _tick).
    // 실제로 데이터가 바뀐 경우에만 재렌더링 콜백을 호출한다 — 그렇지 않으면
    // 입력 중인 한글 조합(자모 합성)이나 열려있는 달력 선택기가 매번 끊긴다.
    setInterval(() => {
      const before = this._lastRaw;
      this.load();
      if (this._lastRaw !== before) cb();
    }, 500);
  },

  _notify() { this._listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
};

// 5개 화면 스크립트가 공통으로 쓰는 DOM 생성 헬퍼.
// elRow는 <tr>을 <table> 컨텍스트 없이 만들면 브라우저가 태그를 깨뜨리는 문제(v3~v5에서 반복 발생)를 막기 위한 것 —
// 화면별로 각자 구현하면 이 버그가 다시 생길 수 있어 여기 한 곳에만 둔다.
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function elRow(html) { const t = document.createElement('table'); t.innerHTML = html.trim(); return t.querySelector('tr'); }

function fmtMoney(n) { return (n || 0).toLocaleString('ko-KR') + '원'; }
function fmtPoint(n) { return (n || 0).toLocaleString('ko-KR') + 'P'; }
function fmtTime(t) {
  const d = new Date(t);
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtStars(avg) {
  if (avg === null || avg === undefined) return '평가 없음';
  return '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) + ` (${avg.toFixed(1)})`;
}
function stageBadgeClass(stage) {
  if (stage === 'CONFIRMED') return 'done';
  if (stage === '고객요청' || stage === '계약등록') return 'wait';
  if (stage === 'EXCEPTION') return 'warn';
  return 'info';
}
// 신차인도서비스 배송 단계 Enum의 표시용 한글 라벨 — 계약 단계(고객요청/계약등록/계약확정)는 원문 그대로 쓴다.
const STAGE_DISPLAY_LABELS = {
  IN_TRANSIT: '탁송중', CUSTOMIZING: '커스터마이징중', DELIVERED: '탁송완료(확인대기)', CONFIRMED: '인도완료', EXCEPTION: '지연/예외',
};
function stageDisplayLabel(stage) { return STAGE_DISPLAY_LABELS[stage] || stage; }
// 상태 스텝 바(신차배송조회 5~7단계 Enum) 표시용 라벨 — READY/DISPATCHED는 데모에서 즉시 완료 처리되지만
// (requestRelease 참고) 스텝 바에는 "이미 지난 단계"로 여전히 표시되어야 한다.
const DELIVERY_STAGE_LABELS = {
  READY: '출고 준비', DISPATCHED: '기사 배차', IN_TRANSIT: '탁송 진행중', IN_TRANSIT_1: '탁송 진행중 (1차)', IN_TRANSIT_2: '탁송 진행중 (2차)',
  CUSTOMIZING: '커스터마이징', DELIVERED: '탁송 완료', CONFIRMED: '거래 종결',
};
// 예약 하나가 배송 Enum 순서상 몇 번째 단계에 있는지 계산한다. hasCustomizing(destinationType이
// AFFILIATED_SHOP인지) 여부에 따라 IN_TRANSIT이 (제휴 시공소행 1차 / 최종 목적지행 2차) 두 번 등장할
// 수 있어, transitStage로 구분한다.
function deliveryPhaseIndex(r) {
  const hasCustom = hasCustomizing(r);
  const order = hasCustom
    ? ['READY', 'DISPATCHED', 'IN_TRANSIT_1', 'CUSTOMIZING', 'IN_TRANSIT_2', 'DELIVERED', 'CONFIRMED']
    : ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
  const stage = r.stage === 'EXCEPTION' ? r.exceptionPrevStage : r.stage;
  let code = stage;
  if (stage === 'IN_TRANSIT' && hasCustom) code = r.transitStage === 'TO_SHOP' ? 'IN_TRANSIT_1' : 'IN_TRANSIT_2';
  return order.indexOf(code);
}
// 신차배송조회 상태 스텝 바 — 계약 단계(출고 요청 전)에는 표시하지 않고, IN_TRANSIT 이상부터 보여준다.
function renderStatusStepperHTML(r) {
  const idx = deliveryPhaseIndex(r);
  if (idx < 0) return '';
  const hasCustom = hasCustomizing(r);
  const order = hasCustom
    ? ['READY', 'DISPATCHED', 'IN_TRANSIT_1', 'CUSTOMIZING', 'IN_TRANSIT_2', 'DELIVERED', 'CONFIRMED']
    : ['READY', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'];
  const steps = order.map((code, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'cur' : '');
    // 현재 단계로 들어오는 연결선도 채운다 — 예: 시공중(CUSTOMIZING)이면 그 앞의 탁송 구간까지는 이미
    // 지나온 것이니, 그 선이 안 채워져 있으면 마치 업체에 아직 도착 전인 것처럼 잘못 보인다.
    const fillPct = i <= idx ? 100 : 0;
    return `<div class="dstep ${cls}"><div class="dstep-line"><div class="dstep-line-fill" style="width:${fillPct}%"></div></div><div class="dstep-dot">${i + 1}</div><div class="dstep-label">${DELIVERY_STAGE_LABELS[code]}</div></div>`;
  }).join('');
  // 구체적인 지연 사유 문구는 여기서 노출하지 않는다 — 카마스터 화면은 내부 전용 트리거 사유를,
  // 고객 화면은 게시된 사유(있을 때만)를 각자의 문맥에서 따로 보여준다(카마스터.js/customer.js 참고).
  // 이 스텝 바는 두 화면이 공유하므로 여기서는 "지연 중"이라는 사실만 중립적으로 표시한다.
  const exceptionNote = r.stage === 'EXCEPTION'
    ? `<div class="badge warn" style="display:block;margin-top:6px;">⚠ 배송 지연/예외 상태 진행 중</div>` : '';
  return `<div class="dstepper">${steps}</div>${exceptionNote}`;
}
function amBadgeClass(status) {
  if (status === '완료' || status === '수령확인') return 'done';
  if (status === 'requested' || status === 'quoted') return 'wait';
  return 'info';
}
function transitProgress(entity) {
  if (!entity.transit || !entity.transit.active) return null;
  const pct = Math.min(1, (Date.now() - entity.transit.startedAt) / entity.transit.durationMs);
  const remainMs = Math.max(0, entity.transit.durationMs - (Date.now() - entity.transit.startedAt));
  const cps = entity.transit.checkpoints || [];
  const scaled = pct * cps.length;
  const cpIdx = Math.min(cps.length - 1, Math.floor(scaled));
  const segPct = Math.min(1, Math.max(0, scaled - cpIdx)); // 현재 체크포인트 구간 안에서의 진행률 (0~1)
  return {
    pct, remainSec: Math.ceil(remainMs / 1000), destination: entity.transit.destination,
    cpIdx, segPct, checkpointLabel: cps[cpIdx] || '위치 확인 중',
  };
}

// 배송 진행 상황을 "슬라이드 진행바" 대신 단계별 스텝 인디케이터로 표시한다.
// 다음 체크포인트로 넘어가는 구간이 "순간 이동"처럼 보이지 않도록, 진입 중인 연결선은 segPct만큼 채워서 이동 중임을 보여준다.
function renderDeliveryStepperHTML(entity) {
  if (!entity.transit) return '';
  const cps = entity.transit.checkpoints || [];
  const tp = transitProgress(entity);
  const idx = tp.cpIdx;
  const steps = cps.map((label, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'cur' : '');
    const fillPct = i < idx ? 100 : (i === idx ? Math.round(tp.segPct * 100) : 0);
    return `<div class="dstep ${cls}"><div class="dstep-line"><div class="dstep-line-fill" style="width:${fillPct}%"></div></div><div class="dstep-dot">${i + 1}</div><div class="dstep-label">${label}</div></div>`;
  }).join('');
  return `<div class="dstepper">${steps}</div>`;
}

// 신차 케어 서비스 처리 타임라인(사진 포함) — 고객·시공업체·관리자가 동일한 화면을 볼 수 있도록 공용으로 뺐다.
// c.status(신차 케어 서비스 주문 자체의 상태)를 기준으로 진행 위치를 표시한다.
function renderShopTimelineHTML(c) {
  const idx = SHOP_DISPLAY_STAGES.findIndex(s => s.code === c.status);
  const items = SHOP_DISPLAY_STAGES.map((s, i) => {
    const cls = i < idx ? 'on' : (i === idx ? 'cur' : '');
    return `<div class="tl-item"><div class="tl-line"></div><div class="tl-dot ${cls}"></div>
      <div class="tl-name ${i > idx ? 'pending' : ''}">${s.title}</div>
      <div class="tl-desc">${i <= idx ? s.info : ''}</div></div>`;
  }).join('');
  const photoList = (c.photos || []).filter(p => !p.withdrawn);
  const photos = photoList.length > 0
    ? `<div class="photo-row">${photoList.map(p => `<img src="${p.src}" alt="${p.label}" style="flex:1;height:100px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`).join('')}</div>`
    : `<div class="hint">아직 업로드된 사진이 없습니다.</div>`;
  return `<div class="tl-wrap">${items}</div><h4 style="margin-top:14px;">현장 실시간 업로드 사진</h4>${photos}`;
}

// 신차인도서비스 예약 하나의 전체 처리 이력, 또는 신차 케어 서비스 주문 하나의 전체 처리 이력
// (시간대별 도착/출발/상태변경 로그) — 두 엔티티 모두 같은 log 배열 구조를 쓰므로 공용으로 쓴다.
function renderHistoryLogHTML(entity) {
  const entries = (entity.log || []).slice().reverse();
  if (entries.length === 0) return `<div class="hint">아직 기록된 이력이 없습니다.</div>`;
  return `<div class="log-list">${entries.map(l => `<div><span class="t">${fmtTime(l.t)}</span>${l.msg}</div>`).join('')}</div>`;
}

// 실제 사진 파일을 쓸 수 없는 오프라인 데모라(외부 리소스 로드 불가), 라벨 문맥에 맞는 벡터 아이콘을
// 직접 그려 넣어 "이게 무슨 사진인지" 최소한의 실감이 나도록 한다 — 사업자등록증은 문서 아이콘, 그 외
// (현장사진/인수완료사진/검수사진 등 차량·작업 관련)는 차량 실루엣 아이콘을 쓴다. 라벨에 "완료"나
// "검수"가 들어있으면 체크마크 배지를 얹어 "작업 중"과 "다 끝난 것"을 시각적으로 구분한다.
function generateSamplePhoto(index, label) {
  const [bg, fg] = SAMPLE_PALETTES[index % SAMPLE_PALETTES.length];
  const isDoc = label.includes('사업자등록증');
  const isDone = /완료|검수/.test(label);
  const icon = isDoc
    ? `<g transform="translate(130,28)" fill="none" stroke="${fg}" stroke-width="3" opacity="0.55">
        <rect x="0" y="0" width="60" height="80" rx="4"/>
        <line x1="12" y1="18" x2="48" y2="18"/>
        <line x1="12" y1="30" x2="48" y2="30"/>
        <line x1="12" y1="42" x2="36" y2="42"/>
        <circle cx="42" cy="60" r="12"/>
        <path d="M37 60 l4 4 l7 -8" stroke-width="2.5"/>
      </g>`
    : `<g transform="translate(95,38)" fill="${fg}" opacity="0.55">
        <path d="M10 42 Q10 26 28 24 L48 24 Q62 24 72 40 L122 40 Q130 40 130 48 L130 56 Q130 60 126 60 L10 60 Q4 60 4 54 L4 48 Q4 42 10 42 Z"/>
        <circle cx="34" cy="60" r="11" fill="${bg}" stroke="${fg}" stroke-width="4"/>
        <circle cx="104" cy="60" r="11" fill="${bg}" stroke="${fg}" stroke-width="4"/>
      </g>${isDone ? `<g transform="translate(216,30)" stroke="${fg}" stroke-width="4" fill="none" opacity="0.8"><circle cx="18" cy="18" r="17"/><path d="M9 18 l6 7 l13 -15"/></g>` : ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220">
    <rect width="320" height="220" fill="${bg}"/>
    ${icon}
    <text x="160" y="180" font-family="sans-serif" font-size="14" fill="${fg}" text-anchor="middle" font-weight="bold">${label}</text>
    <text x="160" y="200" font-family="sans-serif" font-size="10" fill="${fg}" text-anchor="middle" opacity="0.7">샘플 이미지 (데모)</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

window.Store = Store;
window.PACKAGES = PACKAGES;
window.OPTION_CATALOG = OPTION_CATALOG;
window.RATING_DIMS_KARMASTER = RATING_DIMS_KARMASTER;
window.RATING_DIMS_SHOP = RATING_DIMS_SHOP;
window.SHOP_STAGES = SHOP_STAGES;
window.SHOP_DISPLAY_STAGES = SHOP_DISPLAY_STAGES;
window.fmtMoney = fmtMoney;
window.fmtPoint = fmtPoint;
window.fmtTime = fmtTime;
window.fmtStars = fmtStars;
window.stageBadgeClass = stageBadgeClass;
window.stageDisplayLabel = stageDisplayLabel;
window.renderStatusStepperHTML = renderStatusStepperHTML;
window.DELAY_REASON_OPTIONS = DELAY_REASON_OPTIONS;
window.delayReasonLabel = delayReasonLabel;
window.DESTINATION_TYPE_OPTIONS = DESTINATION_TYPE_OPTIONS;
window.destinationTypeLabel = destinationTypeLabel;
window.hasCustomizing = hasCustomizing;
window.brandsHandledFor = brandsHandledFor;
window.brandAffiliationFor = brandAffiliationFor;
window.karmasterDisplayName = karmasterDisplayName;
window.reservationInAdminScope = reservationInAdminScope;
window.careOrderInAdminScope = careOrderInAdminScope;
window.shopInAdminScope = shopInAdminScope;
window.amBadgeClass = amBadgeClass;
window.transitProgress = transitProgress;
window.renderDeliveryStepperHTML = renderDeliveryStepperHTML;
window.renderShopTimelineHTML = renderShopTimelineHTML;
window.renderHistoryLogHTML = renderHistoryLogHTML;
window.generateSamplePhoto = generateSamplePhoto;
window.TRANSIT_DURATION_MS = TRANSIT_DURATION_MS;
window.POINT_REWARD_DELIVERY = POINT_REWARD_DELIVERY;
window.POINT_REWARD_AFTERMARKET = POINT_REWARD_AFTERMARKET;
