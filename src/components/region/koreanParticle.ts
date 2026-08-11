/**
 * 한국어 조사(은/는, 을/를)는 앞말 받침 유무로 갈린다 — 공백 없이 붙는다("서울은", "제주는").
 * 이 조사를 지역명과 무관하게 하드코딩하면(예: 항상 "은") "제주은"처럼 문법이 깨지거나,
 * 공백을 끼워 "서울 은"처럼 깨진다. RegionSeoInfo 의 지역명 조사는 전부 이 helper를 거친다.
 */
function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

export function withEunNeun(word: string): string {
  return `${word}${hasBatchim(word) ? '은' : '는'}`;
}

export function withEulReul(word: string): string {
  return `${word}${hasBatchim(word) ? '을' : '를'}`;
}
