/**
 * 마케팅 콘텐츠 직원 — 프롬프트 빌더 (순수 함수, 단위 테스트). AI 호출 안 함, 문자열만 조립.
 *
 * 2026-06-10 자가운영 에이전시 P3. 소재(코드가 잠근 사실) → Gemini system/user 프롬프트.
 * "주어진 사실만 써라, 새 사실 금지, 식이주장 금지" = AI 환각·SAFETY 차단의 2층(프롬프트 지시).
 */

/** 소재 객체 → { systemInstruction, userPrompt }. */
export function buildContentPrompt(material) {
  const m = material || {};
  const facts = [
    `이름(한국어): ${m.name || ''}`,
    `이름(영어): ${m.nameEn || ''}`,
    `위치: ${m.cityLabel || m.city || ''}${m.dong ? ' / ' + m.dong : ''}`,
    m.cuisineKo ? `음식 종류: ${m.cuisineKo}${m.cuisine ? ' (' + m.cuisine + ')' : ''}` : '',
    `평점: ${m.rating} (구글 리뷰 ${Number(m.reviewCount || 0).toLocaleString()}개)`,
    m.priceLabelKo ? `가격대: ${m.priceLabelKo}` : '',
  ].filter(Boolean).join('\n');

  const systemInstruction = [
    '너는 한국 프라이빗 투어 브랜드 "CocoTrip"의 SNS 카피라이터다.',
    '외국인 여행자를 대상으로 인스타그램/릴스 캡션 초안을 쓴다.',
    '',
    '🔴 절대 규칙 (어기면 폐기됨):',
    '1. 아래 [사실]에 주어진 정보만 사용한다. 새로운 사실·숫자·주소·메뉴·역사를 지어내지 마라.',
    '2. 할랄/비건/채식/글루텐/알레르기 등 식이 관련 주장은 절대 쓰지 마라 (검증 불가, 안전 위험).',
    '3. "세계 최고/유일/1위/원조" 같은 검증 불가 과장 금지.',
    '4. 가격은 [사실]에 가격대가 있을 때만 언급. 없으면 가격 얘기 안 함.',
    '',
    '톤: 짧고 생생하게, 여행자가 "가보고 싶다" 느끼게. 이모지 1~2개 OK.',
    '',
    '출력은 아래 JSON 형식만 (설명·코드펜스 없이):',
    '{"variants":[{"hook":"호기심","ko":"한국어 캡션","en":"English caption"},{"hook":"정보","ko":"...","en":"..."},{"hook":"감성","ko":"...","en":"..."}],"hashtags":["#서울맛집","#koreatravel"]}',
    'variants 정확히 3개(호기심·정보·감성 훅 각 1개). hashtags 10~15개(한글/영문 혼합).',
  ].join('\n');

  const userPrompt = `다음 맛집으로 인스타그램 캡션 초안 3안을 써줘. JSON 으로만 답해.\n\n[사실]\n${facts}`;
  return { systemInstruction, userPrompt };
}
