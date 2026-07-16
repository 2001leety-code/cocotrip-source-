---
description: AI 플래너 stop/day 필드 스키마와 신·구 폴백 규칙. 프롬프트·백엔드·프론트에서 필드 참조/변경 시.
paths:
  - "api/_ai_core/**"
  - "api/ai-planner*.js"
  - "api/_email-renderer.js"
  - "api/translate-plan.js"
  - "api/pdf/generate.js"
  - "src/pages/PlanDetailPage/**"
  - "src/types/plan.ts"
  - "src/schemas/index.ts"
---

# 플래너 필드 스키마 규칙

CLAUDE.md 절대금지 #2의 상세. Gemini 응답·Firestore 저장·프론트 렌더가 같은 필드명을 써야 한다.

## 현재 스키마 (구 스키마는 사용 금지)

| 구 스키마 (금지) | 신 스키마 (현재) | 용도 |
|---|---|---|
| `name_ko` | `name` | 항상 한국어. 네이버맵 검색용 |
| `name_en` | `display_name` | 사용자 언어. UI 표시용 |
| `tip_en` | `tip` | 사용자 언어. 팁 텍스트 |

- **Gemini 프롬프트**에서는 신 스키마(`name`/`display_name`/`tip`)만 지시한다.
- **코드에서 참조**할 때는 Firestore에 남아 있는 기존 플랜 호환을 위해 신 → 구 폴백을 유지한다:

```javascript
// 표시용
stop.display_name || stop.name_en || stop.name || stop.name_ko
// 한국어명 (네이버맵 검색용)
stop.name || stop.name_ko
// 팁
stop.tip || stop.tip_en
```

## validator 주의

Gemini는 비결정적이라 strict 1-layer 매칭 validator는 false positive → retry → 500을 낸다.
새 validator를 추가할 땐 **multi-layer fallback**(substring + 대체 필드 + lenient case)을 적용한다.
