import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Receipt, Edit3, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, setDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
// 손익 산수(매출/비용/순이익/마진/환율)는 순수 함수로 추출 — byte-identical (test/admin-financial-coverage).
import { type CostRow, EMPTY_COST, enrichBooking, summarizeSettlement } from '@/lib/profitSettlement';

interface BookingRow {
  bookingId: string;
  tourName: string;
  date: string;
  customer: string;
  tourPriceUSD: number;
}

function formatYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return formatYM(d);
}

export default function ProfitSettlement() {
  const [exchangeRate, setExchangeRate] = useState(1380);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CostRow>(EMPTY_COST);
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [costs, setCosts] = useState<Map<string, CostRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => formatYM(new Date()));

  // bookings 실시간
  useEffect(() => {
    setLoading(true);
    const monthStart = `${month}-01`;
    const monthEnd = shiftMonth(month, 1) + '-01';

    const q = query(
      collection(db, 'bookings'),
      where('tourDate', '>=', monthStart),
      where('tourDate', '<', monthEnd),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: BookingRow[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const status = (data.adminStatus || data.status || '').toLowerCase();
          if (status === 'canceled' || status === 'cancelled') return;
          list.push({
            bookingId: d.id,
            tourName: data.productType || '예약',
            date: (data.tourDate || '').slice(0, 10),
            customer: data.payerName || data.userEmail || '-',
            tourPriceUSD: parseFloat(String(data.amountUSD || 0)),
          });
        });
        list.sort((a, b) => (a.date < b.date ? 1 : -1));
        setBookings(list);
        setLoading(false);
      },
      (err) => {
        console.error('[ProfitSettlement] bookings listen error:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [month]);

  // booking_costs 1회 fetch (편집 시 별도 쓰기로 갱신)
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.map((b) => b.bookingId);
    if (ids.length === 0) return;
    // Firestore 'in' 쿼리는 30개 제한 — 청크 분할
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    Promise.all(
      chunks.map((chunk) =>
        getDocs(query(collection(db, 'booking_costs'), where('__name__', 'in', chunk)))
      ),
    ).then((snaps) => {
      const next = new Map<string, CostRow>();
      snaps.forEach((snap) => {
        snap.forEach((d) => {
          const data = d.data() as Partial<CostRow>;
          next.set(d.id, {
            overtimeKRW: data.overtimeKRW || 0,
            driverFee: data.driverFee || 0,
            fuelCost: data.fuelCost || 0,
            tollCost: data.tollCost || 0,
            parkingCost: data.parkingCost || 0,
            mealCost: data.mealCost || 0,
            otherCost: data.otherCost || 0,
          });
        });
      });
      setCosts(next);
    }).catch((err) => {
      console.error('[ProfitSettlement] costs load error:', err);
    });
  }, [bookings]);

  const enriched = useMemo(() => {
    return bookings.map((b) => {
      const c = costs.get(b.bookingId) || EMPTY_COST;
      return { ...b, ...c, ...enrichBooking(b.tourPriceUSD, c, exchangeRate) };
    });
  }, [bookings, costs, exchangeRate]);

  const { totalRev, totalCost, totalProfit, avgMargin } = summarizeSettlement(enriched);

  function startEdit(bookingId: string) {
    setEditDraft(costs.get(bookingId) || { ...EMPTY_COST });
    setEditingId(bookingId);
  }

  async function saveCosts(bookingId: string) {
    setSaving(true);
    try {
      await setDoc(doc(db, 'booking_costs', bookingId), {
        ...editDraft,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      const next = new Map(costs);
      next.set(bookingId, { ...editDraft });
      setCosts(next);
      setEditingId(null);
    } catch (err) {
      console.error('[ProfitSettlement] save error:', err);
      alert('저장 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  const kpis = [
    { label: '총 매출', value: `${totalRev.toLocaleString()}원`, icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: '총 비용', value: `${totalCost.toLocaleString()}원`, icon: Receipt, color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { label: '순이익', value: `${totalProfit.toLocaleString()}원`, icon: totalProfit >= 0 ? TrendingUp : TrendingDown, color: totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400', bg: totalProfit >= 0 ? 'bg-emerald-400/10' : 'bg-red-400/10' },
    { label: '평균 마진율', value: `${avgMargin}%`, icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10' },
  ];

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* Month nav */}
        <div className="flex items-center gap-2 bg-[#12131C] border border-gray-800 rounded-xl p-2">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-1 hover:bg-gray-800 rounded">
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </button>
          <span className="text-sm font-semibold min-w-[80px] text-center">
            {month} {loading && <Loader2 className="w-3 h-3 inline animate-spin ml-1" />}
          </span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="p-1 hover:bg-gray-800 rounded">
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Exchange Rate */}
        <div className="flex items-center gap-2 bg-[#12131C] border border-gray-800 rounded-xl p-3">
          <DollarSign className="w-4 h-4 text-[#FBBF24]" />
          <span className="text-xs text-gray-400">환율:</span>
          <input
            type="number"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(Number(e.target.value))}
            className="w-20 bg-[#0a0b14] border border-gray-700 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-[#FBBF24]"
          />
          <span className="text-[10px] text-gray-500">$1 = {exchangeRate.toLocaleString()}원</span>
        </div>
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
      {bookings.length === 0 && !loading ? (
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-12 text-center text-gray-500 text-sm">
          {month} 예약 없음.
        </div>
      ) : (
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
              {enriched.map((row) => {
                const isEditing = editingId === row.bookingId;
                const draft = isEditing ? editDraft : null;
                return (
                  <tr key={row.bookingId} className="border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors">
                    <td className="p-3">
                      <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{row.bookingId.slice(0, 16)}</span>
                      <div className="text-[10px] text-gray-600 mt-0.5">{row.date}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-gray-200 text-xs">{row.tourName}</div>
                      <div className="text-[10px] text-gray-500">{row.customer}</div>
                    </td>
                    <td className="p-3 text-right text-gray-300">${row.tourPriceUSD.toFixed(0)}</td>
                    <td className="p-3 text-right text-blue-400 font-medium">{row.revenueKRW.toLocaleString()}</td>
                    <td className="p-3 text-right text-orange-300">
                      {isEditing ? (
                        <input type="number" value={draft!.overtimeKRW} onChange={(e) => setEditDraft({ ...editDraft, overtimeKRW: Number(e.target.value) })} className="w-20 bg-[#0a0b14] border border-gray-700 rounded px-1 py-0.5 text-xs text-right" />
                      ) : (row.overtimeKRW > 0 ? `+${row.overtimeKRW.toLocaleString()}` : '-')}
                    </td>
                    <td className="p-3 text-right text-red-300">
                      {isEditing ? (
                        <input type="number" value={draft!.driverFee} onChange={(e) => setEditDraft({ ...editDraft, driverFee: Number(e.target.value) })} className="w-20 bg-[#0a0b14] border border-gray-700 rounded px-1 py-0.5 text-xs text-right" />
                      ) : `-${row.driverFee.toLocaleString()}`}
                    </td>
                    <td className="p-3 text-right text-red-300/70 text-xs">
                      {isEditing ? (
                        <div className="flex flex-col gap-0.5">
                          <input type="number" placeholder="유류" value={draft!.fuelCost} onChange={(e) => setEditDraft({ ...editDraft, fuelCost: Number(e.target.value) })} className="w-16 bg-[#0a0b14] border border-gray-700 rounded px-1 text-xs text-right" />
                          <input type="number" placeholder="톨" value={draft!.tollCost} onChange={(e) => setEditDraft({ ...editDraft, tollCost: Number(e.target.value) })} className="w-16 bg-[#0a0b14] border border-gray-700 rounded px-1 text-xs text-right" />
                          <input type="number" placeholder="주차" value={draft!.parkingCost} onChange={(e) => setEditDraft({ ...editDraft, parkingCost: Number(e.target.value) })} className="w-16 bg-[#0a0b14] border border-gray-700 rounded px-1 text-xs text-right" />
                        </div>
                      ) : `-${(row.fuelCost + row.tollCost + row.parkingCost).toLocaleString()}`}
                    </td>
                    <td className="p-3 text-right text-red-300/50">
                      {isEditing ? (
                        <div className="flex flex-col gap-0.5">
                          <input type="number" placeholder="식비" value={draft!.mealCost} onChange={(e) => setEditDraft({ ...editDraft, mealCost: Number(e.target.value) })} className="w-16 bg-[#0a0b14] border border-gray-700 rounded px-1 text-xs text-right" />
                          <input type="number" placeholder="기타" value={draft!.otherCost} onChange={(e) => setEditDraft({ ...editDraft, otherCost: Number(e.target.value) })} className="w-16 bg-[#0a0b14] border border-gray-700 rounded px-1 text-xs text-right" />
                        </div>
                      ) : ((row.mealCost + row.otherCost) > 0 ? `-${(row.mealCost + row.otherCost).toLocaleString()}` : '-')}
                    </td>
                    <td className={`p-3 text-right font-bold ${row.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.netProfit >= 0 ? '+' : ''}{row.netProfit.toLocaleString()}
                    </td>
                    <td className={`p-3 text-right font-medium text-xs ${row.margin >= 40 ? 'text-emerald-400' : row.margin >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {row.margin}%
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <button
                          disabled={saving}
                          onClick={() => saveCosts(row.bookingId)}
                          className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded transition-colors disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </button>
                      ) : (
                        <button
                          onClick={() => startEdit(row.bookingId)}
                          className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-500 hover:text-white"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
      )}
    </div>
  );
}
