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
// 2026-08-24 (planner-trust-course, client hardening B/C): the two ad-hoc
//   parsing IIFEs this card used to carry (`quickPreviewText.ts`, and its own
//   inline markdown-table split) are gone. The card now renders from
//   `parseQuickPreviewResponse` (`../lib/quickPreviewContract`) — the SAME
//   parser `usePlannerHandlers` gates `quickSuccess` on, so there is one
//   reading of the payload, not two that can silently drift apart. Map links
//   are built by `buildGoogleMapsUrl` from server-owned identity only
//   (placeId / finite Korea coordinates / canonical name+address) — never the
//   model-authored displayed spot name, and never a `googleMapsUrl` the JSON
//   itself claims to carry. `deferredCategories` (categories this endpoint had
//   no verified data to shape day one with) render as their own honest line,
//   never folded into `reflectedConditions`.
import { MapPin } from 'lucide-react';
import type { PlannerDict } from '../types';
import { pickPlannerCopy } from '../plannerCopy';
import { parseQuickPreviewResponse, buildGoogleMapsUrl } from '../lib/quickPreviewContract';

export function QuickPreviewCard({ resultQuick, p, language }: { resultQuick: Record<string, unknown>; p: PlannerDict; language: string }) {
  const c = pickPlannerCopy(language);
  const parsed = parseQuickPreviewResponse(resultQuick, language);
  // Defensive only — usePlannerHandlers already gates `quickSuccess` on this
  // same parser succeeding, so `resultQuick` reaching this card unparsable
  // should not happen in practice.
  if (!parsed) return null;

  const { narrative, themes, stops, reflectedConditions, deferredCategories } = parsed;
  const mapLabel = p.quickPreviewMapLabel || 'Map';

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
        <p className="ec-body-sm ec-measure mt-2 text-ec-ink-2">{narrative}</p>
      </div>

      {reflectedConditions.length > 0 && (
        <p className="ec-body-sm mt-3 text-ec-ink-3">
          {c.preview.basedOnLabel}: {reflectedConditions.join(' · ')}
        </p>
      )}

      <p className="ec-body-sm mt-6 text-ec-ink-3">
        <span className="ec-figure">{stops.length}</span> {c.preview.stopsLabel}
      </p>
      <ol className="ec-timeline mt-2">
        {stops.map((stop, i) => {
          const mapUrl = buildGoogleMapsUrl(stop.detail);
          return (
            <li key={i} className="ec-timeline-row">
              <span className="ec-timeline-time">{stop.time}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold leading-tight text-ec-ink">{stop.spot}</span>
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
                      aria-label={`${stop.spot} ${mapLabel}`}
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />{mapLabel}
                    </a>
                  )}
                </div>
                {stop.transit && <p className="ec-body-sm mt-1 text-ec-ink-3">{stop.transit}</p>}
                {stop.tip && <p className="ec-body-sm mt-0.5 text-ec-ink-3">{stop.tip}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {deferredCategories.length > 0 && (
        <p className="ec-body-sm mt-3 text-ec-ink-3">
          {c.preview.deferredHeading}: {deferredCategories.map((cat) => p[`act${cat}`] || cat).join(' · ')}
        </p>
      )}
    </section>
  );
}
