// 단위 테스트 공용 로더: 브라우저와 같은 전역(VLP)에 파일을 로드 순서대로 올린다.
const path = require('path');
const root = path.join(__dirname, '..', '..');
['vlp-config.js', 'vlp-ops.js', 'status-map.js', 'api-facade.js', 'adapters/mock.js', 'adapters/http.js', 'upload-queue.js', 'push-link.js'].forEach(f => {
  try { require(path.join(root, f)); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
});
module.exports = { VLP: globalThis.VLP, root };
