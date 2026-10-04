# 이벤트 스키마 (API-02)

실행계획서 5장의 이벤트마다 JSON Schema(draft-07) 하나와 샘플 payload 하나.

- `contracts/events/<이름>.schema.json`: 봉투(eventId, eventType, version, occurredAt, contractId, deliveryId, actor) + `payload`. payload는 `additionalProperties:false`라서 **정의되지 않은 필드(조회번호, 전화번호, 사진 URL 등)는 싣는 순간 검증에 실패**한다.
- `contracts/events/samples/<이름>.json`: 샘플. `tests/unit/event-schemas.test.js`가 스키마별로 검증한다.
- 목 어댑터가 실제로 발행하는 이벤트도 같은 스키마로 검증한다(계약과 목의 어긋남 방지).
- 알림은 이벤트를 소비해 발송하며, 조회번호는 어떤 이벤트·알림 payload에도 넣지 않는다(9장).

문서의 "16종"과 목록의 이름 수가 맞지 않는다(목록에는 21개 이름). 결정·발견사항 참조. 명명 통일(PascalCase vs UPPER_SNAKE)은 JEFLIX [미결].
