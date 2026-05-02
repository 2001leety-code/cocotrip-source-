import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Receipt, Edit3, Check } from 'lucide-react';

interface TourSettlement {
  bookingId: string;
  tourName: string;
  date: string;
  customer: string;
  tourPriceUSD: number;
  overtimeKRW: number;
  driverFee: number;
  fuelCost: number;
  tollCost: number;
  parkingCost: number;
  mealCost: number;
  otherCost: number;
}

const MOCK_SETTLEMENTS: TourSettlement[] = [
  { bookingId: 'CT-13', tourName: 'DMZ 프라이빗', date: '2026-04-30', customer: 'S***h', tourPriceUSD: 350, overtimeKRW: 33000, driverFee: 180000, fuelCost: 45000, tollCost: 12000, parkingCost: 5000, mealCost: 15000, otherCost: 0 },
  { bookingId: 'CT-14', tourName: '남이섬 일일투어', date: '2026-04-30', customer: '田***', tourPriceUSD: 420, overtimeKRW: 0, driverFee: 200000, fuelCost: 55000, tollCost: 18000, parkingCost: 8000, mealCost: 15000, otherCost: 0 },
  { bookingId: 'CT-15', tourName: '서울 나이트', date: '2026-04-30', customer: 'J***e', tourPriceUSD: 150, overtimeKRW: 16500, driverFee: 120000, fuelCost: 20000, tollCost: 0, parkingCost: 10000, mealCost: 0, otherCost: 0 },
  { bookingId: 'CT-16', tourName: '경주 1박2일', date: '2026-04-30', customer: '홍***', tourPriceUSD: 780, overtimeKRW: 66000, driverFee: 350000, fuelCost: 120000, tollCost: 35000, parkingCost: 15000, mealCost: 30000, otherCost: 50000 },
  { bookingId: 'CT-11', tourName: 'BTS 성지순례', date: '2026-04-29', customer: 'M***a', tourPriceUSD: 250, overtimeKRW: 0, driverFee: 150000, fuelCost: 30000, tollCost: 5000, parkingCost: 20000, mealCost: 12000, otherCost: 0 },
];

export default function ProfitSettlement() {
  const [exchangeRate, setExchangeRate] = useState(1380);
  const [editingId, setEditingId] = useState<string | null>(null);

  const enriched = MOCK_SETTLEMENTS.map(s => {
    const revenueKRW = Math.round(s.tourPriceUSD * exchangeRate);
    const totalRevenue = revenueKRW + s.overtimeKRW;
    const totalCost = s.driverFee + s.fuelCost + s.tollCost + s.parkingCost + s.mealCost + s.otherCost;
    const netProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;
    return { ...s, revenueKRW, totalRevenue, totalCost, netProfit, margin };
  });

  const totalRev = enriched.reduce((s, e) => s + e.totalRevenue, 0);
  const totalCost = enriched.reduce((s, e) => s + e.totalCost, 0);
  const totalProfit = totalRev - totalCost;
  const avgMargin = totalRev > 0 ? Math.round((totalProfit / totalRev) * 100) : 0;

  const kpis = [
    { label: '총 매출', value: `${totalRev.toLocaleString()}원`, icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: '총 비용', value: `${totalCost.toLocaleString()}원`, icon: Receipt, color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { label: '순이익', value: `${totalProfit.toLocaleString()}원`, icon: totalProfit >= 0 ? TrendingUp : TrendingDown, color: totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400', bg: totalProfit >= 0 ? 'bg-emerald-400/10' : 'bg-red-400/10' },
    { label: '평균 마진율', value: `${avgMargin}%`, icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10' },
  ];

  return (
    <div className="space-y-4">
      {/* Exchange Rate */}
      <div className="flex items-center gap-3 bg-[#12131C] border border-gray-800 rounded-xl p-3">
        <DollarSign className="w-4 h-4 text-[#FBBF24]" />
        <span className="text-sm text-gray-400">오늘의 환율 (USD/KRW):</span>
        <input
          type="number"
          value={exchangeRate}
          onChange={e => setExchangeRate(Number(e.target.value))}
          className="w-24 bg-[#0a0b14] border border-gray-700 rounded px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-[#FBBF24]"
        />
        <span className="text-xs text-gray-500">$1 = {exchangeRate.toLocaleString()}원</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <div key={i} className="bg-[#12131C] border border-gray-800 rounded-xl p-4">
            <div className={`p-2 rounded-lg ${k.bg} inline-block mb-2`}>
              <k.icon className={`w-5 h-5 ${k.color}`} />
            </div>
            <p className="text-xs text-gray-500 mb-0.5">{k.label}</p>
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Settlement Table */}
      <div className="bg-[#12131C] border border-gray-800 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-[#1a1b26]">
              <th className="text-left p-3 text-gray-400 font-medium text-xs">예약</th>
              <th className="text-left p-3 text-gray-400 font-medium text-xs">투어</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">매출(USD)</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">매출(KRW)</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">OT수금</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">기사비</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">유류/톨/주차</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">기타</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">순이익</th>
              <th className="text-right p-3 text-gray-400 font-medium text-xs">마진</th>
              <th className="p-3 text-gray-400 font-medium text-xs w-10"></th>
            </tr>
          </thead>
          <tbody>
            {enriched.map(row => (
              <tr key={row.bookingId} className="border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors">
                <td className="p-3">
                  <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{row.bookingId}</span>
                  <div className="text-[10px] text-gray-600 mt-0.5">{row.date}</div>
                </td>
                <td className="p-3">
                  <div className="font-medium text-gray-200 text-xs">{row.tourName}</div>
                  <div className="text-[10px] text-gray-500">{row.customer}</div>
                </td>
                <td className="p-3 text-right text-gray-300">${row.tourPriceUSD}</td>
                <td className="p-3 text-right text-blue-400 font-medium">{row.revenueKRW.toLocaleString()}</td>
                <td className="p-3 text-right text-orange-300">{row.overtimeKRW > 0 ? `+${row.overtimeKRW.toLocaleString()}` : '-'}</td>
                <td className="p-3 text-right text-red-300">-{row.driverFee.toLocaleString()}</td>
                <td className="p-3 text-right text-red-300/70">-{(row.fuelCost + row.tollCost + row.parkingCost).toLocaleString()}</td>
                <td className="p-3 text-right text-red-300/50">{(row.mealCost + row.otherCost) > 0 ? `-${(row.mealCost + row.otherCost).toLocaleString()}` : '-'}</td>
                <td className={`p-3 text-right font-bold ${row.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {row.netProfit >= 0 ? '+' : ''}{row.netProfit.toLocaleString()}
                </td>
                <td className={`p-3 text-right font-medium text-xs ${row.margin >= 40 ? 'text-emerald-400' : row.margin >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {row.margin}%
                </td>
                <td className="p-3">
                  <button
                    onClick={() => setEditingId(editingId === row.bookingId ? null : row.bookingId)}
                    className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-500 hover:text-white"
                  >
                    {editingId === row.bookingId ? <Check className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#1a1b26] border-t border-gray-700">
              <td colSpan={3} className="p-3 text-xs text-gray-400 font-bold">합계</td>
              <td className="p-3 text-right text-blue-400 font-bold">{enriched.reduce((s, r) => s + r.revenueKRW, 0).toLocaleString()}</td>
              <td className="p-3 text-right text-orange-300 font-bold">+{enriched.reduce((s, r) => s + r.overtimeKRW, 0).toLocaleString()}</td>
              <td className="p-3 text-right text-red-300 font-bold">-{enriched.reduce((s, r) => s + r.driverFee, 0).toLocaleString()}</td>
              <td className="p-3 text-right text-red-300/70 font-bold">-{enriched.reduce((s, r) => s + r.fuelCost + r.tollCost + r.parkingCost, 0).toLocaleString()}</td>
              <td className="p-3 text-right text-red-300/50 font-bold">-{enriched.reduce((s, r) => s + r.mealCost + r.otherCost, 0).toLocaleString()}</td>
              <td className={`p-3 text-right font-bold text-lg ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString()}
              </td>
              <td className="p-3 text-right text-purple-400 font-bold">{avgMargin}%</td>
              <td className="p-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
