// API-01: openapi.yaml 구조 검증 (swagger-parser). 실패하면 종료 코드 1. CI 첫 단계(실행계획서 8장).
const path = require('path');
const SwaggerParser = require('@apidevtools/swagger-parser');
const file = process.argv[2] || path.join(__dirname, '..', 'contracts', 'openapi.yaml');
SwaggerParser.validate(file).then(api => {
  const ops = Object.values(api.paths).reduce((n, ms) => n + Object.keys(ms).filter(m => m !== 'parameters').length, 0);
  console.log('openapi OK:', api.info.title, api.info.version, '- paths', Object.keys(api.paths).length, 'operations', ops);
}).catch(e => { console.error('openapi 검증 실패:', e.message); process.exit(1); });
