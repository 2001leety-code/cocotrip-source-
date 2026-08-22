/**
 * 하드코딩 폴백 문구 ↔ ko.json(i18n 단일 진실원천) 일치 검증.
 *
 * 🔴 왜 필요한가 (2026-08-03)
 *   화면 코드에는 `{hc.flightLine1 || '스카이스캐너 제휴'}` 처럼 번역이 없을 때 쓰는
 *   **하드코딩 폴백**이 섞여 있다. 번역 JSON 은 나중에 고쳐지는데 이 폴백은 그대로 남아
 *   **거짓 사실이 코드 안에 화석처럼 굳는다.** 실제로 항공 카드 폴백은 제휴사가 Trip.com 으로
 *   바뀐 뒤에도 '스카이스캐너 제휴' 였고, 전세차량 폴백은 가이드 비용을 "별도 포함"
 *   (ko.json 은 "추가됩니다") 이라고 말해 **요금 안내가 서로 모순**이었다.
 *   llms.txt 결제 단정문 사건과 같은 부류다 — 고객에게 보이는 서술은 진실 원천과 대조해야 한다.
 *
 *   같은 키의 폴백이 **여러 곳에 복사**돼 한쪽만 갱신되는 것이 실제 발생한 경로다
 *   (`c.vehicleGuideCost` 는 237행이 최신, 479행이 옛 문구였다). 이 테스트가 있으면 복사본이
 *   몇 개든 전부 ko.json 한 곳을 향하므로 갈라질 수 없다 — 그래서 폴백을 상수로 뽑지 않는다.
 *
 * 검사 대상: `<객체>.<키>` 뒤에 `||` 또는 nullish 연산자로 한글 폴백을 붙인 표현 중, 그
 * **leaf 키 이름이 ko.json 전체에서 딱 한 번만 나오는** 것. `title`·`name` 처럼 여러
 * 네임스페이스에 중복되는 이름은 어느 값과 비교할지 알 수 없어 제외한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ko from '../../src/i18n/locales/ko.json';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * i18n 객체가 아니라 **데이터 객체**의 폴백인데 속성 이름이 우연히 ko.json 키와 같은 것.
 * 형식: `<src 기준 경로>::<코드에 쓰인 표현>`. 새 항목을 추가할 때는 "이 값이 정말 번역이
 * 아닌가" 를 한 번 확인하라 — 이 목록에 넣는 순간 문구 검사에서 영원히 빠진다.
 */
const NOT_I18N = new Set([
  'components/mood/MoodBookingChangeModal.tsx::json.error', // MOOD API error response
  'pages/MoodPortal.tsx::json.error',                       // MOOD API error response
  'pages/AdminCalendar.tsx::booking.pickup',       // 예약 문서의 픽업 장소(자유 입력)
  'pages/AdminCalendar.tsx::d.name',               // 디스코드 구독자 표시 이름
  'pages/AdminProductEditor.tsx::validation.message', // 검증 결과 메시지 객체
  'components/mood/MoodReceiptModal.tsx::booking.serviceType', // 예약 문서의 서비스 코드
  'components/mood/MoodReceiptModal.tsx::entry.date', // 톨비 증빙 행의 선택 입력값
  // ── 2026-08-07 (#1220 후속): "키 부재"·"무후보" 검사를 켜면서 걸린 데이터 객체들.
  //    전부 API 응답·Firestore 문서·폼 상태의 필드라 번역 키가 아니다. 아래 폴백 문구가
  //    어드민(운영자 전용) 화면·플랜 데이터 결손 표시라 4개 언어 노출 문제도 아니다.
  'components/admin/DispatchTimeline.tsx::b.productType',   // 예약 문서의 상품 코드
  'components/admin/ProfitSettlement.tsx::data.productType', // 예약 문서의 상품 코드
  'components/admin/PromoBannerPanel.tsx::json.error',      // API 오류 응답
  'components/admin/ReviewManagement.tsx::r.authorName',    // 리뷰 문서의 작성자명
  'components/admin/RuntimeFlagsPanel.tsx::json.error',     // API 오류 응답
  'lib/inquiryAdmin.ts::row.whatsapp',                      // 문의 문서의 연락처
  'pages/AdminAllBookings.tsx::json.error',                 // API 오류 응답
  'pages/AdminBriefing.tsx::json.error',                    // API 오류 응답
  'pages/AdminBriefing.tsx::marketing.reason',              // API 응답의 미연동 사유
  'pages/AdminCalendar.tsx::data.productType',              // 예약 문서의 상품 코드
  'pages/AdminCalendar.tsx::data.reason',                   // 차단일 문서의 사유
  'pages/AdminCalendar.tsx::formData.tourName',             // 수동 예약 폼 상태
  'pages/AdminCalendar.tsx::json.warning',                  // API 경고 응답
  'pages/AdminCalendar.tsx::booking.vehicle',               // 예약 문서의 배차 차량
  'pages/AdminCalendar.tsx::booking.driver',                // 예약 문서의 배차 기사
  'pages/AdminDecisions.tsx::json.error',                   // API 오류 응답
  'pages/AdminDecisions.tsx::j.error',                      // API 오류 응답
  'pages/AdminPaymentReviews.tsx::it.userEmail',            // 결제 문서의 이메일
  'pages/AdminPlans.tsx::json.error',                       // API 오류 응답
  'pages/AdminPlans.tsx::c.userEmail',                      // 플랜 문서의 이메일
  'pages/AdminPlans.tsx::selectedPlan.title',               // 플랜 문서의 제목(자유 입력)
  'pages/AdminQualityDashboard.tsx::json.error',            // API 오류 응답
  'pages/AdminTranslations.tsx::j.error',                   // API 오류 응답
  'pages/AdminZoneCourseEditor.tsx::draft.id',              // 존 코스 문서 id
  // ── MOOD 이중 확인 정산 (2026-08-22): Firestore settlementApproval 문서·톨비 증빙 행의
  //    데이터 필드. it.userEmail/c.userEmail 과 같은 부류(이메일 주소는 번역 대상이 아님).
  'components/mood/MoodReceiptModal.tsx::settlementApproval.approvedByEmail', // 정산 승인자 이메일
  'components/mood/MoodSettlementEditor.tsx::entry.date',   // 톨비 증빙 행의 선택 입력값 (MoodReceiptModal.tsx::entry.date 와 동일 필드)
]);

/** leaf 키 이름 -> ko.json 에서의 (경로, 값) 목록. */
function indexByLeafKey(
  node: Record<string, unknown>,
  path = '',
  out = new Map<string, { path: string; value: string }[]>(),
) {
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      indexByLeafKey(v as Record<string, unknown>, p, out);
    } else if (typeof v === 'string') {
      const list = out.get(k);
      if (list) list.push({ path: p, value: v });
      else out.set(k, [{ path: p, value: v }]);
    }
  }
  return out;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `obj.someKey` 또는 옵셔널 체이닝 `obj?.someKey` 뒤에 `||`/nullish 연산자로 붙은 문자열 폴백.
 * 한글이 든 문구만 본다. 옵셔널 체이닝을 빠뜨리면 `transitDict?.walkFasterNote` 같은 실제
 * 사례를 놓친다.
 *
 * (정규식을 `(?:\?)?` 처럼 에두른 이유: pre-commit 의 mojibake 검사가 물음표 두 개가 붙은
 *  문자열을 깨진 글자 시그니처로 잡는다. 이 파일은 예외 목록에 없어야 하므로 피해서 쓴다.)
 */
const FALLBACK_RE = /([A-Za-z0-9_$]+)(?:\?)?\.([A-Za-z0-9_]+)\s*(?:\|\||\?\?)\s*(['"])((?:(?!\3).)*)\3/g;

interface Mismatch {
  where: string;
  key: string;
  fallback: string;
  expected: string;
}
interface MissingKey { where: string; tag: string; fallback: string }
interface NoCandidate { where: string; tag: string; fallback: string; candidates: string[] }

/**
 * 🔴 2026-08-07 (#1220 후속): 예전엔 `if (!hits || hits.length !== 1) continue` 로
 *   **키가 아예 없는 폴백**(어느 언어에도 키가 없어 폴백이 "번역 실패 시" 가 아니라 **항상**
 *   노출 — 영어 손님이 결제 화면에서 '로딩 중...' 을 본다)과 **leaf 이름이 여러 곳에 있는
 *   폴백**을 검사에서 통째로 뺐다. 피해가 더 큰 쪽을 검사기가 스스로 제외하고 있었다.
 *   이제 세 분류로 나눈다:
 *     1) 키 1곳   → 값이 정확히 같아야 한다 (기존)
 *     2) 키 0곳   → 위반: 키부터 만들어야 한다 (`planner.loading` 이 이 부류였다)
 *     3) 키 여러곳 → 폴백이 그중 **어느 값과도** 다르면 위반 (어느 네임스페이스를 의도했든
 *        전부와 다르다 = 화석이거나 키 누락. `p.loading` 은 admin/a11y 의 loading 과 달라
 *        이 부류로도 잡힌다)
 */
function findViolations(): {
  mismatches: Mismatch[]; missing: MissingKey[]; noCandidate: NoCandidate[];
  checked: number; unusedIgnores: string[];
} {
  const byLeaf = indexByLeafKey(ko as unknown as Record<string, unknown>);
  const mismatches: Mismatch[] = [];
  const missing: MissingKey[] = [];
  const noCandidate: NoCandidate[] = [];
  const seenIgnores = new Set<string>();
  let checked = 0;

  for (const file of collectSourceFiles(SRC)) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        FALLBACK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FALLBACK_RE.exec(line)) !== null) {
          const [, obj, key, , fallback] = m;
          if (!/[가-힣]/.test(fallback)) continue;
          // 예외 판정은 분류보다 먼저 — 데이터 객체는 키가 있든 없든 번역 검사 대상이 아니다.
          const tag = `${rel}::${obj}.${key}`;
          if (NOT_I18N.has(tag)) {
            seenIgnores.add(tag);
            continue;
          }
          const where = `src/${rel}:${i + 1}`;
          const hits = byLeaf.get(key);
          checked += 1;
          if (!hits) {
            missing.push({ where, tag, fallback });
          } else if (hits.length === 1) {
            if (hits[0].value !== fallback) {
              mismatches.push({ where, key: hits[0].path, fallback, expected: hits[0].value });
            }
          } else if (!hits.some((h) => h.value === fallback)) {
            noCandidate.push({ where, tag, fallback, candidates: hits.map((h) => `${h.path}=${JSON.stringify(h.value)}`) });
          }
        }
      });
  }
  return {
    mismatches, missing, noCandidate, checked,
    unusedIgnores: [...NOT_I18N].filter((t) => !seenIgnores.has(t)),
  };
}

describe('하드코딩 폴백 문구는 ko.json 과 같아야 한다', () => {
  const result = findViolations();

  it('불일치가 없다', () => {
    const report = result.mismatches
      .map((m) => `\n  ${m.where}  [${m.key}]\n    코드: ${JSON.stringify(m.fallback)}\n    ko  : ${JSON.stringify(m.expected)}`)
      .join('');
    expect(
      result.mismatches,
      `하드코딩 폴백이 ko.json 과 다르다. 번역 JSON 이 진실 원천이므로 코드 쪽을 맞춘다:${report}\n`,
    ).toEqual([]);
  });

  it('키가 아예 없는 폴백이 없다 — 키가 없으면 폴백이 "항상" 노출된다 (#1220)', () => {
    const report = result.missing
      .map((m) => `\n  ${m.where}  [${m.tag}]  코드: ${JSON.stringify(m.fallback)}`)
      .join('');
    expect(
      result.missing,
      `폴백의 키가 ko.json 에 없다. 4개 언어(ko/en/ja/zh)에 키를 추가하거나, 번역이 아니면 NOT_I18N 에 사유와 함께 등록한다:${report}\n`,
    ).toEqual([]);
  });

  it('leaf 이름이 여러 곳에 있어도 폴백은 그중 한 값과는 같아야 한다 (#1220)', () => {
    const report = result.noCandidate
      .map((m) => `\n  ${m.where}  [${m.tag}]\n    코드: ${JSON.stringify(m.fallback)}\n    후보: ${m.candidates.join(' / ')}`)
      .join('');
    expect(
      result.noCandidate,
      `폴백이 같은 leaf 이름의 어떤 ko.json 값과도 다르다 — 화석 문구거나 키 누락이다:${report}\n`,
    ).toEqual([]);
  });

  it('검사기가 실제로 무언가를 보고 있다', () => {
    // 정규식·경로가 조용히 0건을 반환하면 위 테스트는 영원히 통과한다 — 그 상태를 막는다.
    expect(collectSourceFiles(SRC).length).toBeGreaterThan(100);
    expect(result.checked).toBeGreaterThan(20);
  });

  it('쓰이지 않는 예외 항목이 남아 있지 않다', () => {
    // 코드가 정리되면 예외도 함께 사라져야 한다(안 그러면 다음 사람이 진짜 예외인 줄 안다).
    expect(result.unusedIgnores).toEqual([]);
  });
});
