/**
 * 2026-10-24 검증 식당 재방문 정책 — 재방문 stop 안내 문구 SSOT (ko/en/ja/zh).
 * 백엔드(planPersister.applyRevisitNotes)가 tip 끝에 붙이고, 공개 공유 투영(publicPlanProjection)이 보는 사람 언어로 고른다.
 * 순수·브라우저 안전(의존 0). 제공·인증 보장 문구 없음.
 */
export const REVISIT_NOTE = {
  ko: '이 식당은 일정에 한 번 더 들어갑니다 — 근처에 검증된 대안이 부족합니다.',
  en: 'This restaurant appears in your itinerary once more — there are not enough verified alternatives nearby.',
  ja: 'このレストランは日程にもう一度登場します — 近くに確認済みの代替店が不足しています。',
  zh: '这家餐厅在行程中再次出现 — 附近经核实的替代餐厅不足。',
};

export function revisitNote(language) {
  return REVISIT_NOTE[language] || REVISIT_NOTE.en;
}

/** tip 에서 기존 재방문 안내(4개 언어 + 따로 저장된 값)를 모두 떼어낸 본문. */
export function stripRevisitNote(tip, extra) {
  if (typeof tip !== 'string') return tip;
  let out = tip;
  let removed = false;
  for (const note of [...Object.values(REVISIT_NOTE), ...(typeof extra === 'string' && extra ? [extra] : [])]) {
    while (out.includes(note)) { out = out.replace(note, ''); removed = true; }
  }
  // 떼어낸 자리의 공백만 정리 — 안내가 없던 tip 은 그대로(줄바꿈 등 보존).
  return removed ? out.replace(/[ \t]{2,}/g, ' ').trim() : tip;
}
