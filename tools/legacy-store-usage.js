// PWA-02 진행 추적: 화면 파일에 남은 v6 `Store.` 직접 호출 수. 화면 티켓(PWA-06~)이 해당 화면을 facade로 옮길 때마다 줄어든다.
// 목표(완료 정의): 화면 코드의 Store. 직접 호출 0 (store.js 자체와 목 어댑터 내부는 제외).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let total = 0;
['customer.js', 'karmaster.js', 'shop.js', 'admin.js'].forEach(f => { const n = (fs.readFileSync(path.join(root, f), 'utf8').match(/\bStore\./g) || []).length; total += n; console.log(f.padEnd(14), n); });
console.log('합계'.padEnd(14), total);
if (process.argv.includes('--strict') && total > 0) process.exit(1);
