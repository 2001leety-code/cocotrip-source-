// P121 (2026-05-20): 운영자 전용 quality_warnings + qualityScore 노출 패널.
//
// 배경: plan 4792076e dump 결과 Firestore 에 lodging_bookend_violation 5건이
// 저장돼 있지만 UI 어디서도 노출 안 됨. 운영자가 prod plan detail 보면서 "왜
// 이 plan 이 quality 위반인지" 즉시 확인 불가했음.
//
// 보안: isAdminEmail 클라이언트 가드 (`src/lib/admin.ts`) — UI 분기만 담당.
// Firestore 자체는 plan owner / accessToken / isPublic 기준 read 권한이라 운영자
// 가 아닌 사용자가 quality_warnings 데이터 자체를 fetch 받아도 위험 X. UI 가드
// 만으로 노출 분리 충분.

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { isAdminEmail } from '@/lib/admin';

interface QualityWarningItem {
  day?: number;
  position?: string;
  stopName?: string;
  distM?: number;
  /** P143 (2026-05-22): intercity_first_stop_gap 등 자유형 메시지 fallback. */
  message?: string;
  [key: string]: unknown;
}

interface QualityWarning {
  /** P161 (2026-05-23): self-heal 함수들 (selfHealLodgingBookend, correctCrossCityLodgingStops,
   *  correctPreDawnStopTimes, selfHealArrivalGuide) 가 kind 만 push 한 회귀로 panel heading 이
   *  undefined 노출. 양쪽 shape 호환을 위해 type/kind 둘 다 선택. message 도 fallback. */
  type?: string;
  kind?: string;
  message?: string;
  anchor?: string;
  severity?: string;
  items?: QualityWarningItem[];
  [key: string]: unknown;
}

interface QualityScore {
  score?: number;
  metrics?: Record<string, { count?: number; severity?: string }>;
}

interface Props {
  userEmail: string | null | undefined;
  qualityWarnings: QualityWarning[] | undefined | null;
  qualityScore?: QualityScore | null;
  planId?: string;
  plannerMode?: string;
}

export function QualityWarningsPanel({
  userEmail,
  qualityWarnings,
  qualityScore,
  planId,
  plannerMode,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!isAdminEmail(userEmail)) return null;

  const warnings = Array.isArray(qualityWarnings) ? qualityWarnings : [];
  const hasWarnings = warnings.length > 0;
  const hasScore = qualityScore && typeof qualityScore.score === 'number';
  if (!hasWarnings && !hasScore) return null;

  const totalItems = warnings.reduce((s, w) => s + (w.items?.length || 0), 0);

  return (
    <div className="max-w-4xl mx-auto px-4 mt-8" data-testid="quality-warnings-panel">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-bold">운영자 전용 — Plan Quality Diagnostics</span>
            {hasScore && (
              <span className="text-xs text-amber-200/80">Score: {qualityScore?.score}/100</span>
            )}
            {hasWarnings && (
              <span className="text-xs text-amber-200/80">
                · {warnings.length} types / {totalItems} items
              </span>
            )}
          </span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-amber-300 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-amber-300 shrink-0" />
          )}
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {planId && (
              <div className="text-[12px] font-mono text-white/40">
                planId: {planId}
                {plannerMode ? ` · mode: ${plannerMode}` : ''}
              </div>
            )}

            {hasScore && qualityScore?.metrics && (
              <div className="rounded-lg border border-amber-400/20 bg-black/20 p-3">
                <div className="text-[14px] font-bold text-amber-200 mb-1.5">qualityScore metrics</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] text-white/75">
                  {Object.entries(qualityScore.metrics).map(([key, val]) => (
                    <div key={key} className="font-mono">
                      <span className="text-white/55">{key}:</span>{' '}
                      <span className={val?.count ? 'text-amber-200' : 'text-emerald-300'}>
                        count={val?.count ?? '?'}
                      </span>
                      {val?.severity ? <span className="text-white/45"> · {val.severity}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasWarnings &&
              warnings.map((w, i) => {
                // P161 (2026-05-23): heading fallback chain — type → kind → '(unknown warning)'.
                // self-heal 함수들이 kind 만 push 한 케이스 (plan 8e767d9c {kind:undefined,
                // message:undefined} 회귀) 의 silent UI 표시 차단.
                const heading = w.type || w.kind || '(unknown warning)';
                const hasItems = Array.isArray(w.items) && w.items.length > 0;
                return (
                  <div key={i} className="rounded-lg border border-amber-400/20 bg-black/20 p-3 text-xs text-white/80">
                    <div className="font-bold text-amber-200 mb-1">
                      {heading}
                      {w.anchor ? <span className="text-white/55"> · anchor: {w.anchor}</span> : null}
                      {w.severity ? <span className="text-white/55"> · {w.severity}</span> : null}
                    </div>
                    {/* P161: items[] 없는 단건 warning (self-heal 류) 의 message 도 표시 */}
                    {!hasItems && typeof w.message === 'string' && w.message.length > 0 && (
                      <div className="font-mono text-[12px] text-white/65 break-words">{w.message}</div>
                    )}
                    {hasItems && (
                      <ul className="space-y-0.5">
                        {w.items!.map((item, j) => (
                          <li key={j} className="font-mono text-[12px] text-white/65">
                            {item.message ? (
                              <>{item.message}</>
                            ) : (
                              <>
                                Day {item.day ?? '?'} · {item.position ?? '?'} · &quot;{item.stopName ?? ''}&quot;
                                {typeof item.distM === 'number' ? ` · ${(item.distM / 1000).toFixed(1)}km` : ''}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

            <div className="text-[12px] text-white/40 italic">
              ※ multi-city plan 의 lodging_bookend_violation 은 의도된 패턴 (anchor=첫 day 호텔 vs 도시 이동 후 호텔).
              validator multi-city 미인식 — 별도 후속 fix 후보.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
