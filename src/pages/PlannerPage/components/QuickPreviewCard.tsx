// Quick preview card -- extracted from legacy PlannerPage.tsx L1613-1703.
// 2026-06-28: 표 → 세로 타임라인 카드 재설계 (시각·장소·교통·팁·Google지도 링크). 운영자 Trip.com 벤치마크.
//   day1MarkdownTable(시간|명소|교통|팁 4컬럼, api/ai-planner-quick.js)을 타임라인으로 렌더.
//   교통 컬럼 = 이전 장소→현재 장소 이동 수단. 헤더 정규식으로 유연 감지 → 4컬럼/3컬럼(레거시) 모두 호환.
// 2026-08-10 (Korea Editorial Concierge): the preview is the product's sample
//   output, so it is now set like one — a printed schedule with a tabular time
//   column and hairline rows, on paper. Two real defects went with the restyle:
//     · the "no narrative" fallback was a Korean string literal shown to every
//       language ("여행 일정을 생성했습니다."), and
//     · the card took `isMobile` to pick between two accent colours, which the
//       one-accent system no longer has. It takes `language` instead, which is
//       what it actually needed.
//   The markdown-table parsing below is untouched.
// 2026-08-11: the two shape-normalising IIFEs below moved to
//   `../lib/quickPreviewText` — they were typed with `as any` and closed by
//   empty `catch {}` blocks (six ESLint errors), and nothing could test them
//   because reaching them meant rendering this card. Behaviour is unchanged;
//   `tests/unit/planner-quick-preview-text.test.ts` now calls them directly.
import { MapPin } from 'lucide-react';
import type { PlannerDict } from '../types';
import { pickPlannerCopy } from '../plannerCopy';
import { resolveNarrative, resolveMarkdownTable } from '../lib/quickPreviewText';
import type { QuickPreviewField } from '../lib/quickPreviewText';

interface QuickPreviewData {
  themes?: string[];
  marketingNarrative?: QuickPreviewField;
  day1MarkdownTable?: QuickPreviewField;
}

export function QuickPreviewCard({ resultQuick, p, language }: { resultQuick: QuickPreviewData; p: PlannerDict; language: string }) {
  const c = pickPlannerCopy(language);
  const themes = resultQuick.themes || [];

  return (
    <section className="ec-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="ec-eyebrow">{c.preview.eyebrow}</p>
        {themes.length > 0 && (
          <p className="ec-body-sm text-ec-ink-3">
            {p.quickPreviewTheme}: {themes.join(', ')}
          </p>
        )}
      </div>
      <h2 className="ec-h3 mt-2">{p.quickPreviewTitle}</h2>

      <div className="ec-panel-quiet mt-4">
        <p className="ec-eyebrow">{p.quickPreviewNarrative}</p>
        <p className="ec-body-sm ec-measure mt-2 text-ec-ink-2">
          {resolveNarrative(resultQuick.marketingNarrative, c.preview.narrativeFallback)}
        </p>
      </div>

      {(() => {
        const tableStr = resolveMarkdownTable(resultQuick.day1MarkdownTable);
        if (!tableStr) return null;
        const tableLines = tableStr.split('\n').filter((l: string) => l.trim().startsWith('|'));
        // separator 행 제거 — multi-column "| --- | --- |" 은 셀 사이 | 때문에 [\s:\-] 만으론 안 걸러짐 → | 포함(미리보기 "--- ---" 가짜행 fix).
        const dataLines = tableLines.filter((l: string) => !l.match(/^\|[\s:\-|]+\|$/));
        if (dataLines.length < 2) {
          return (
            <pre className="ec-panel-quiet mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] text-ec-ink-2">{tableStr}</pre>
          );
        }
        const tHeaders = dataLines[0].split('|').filter((c: string) => c.trim()).map((c: string) => c.trim());
        const tRows = dataLines.slice(1).map((r: string) => r.split('|').filter((c: string) => c.trim()).map((c: string) => c.trim()));
        // 헤더에 교통 컬럼 탐지 (4컬럼 시간|명소|교통|팁). 레거시 3컬럼(교통 없음)은 transitIdx=-1 → 하위호환.
        const transitIdx = tHeaders.findIndex((h: string) => /교통|이동|transit|交通|교통편/i.test(h));
        const mapLabel = p.quickPreviewMapLabel || 'Map';
        return (
          <>
            <p className="ec-body-sm mt-6 text-ec-ink-3">
              <span className="ec-figure">{tRows.length}</span> {c.preview.stopsLabel}
            </p>
            <ol className="ec-timeline mt-2">
              {tRows.map((row: string[], ri: number) => {
                const time = row[0] || '';
                const place = row[1] || '';
                const transit = transitIdx >= 2 ? (row[transitIdx] || '') : '';
                const lastIdx = row.length - 1;
                const tip = lastIdx > 1 && lastIdx !== transitIdx ? (row[lastIdx] || '') : '';
                const mapUrl = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : '';
                return (
                  <li key={ri} className="ec-timeline-row">
                    <span className="ec-timeline-time">{time}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-[15px] font-semibold leading-tight text-ec-ink">{place}</span>
                        {/* 2026-08-10 follow-up: 실측 45×19.5 로 44px 터치 하한 미달.
                            상하 여백을 주면 타임라인 행이 벌어져 인쇄된 시간표처럼
                            읽히지 않으므로, 글자 크기는 그대로 두고 `ec-maplink` 의
                            가상요소가 44×44 히트 영역만 넓힌다(레이아웃 영향 0). */}
                        {mapUrl && (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ec-maplink inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ec-brand underline underline-offset-2"
                            aria-label={`${place} ${mapLabel}`}
                          >
                            <MapPin className="h-3.5 w-3.5" aria-hidden />{mapLabel}
                          </a>
                        )}
                      </div>
                      {transit && <p className="ec-body-sm mt-1 text-ec-ink-3">{transit}</p>}
                      {tip && <p className="ec-body-sm mt-0.5 text-ec-ink-3">{tip}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        );
      })()}
    </section>
  );
}
