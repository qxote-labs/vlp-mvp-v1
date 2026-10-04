/* tools/gen-demo-guide.js — demo-guide.js 의 내용으로 docs/시연_계정별_확인안내.md 를 만든다.
 *   node tools/gen-demo-guide.js          (문서를 다시 씀)
 *   node tools/gen-demo-guide.js --check  (문서가 최신인지만 확인, 다르면 종료코드 1) */
const fs = require('fs'); const path = require('path');
const G = require('../demo-guide.js');
const out = path.join(__dirname, '..', 'docs', '시연_계정별_확인안내.md');
const esc = (s) => String(s).replace(/\|/g, '\\|');
function table(rows, head) { return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'].concat(rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |')).join('\n'); }
const L = [];
L.push('# 시연 계정별 확인 안내', '', '> 이 문서는 `demo-guide.js`에서 자동으로 만들어집니다(`node tools/gen-demo-guide.js`). 직접 고치지 말고 그 파일을 고쳐 주세요. demo.html 의 "계정별 확인 안내"도 같은 내용입니다.', '');
L.push('## 시작하기', '', G.intro.map((x, i) => (i + 1) + '. ' + x).join('\n'), '');
function section(title, list, withPhone) {
  L.push('## ' + title, '');
  list.forEach((a) => {
    L.push('### ' + a.name + (a.phone ? ' · ' + a.phone : '') + (a.pin ? ' · 비밀번호 ' + a.pin : ''), '', '- 로그인: ' + a.login, '');
    L.push(table(a.cases, ['건', '지금 상태', '확인할 것']), '');
    if (a.note) L.push('> ' + a.note, '');
  });
}
section('고객', G.customers); section('카마스터', G.karmasters); section('시공사', G.shops); section('관리자', G.admins);
const text = L.join('\n') + '\n';
if (process.argv.includes('--check')) { const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''; if (cur !== text) { console.error('docs/시연_계정별_확인안내.md 가 demo-guide.js 와 다릅니다. node tools/gen-demo-guide.js 로 다시 만드세요.'); process.exit(1); } console.log('OK'); }
else { fs.writeFileSync(out, text); console.log('wrote', out); }
