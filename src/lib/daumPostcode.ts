/**
 * 다음(카카오) 우편번호 주소 검색 — 무료, API 키 불필요.
 *
 * "구까지만 입력하면 한국 도로명/지번 주소를 찾아주는" 그 위젯. 버튼 클릭 →
 * 팝업에서 검색 → 선택 시 표준화된 주소 문자열을 돌려준다. 사용자 직접 타이핑도
 * 그대로 가능(이 위젯은 보조 수단).
 *
 * ⚠️ 이건 "주소(도로명/지번)" 검색이라 '잠실역' 같은 장소(POI) 자동완성은 안 됨.
 *    장소 자동완성 + 거리요금(NCP)은 지도 API 키 필요 — 별도(운영자 키 발급 후).
 *
 * 스크립트는 최초 호출 시 1회 lazy 로드. CSP 가 t1.daumcdn.net 을 막으면 로드
 * 실패하지만 호출부가 try/catch 로 무시 → 수동 입력은 항상 가능(우아한 저하).
 */

const SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

export interface DaumPostcodeData {
  userSelectedType: 'R' | 'J'; // R=도로명, J=지번 (사용자가 고른 표기)
  roadAddress: string;
  jibunAddress: string;
  zonecode: string;
  buildingName: string;
  sido: string;
  sigungu: string;
}

interface DaumPostcodeInstance {
  open: () => void;
}
interface DaumPostcodeConstructor {
  new (opts: {
    oncomplete: (data: DaumPostcodeData) => void;
    onclose?: (state: string) => void;
  }): DaumPostcodeInstance;
}
type DaumGlobal = { Postcode: DaumPostcodeConstructor };

function getDaum(): DaumGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { daum?: DaumGlobal }).daum;
}

let loadPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (getDaum()?.Postcode) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loadPromise = null; // 다음 시도에서 재로드 가능하게
      reject(new Error('다음 우편번호 스크립트 로드 실패'));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * 선택된 우편번호 데이터 → 입력칸에 넣을 주소 문자열.
 * 도로명/지번 중 사용자가 고른 표기 + 건물명(있으면) 부가.
 * (PURE — 단위 테스트 대상.)
 */
export function formatDaumAddress(d: DaumPostcodeData): string {
  const base = d.userSelectedType === 'R' ? d.roadAddress : d.jibunAddress;
  const resolved = base || d.roadAddress || d.jibunAddress || '';
  const extra = d.buildingName ? ` (${d.buildingName})` : '';
  return (resolved + extra).trim();
}

/**
 * 우편번호 팝업을 열고 선택 결과를 반환. 사용자가 검색 없이 닫으면 null.
 * 버튼 onClick(사용자 제스처)에서 호출하면 팝업 차단 안 됨.
 */
export async function openDaumPostcode(): Promise<string | null> {
  await loadScript();
  const daum = getDaum();
  if (!daum?.Postcode) throw new Error('다음 우편번호 미로드');
  return new Promise<string | null>((resolve) => {
    let settled = false;
    new daum.Postcode({
      oncomplete: (d) => {
        settled = true;
        resolve(formatDaumAddress(d));
      },
      onclose: () => {
        // oncomplete 후 COMPLETE_CLOSE 도 오므로 settled 가드로 1회만 resolve.
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    }).open();
  });
}
