// Quick preview card -- extracted from legacy PlannerPage.tsx L1613-1703.
// 2026-06-28: 표 → 세로 타임라인 카드 재설계 (시각·장소·교통·팁·Google지도 링크). 운영자 Trip.com 벤치마크.
//   day1MarkdownTable(시간|명소|교통|팁 4컬럼, api/ai-planner-quick.js)을 타임라인으로 렌더.
//   교통 컬럼 = 이전 장소→현재 장소 이동 수단. 헤더 정규식으로 유연 감지 → 4컬럼/3컬럼(레거시) 모두 호환.
import { Sparkles, MapPin } from 'lucide-react';
import type { PlannerDict } from '../types';

interface QuickPreviewData {
  themes?: string[];
  marketingNarrative?: string | Record<string, unknown>;
  day1MarkdownTable?: string | Record<string, unknown>;
}

export function QuickPreviewCard({ resultQuick, p, isMobile }: { resultQuick: QuickPreviewData; p: PlannerDict; isMobile: boolean }) {
  return (
    <div className={isMobile
      ? 'm-card m-appear p-5 border-[#B668FC]/30 shadow-[0_0_20px_rgba(182,104,252,0.2)]'
      : 'bg-gradient-to-br from-[#1a0f14] to-[#0a1628] rounded-2xl p-6 border border-[#7C5CFC]/30 shadow-[0_0_20px_rgba(124,92,252,0.2)]'
    }>
      <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2"><Sparkles className={`w-5 h-5 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />{p.quickPreviewTitle}</h2>
      <p className={`font-bold text-sm mb-4 ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>{p.quickPreviewTheme}: {resultQuick.themes?.join(', ') || 'Healing, Luxury'}</p>
      
      <div className="text-sm text-white/80 leading-relaxed mb-6 bg-white/5 p-4 rounded-xl border border-white/10">
        <strong className="text-white block mb-1">{p.quickPreviewNarrative}:</strong>
        {(() => {
          let narrative = resultQuick.marketingNarrative;
          if (!narrative) return '\uC5EC\uD589 \uC77C\uC815\uC744 \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4.';
          if (typeof narrative === 'object') {
            narrative = (narrative as any).full_narrative || (narrative as any).text || (narrative as any).content || (narrative as any).summary || Object.values(narrative as Record<string, unknown>).find(v => typeof v === 'string' && (v as string).length > 20) || JSON.stringify(narrative);
          }
          if (typeof narrative === 'string' && narrative.trim().startsWith('{')) {
            try { const parsed = JSON.parse(narrative); narrative = parsed.full_narrative || parsed.text || parsed.content || narrative; } catch {}
          }
          if (typeof narrative === 'string') {
            narrative = narrative.replace(/^\{[^}]*"(themes|marketingNarrative)"[^}]*$/g, '');
            narrative = narrative.replace(/[{}"[\]]/g, '').replace(/\s*,\s*/g, ', ').trim();
          }
          return String(narrative || '\uC5EC\uD589 \uC77C\uC815\uC744 \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4.').slice(0, 500);
        })()}
      </div>

      {(() => {
        let table = resultQuick.day1MarkdownTable;
        if (!table) return null;
        if (typeof table === 'object') { table = (table as Record<string, unknown>).content as string || (table as Record<string, unknown>).table as string || JSON.stringify(table, null, 2); }
        if (typeof table === 'string') {
          table = table.replace(/\\n/g, '\n');
          if (table.trim().startsWith('{') || table.trim().startsWith('[')) {
            try { const parsed = JSON.parse(table); table = parsed.content || parsed.table || JSON.stringify(parsed, null, 2); } catch {}
          }
        }
        if (!table || (typeof table === 'string' && table.trim().length < 10)) return null;
        const tableStr = String(table);
        const tableLines = tableStr.split('\n').filter((l: string) => l.trim().startsWith('|'));
        // separator 행 제거 — multi-column "| --- | --- |" 은 셀 사이 | 때문에 [\s:\-] 만으론 안 걸러짐 → | 포함(미리보기 "--- ---" 가짜행 fix).
        const dataLines = tableLines.filter((l: string) => !l.match(/^\|[\s:\-|]+\|$/));
        if (dataLines.length < 2) {
          return (
            <div className="bg-black/40 rounded-xl p-4 overflow-x-auto text-sm text-white/80">
              <pre style={{ whiteSpace: 'pre-wrap' }} className="font-mono text-[11px] opacity-80">{tableStr}</pre>
            </div>
          );
        }
        const tHeaders = dataLines[0].split('|').filter((c: string) => c.trim()).map((c: string) => c.trim());
        const tRows = dataLines.slice(1).map((r: string) => r.split('|').filter((c: string) => c.trim()).map((c: string) => c.trim()));
        // 헤더에 교통 컬럼 탐지 (4컬럼 시간|명소|교통|팁). 레거시 3컬럼(교통 없음)은 transitIdx=-1 → 하위호환.
        const transitIdx = tHeaders.findIndex((h: string) => /교통|이동|transit|交通|교통편/i.test(h));
        const accent = isMobile ? '#B668FC' : '#7C5CFC';
        const mapLabel = p.quickPreviewMapLabel || 'Map';
        return (
          <div className="relative pl-1">
            {/* 세로 타임라인 선 */}
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-[#7C5CFC]/70 via-[#B668FC]/40 to-[#EA537E]/30" aria-hidden />
            <ol className="space-y-2.5">
              {tRows.map((row: string[], ri: number) => {
                const time = row[0] || '';
                const place = row[1] || '';
                const transit = transitIdx >= 2 ? (row[transitIdx] || '') : '';
                const lastIdx = row.length - 1;
                const tip = lastIdx > 1 && lastIdx !== transitIdx ? (row[lastIdx] || '') : '';
                const mapUrl = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : '';
                return (
                  <li key={ri} className="relative pl-5">
                    {/* 타임라인 점 */}
                    <span className="absolute left-0 top-[7px] w-[11px] h-[11px] rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] ring-[3px] ring-[#0a1628]" aria-hidden />
                    <div className="bg-white/[0.04] rounded-xl px-3.5 py-2.5 border border-white/[0.08] hover:bg-white/[0.07] hover:border-[#7C5CFC]/30 transition-all">
                      <div className="flex items-center gap-2">
                        {time && <span className="text-[12px] font-bold shrink-0" style={{ color: accent }}>{time}</span>}
                        <span className="font-bold text-white text-[14px] flex-1 leading-tight">{place}</span>
                        {mapUrl && (
                          <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-medium transition-opacity hover:opacity-80" style={{ color: accent }} aria-label={`${place} ${mapLabel}`}>
                            <MapPin className="w-3 h-3" />{mapLabel}
                          </a>
                        )}
                      </div>
                      {transit && <p className="text-[11px] text-[#9FB4D8] mt-1 flex items-center gap-1">🚇 {transit}</p>}
                      {tip && <p className="text-[12px] text-white/60 mt-1 leading-relaxed">{tip}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}
    </div>
  );
}
