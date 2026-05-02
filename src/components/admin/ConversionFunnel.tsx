import { useState } from 'react';
import { ArrowDown, AlertTriangle, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface FunnelStep {
  label: string;
  count: number;
  prevCount?: number; // 지난달 비교
}

const CURRENT_MONTH: FunnelStep[] = [
  { label: '플래너 페이지 진입', count: 2450, prevCount: 2100 },
  { label: 'AI 일정 생성 완료', count: 1820, prevCount: 1600 },
  { label: '예약/결제창 진입', count: 680, prevCount: 750 },
  { label: '결제 완료', count: 412, prevCount: 380 },
];

export default function ConversionFunnel() {
  const [period, setPeriod] = useState<'month' | 'week'>('month');
  const steps = CURRENT_MONTH;
  const maxCount = steps[0].count;

  // Find worst drop-off
  let worstDropIdx = 0;
  let worstDropRate = 0;
  for (let i = 1; i < steps.length; i++) {
    const dropRate = 1 - steps[i].count / steps[i - 1].count;
    if (dropRate > worstDropRate) {
      worstDropRate = dropRate;
      worstDropIdx = i;
    }
  }

  const overallConversion = ((steps[steps.length - 1].count / steps[0].count) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          {(['month', 'week'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p ? 'bg-[#FBBF24] text-black' : 'bg-[#12131C] border border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {p === 'month' ? '이번 달' : '이번 주'}
            </button>
          ))}
        </div>
        <div className="bg-[#12131C] border border-gray-800 rounded-xl px-4 py-2 text-center">
          <div className="text-xs text-gray-500">전체 전환율</div>
          <div className="text-xl font-bold text-[#FBBF24]">{overallConversion}%</div>
        </div>
      </div>

      {/* Funnel */}
      <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="max-w-2xl mx-auto space-y-0">
          {steps.map((step, idx) => {
            const widthPct = Math.max((step.count / maxCount) * 100, 25);
            const convRate = idx > 0 ? ((step.count / steps[idx - 1].count) * 100).toFixed(1) : '100';
            const dropRate = idx > 0 ? (100 - parseFloat(convRate)).toFixed(1) : '0';
            const isWorstDrop = idx === worstDropIdx && idx > 0;
            const prevDiff = step.prevCount ? step.count - step.prevCount : 0;
            const prevPct = step.prevCount ? ((prevDiff / step.prevCount) * 100).toFixed(1) : '0';

            return (
              <div key={idx}>
                {/* Drop-off indicator */}
                {idx > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <ArrowDown className={`w-4 h-4 ${isWorstDrop ? 'text-red-400' : 'text-gray-600'}`} />
                    <span className={`text-xs font-medium ${isWorstDrop ? 'text-red-400' : 'text-gray-500'}`}>
                      전환 {convRate}% | 이탈 {dropRate}%
                    </span>
                    {isWorstDrop && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                  </div>
                )}

                {/* Funnel bar */}
                <div className="flex items-center gap-4">
                  <div className="w-[140px] shrink-0 text-right">
                    <div className="text-sm font-medium text-gray-200">{step.label}</div>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {prevDiff !== 0 && (
                        <span className={`text-[10px] flex items-center gap-0.5 ${prevDiff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {prevDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {prevDiff > 0 ? '+' : ''}{prevPct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 relative">
                    <div
                      className={`h-12 rounded-lg flex items-center justify-center transition-all duration-500 ${
                        isWorstDrop
                          ? 'bg-gradient-to-r from-red-600/80 to-red-500/60 ring-1 ring-red-500/50'
                          : idx === 0
                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-500'
                            : idx === steps.length - 1
                              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                              : 'bg-gradient-to-r from-blue-600/80 to-blue-500/60'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-white font-bold text-sm">{step.count.toLocaleString()}명</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-400 mb-1">최대 이탈 구간</h3>
              <p className="text-xs text-gray-400">
                "{steps[worstDropIdx - 1]?.label}" 에서 "{steps[worstDropIdx].label}" 단계로 넘어갈 때
                <span className="text-red-400 font-bold"> {(worstDropRate * 100).toFixed(1)}%</span>의 사용자가 이탈합니다.
                결제창 UX 개선 또는 가격 정책 재검토를 권장합니다.
              </p>
            </div>
          </div>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <Activity className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-emerald-400 mb-1">긍정 지표</h3>
              <p className="text-xs text-gray-400">
                AI 일정 생성률은 <span className="text-emerald-400 font-bold">{((steps[1].count / steps[0].count) * 100).toFixed(1)}%</span>로
                매우 높습니다. 사용자들이 플래너 기능 자체에는 강한 관심을 보이고 있습니다.
                전환 퍼널의 후반부 최적화에 집중하세요.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
