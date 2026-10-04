// 목 서버·테스트 공용 신원 픽스처 (역할별). 토큰은 개발용 고정 문자열이며 실제 인증과 무관하다.
// 가입 카마스터(km, km2)는 목 레지스트리에 등록돼 있고, kmNew는 미가입(claim 필요)이다.
const IDENTITIES = {
  cust:   { userId: 'cust-1', role: 'customer',  phone: '010-1111-0001', name: '홍길동',   token: 'mock-customer-1' },
  cust2:  { userId: 'cust-2', role: 'customer',  phone: '010-1111-0002', name: '이영희',   token: 'mock-customer-2' },
  km:     { userId: 'km-1',   role: 'karmaster', phone: '010-2222-0001', name: '김카마',   token: 'mock-karmaster-1' },
  km2:    { userId: 'km-2',   role: 'karmaster', phone: '010-2222-0002', name: '박카마',   token: 'mock-karmaster-2' },
  kmNew:  { userId: 'km-9',   role: 'karmaster', phone: '010-9999-0009', name: '미가입',   token: 'mock-karmaster-new' },
  shop:   { userId: 'shop-1', role: 'shop',      phone: '010-3333-0001', name: '시공소',   token: 'mock-shop-1' },
  shop2:  { userId: 'shop-2', role: 'shop',      phone: '010-3333-0002', name: '다른시공소', token: 'mock-shop-2' },
  admin:  { userId: 'adm-1',  role: 'admin',     phone: '010-0000-0001', name: '관리자',   token: 'mock-admin-1' },
};
const byToken = {}; Object.values(IDENTITIES).forEach(i => { byToken[i.token] = i; });
module.exports = { IDENTITIES, byToken };
