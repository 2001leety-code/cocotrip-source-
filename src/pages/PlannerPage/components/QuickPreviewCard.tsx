// Quick preview card -- extracted from legacy PlannerPage.tsx L1613-1703.
// B3b (2026-06-23): the flat Day-1 table is upgraded to the SAME expandable
// detail-card pattern as the full plan (PreviewStopCard reuses StopCard's
// look-and-feel + shared map-link builder). Falls back to the flat table when
// the markdown can't be parsed into rows — graceful, no crash.
import { Sparkles } from 'lucide-react';
import type { PlannerDict } from '../types';
import { PreviewStopCard } from './PreviewStopCard';
import { parsePreviewTable } from '../lib/previewTable';

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
        // B3b: prefer expandable detail cards (same UX as the paid plan). The
        // preview data is name + tip only — cards degrade gracefully, map links
        // are built from the spot name.
        const previewStops = parsePreviewTable(tableStr);
        if (previewStops.length > 0) {
          return (
            <div className="space-y-2">
              {previewStops.map((s, si) => (
                <PreviewStopCard key={si} stop={s} p={p} isMobile={isMobile} />
              ))}
            </div>
          );
        }
        const tableLines = tableStr.split('\n').filter((l: string) => l.trim().startsWith('|'));
        const dataLines = tableLines.filter((l: string) => !l.match(/^\|[\s:\-]+\|$/));
        if (dataLines.length < 2) {
          return (
            <div className="bg-black/40 rounded-xl p-4 overflow-x-auto text-sm text-white/80">
              <pre style={{ whiteSpace: 'pre-wrap' }} className="font-mono text-[11px] opacity-80">{tableStr}</pre>
            </div>
          );
        }
        const tHeaders = dataLines[0].split('|').filter((c: string) => c.trim()).map((c: string) => c.trim());
        const tRows = dataLines.slice(1).map((r: string) => r.split('|').filter((c: string) => c.trim()).map((c: string) => c.trim()));
        return (
          <div className="bg-black/30 rounded-xl overflow-hidden border border-white/[0.08]">
            <table className="w-full text-sm">
              <thead>
                <tr className={isMobile ? 'bg-[#B668FC]/15' : 'bg-[#7C5CFC]/15'}>
                  {tHeaders.map((h: string, hi: number) => (
                    <th key={hi} className="px-3 py-2.5 text-left text-[11px] font-bold text-white/70 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tRows.map((row: string[], ri: number) => (
                  <tr key={ri} className={`border-t border-white/[0.06] ${ri % 2 === 0 ? 'bg-white/[0.02]' : 'bg-white/[0.04]'} hover:bg-white/[0.07] transition-colors`}>
                    {row.map((cell: string, ci: number) => (
                      <td key={ci} className={`px-3 py-2.5 text-[13px] ${ci === 0 ? (isMobile ? 'font-bold text-[#FF6B9D]' : 'font-bold text-[#C4956A]') : 'text-white/70'}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
