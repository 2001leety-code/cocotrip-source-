/**
 * "아직 안 채운 항목" 안내 — 위저드 공용 (2026-08-18).
 *
 * 🔴 왜 만들었나 (운영자 실사용 신고): 필수 항목을 비운 채 Next 를 누르면 그 칸 밑에
 *   빨간 문구가 켜지긴 했다. 그런데 **화면이 움직이지 않는다.** 4페이지(여행 상세)는
 *   실측 8,007px — 뷰포트 10화면 길이다. Next 버튼(3,745px)과 날짜 칸(1,083px)이
 *   2,662px 떨어져 있으니, 아래에서 누른 사람에게 위에 켜진 문구는 없는 것과 같다
 *   → "버튼이 죽었다" 로 읽힌다.
 *
 * 그래서 두 가지를 한다.
 *   1) Next 를 눌렀는데 못 넘어가면 **첫 번째 빈 칸으로 데려간다**(`revealFirstMissing`).
 *   2) 스텝 맨 위에 **남은 항목을 모아 보여주고**, 각 줄을 누르면 그 칸으로 간다.
 *
 * 모달(팝업)이 아니라 인라인인 이유: 모달은 한 번 더 닫아야 하고, 닫는 순간 무엇이
 * 문제였는지 화면에서 사라진다. 3페이지 Review 의 "Tap any card to edit" 와 같은
 * 조작 언어를 쓰면 사용자가 새로 배울 것도 없다.
 *
 * 세 스텝(예약상황·목적지·여행상세)이 같이 쓴다. 스텝마다 따로 구현하면 한쪽만
 * 고쳐지는 일이 반복되므로 판정과 이동을 한 곳에 모아 둔다.
 *
 * 값·함수는 `missingFields.ts` 에 있다 — 컴포넌트 파일은 컴포넌트만 내보내야 한다
 * (`react-refresh/only-export-components`).
 */
import { AlertCircle } from 'lucide-react';
import { focusAndReveal } from '@/lib/motion';
import type { MissingField } from './missingFields';

export function WizardMissingSummary({
  title,
  missing,
}: {
  title: string;
  missing: MissingField[];
}) {
  if (missing.length === 0) return null;
  return (
    // role="alert" 은 켜지는 순간 읽어 준다. 화면으로도 목록으로도 같은 정보가 남는다.
    <div className="ec-error-note" role="alert">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {missing.map((field) => (
          <li key={field.key}>
            <button
              type="button"
              onClick={() => focusAndReveal(field.ref.current)}
              className="min-h-[32px] text-left underline underline-offset-2"
            >
              {field.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
