"/**\n * Zod 스키마 — API 응답 검증 및 런타임 타입 안전성\n *\n * 사용처:\n *   - 프론트엔드: API 응답 파싱 시 .safeParse()\n *   - 테스트: 데이터 무결성 검증\n *   - 향후 FireCMS: 문서 스키마 정의 기반\
<truncated 6548 bytes>
"/** 표준 API 응답 (성공 | 에러) */\nexport const ApiResponseSchema = z.union([\n  ApiSuccessSchema,\n  ApiErrorSchema,\n]);"
"export type ApiResponse = ApiSuccess | ApiError;"