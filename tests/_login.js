// e2e 로그인 헬퍼 — 역할 화면에는 별도 로그인 UI가 없으므로(통합 로그인 app.html만 있다) 세션 값을 심고 화면을 연다.
const BASE = 'http://localhost:8000';
const PAGE = { customer: 'customer', shop: 'shop', karmaster: 'karmaster', admin: 'admin', supervisor: 'supervisor' };
/** role: customer|shop|karmaster|admin|supervisor
 *  who: customer → 전화번호 문자열 | {name,phone} | 데모 고객 순번(1부터) / shop·karmaster·admin → id
 *  qs: 열 때 붙일 쿼리(기본 '?nosw=1') */
async function loginAs(page, role, who, qs) {
  await page.goto(BASE + '/app.html?login=1&nosw=1');
  await page.evaluate(({ role, who }) => {
    sessionStorage.clear();
    if (role === 'customer') {
      let c = who;
      const demo = Store.getDemoCustomers();
      if (typeof who === 'number') c = demo[who - 1];
      else if (typeof who === 'string') c = demo.find((x) => x.phone === who) || { phone: who, name: '고객' };
      sessionStorage.setItem('v6_customer_logged', '1'); sessionStorage.setItem('v6_customer_name', c.name); sessionStorage.setItem('v6_customer_phone', c.phone); sessionStorage.setItem('v6_view', 'history');
    } else if (role === 'shop') sessionStorage.setItem('v6_shop_id', who);
    else if (role === 'karmaster') sessionStorage.setItem('v6_km_id', who);
    else { sessionStorage.setItem('v6_admin_id', who); sessionStorage.setItem('v6_admin_tab', 'delivery'); } // 기존 시나리오는 건 목록에서 시작(홈 시나리오는 test_admin_home)
  }, { role, who });
  await page.goto(BASE + '/' + PAGE[role] + '.html' + (qs == null ? '?nosw=1' : qs));
}
module.exports = { loginAs, BASE };
