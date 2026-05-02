import { useState } from 'react';
import { Star, Award, MessageCircle, Clock, AlertCircle, ArrowRight } from 'lucide-react';

interface DriverRating {
  driver: string;
  totalReviews: number;
  averageRating: number;
  badge: 'gold' | 'silver' | 'none';
}

interface ReviewEntry {
  id: string;
  bookingId: string;
  customer: string;
  driver: string;
  rating: number;
  text: string;
  platform: 'google' | 'tripadvisor' | 'internal';
  sentAt: string;
  respondedAt?: string;
  status: 'sent' | 'responded' | 'expired';
}

interface CSTicket {
  id: string;
  bookingId: string;
  customer: string;
  issue: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

const DRIVER_RATINGS: DriverRating[] = [
  { driver: '소윤환', totalReviews: 87, averageRating: 4.9, badge: 'gold' },
  { driver: '김기사', totalReviews: 64, averageRating: 4.7, badge: 'silver' },
  { driver: '이기사', totalReviews: 45, averageRating: 4.5, badge: 'none' },
  { driver: '박기사', totalReviews: 52, averageRating: 4.8, badge: 'gold' },
  { driver: '최기사', totalReviews: 38, averageRating: 4.3, badge: 'none' },
];

const REVIEWS: ReviewEntry[] = [
  { id: 'r1', bookingId: 'CT-13', customer: 'S***h Smith', driver: '소윤환', rating: 5, text: 'Amazing tour guide and driver! Very professional.', platform: 'google', sentAt: '2026-04-30T20:00', respondedAt: '2026-04-30T21:30', status: 'responded' },
  { id: 'r2', bookingId: 'CT-14', customer: '田***太郎', driver: '김기사', rating: 5, text: 'とても素晴らしい体験でした', platform: 'tripadvisor', sentAt: '2026-04-30T20:00', respondedAt: '2026-04-30T22:00', status: 'responded' },
  { id: 'r3', bookingId: 'CT-15', customer: 'J***n Doe', driver: '이기사', rating: 4, text: 'Good service overall', platform: 'google', sentAt: '2026-04-30T20:00', status: 'sent' },
  { id: 'r4', bookingId: 'CT-11', customer: 'M***a', driver: '최기사', rating: 0, text: '', platform: 'google', sentAt: '2026-04-29T20:00', status: 'expired' },
];

const CS_TICKETS: CSTicket[] = [
  { id: 'cs1', bookingId: 'CT-09', customer: 'A***x', issue: '픽업 시간 30분 지연', priority: 'high', status: 'in_progress', createdAt: '2026-04-29T14:00' },
  { id: 'cs2', bookingId: 'CT-07', customer: 'L***a', issue: '차량 내 에어컨 불량', priority: 'medium', status: 'open', createdAt: '2026-04-28T16:00' },
  { id: 'cs3', bookingId: 'CT-05', customer: '김***수', issue: '결제 금액 오차 문의', priority: 'low', status: 'resolved', createdAt: '2026-04-27T10:00', resolvedAt: '2026-04-27T15:00' },
];

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'text-red-400' },
  in_progress: { label: '처리중', color: 'text-yellow-400' },
  resolved: { label: '해결', color: 'text-emerald-400' },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`w-3.5 h-3.5 ${s <= rating ? 'text-[#FBBF24] fill-[#FBBF24]' : 'text-gray-700'}`} />
      ))}
    </div>
  );
}

export default function ReviewManagement() {
  const [csFilter, setCsFilter] = useState<string>('all');
  const avgAll = (DRIVER_RATINGS.reduce((s, d) => s + d.averageRating, 0) / DRIVER_RATINGS.length).toFixed(1);
  const responseRate = Math.round((REVIEWS.filter(r => r.status === 'responded').length / REVIEWS.length) * 100);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '총 리뷰', value: DRIVER_RATINGS.reduce((s, d) => s + d.totalReviews, 0), color: 'text-blue-400' },
          { label: '평균 평점', value: avgAll, color: 'text-[#FBBF24]' },
          { label: '응답률', value: `${responseRate}%`, color: 'text-emerald-400' },
          { label: '미해결 CS', value: CS_TICKETS.filter(t => t.status !== 'resolved').length, color: 'text-red-400' },
        ].map((k, i) => (
          <div key={i} className="bg-[#12131C] border border-gray-800 rounded-xl p-3 text-center">
            <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Driver Ratings */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-[#FBBF24]" /> 기사별 평점
          </h3>
          <div className="space-y-3">
            {DRIVER_RATINGS.sort((a, b) => b.averageRating - a.averageRating).map(d => (
              <div key={d.driver} className="flex items-center gap-3 p-2.5 bg-[#0a0b14] rounded-lg">
                <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-300 shrink-0">
                  {d.driver[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{d.driver}</span>
                    {d.badge === 'gold' && <span className="px-1.5 py-0.5 bg-[#FBBF24]/20 text-[#FBBF24] text-[10px] font-bold rounded border border-[#FBBF24]/30">GOLD</span>}
                    {d.badge === 'silver' && <span className="px-1.5 py-0.5 bg-gray-400/20 text-gray-300 text-[10px] font-bold rounded border border-gray-400/30">SILVER</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StarRating rating={Math.round(d.averageRating)} />
                    <span className="text-xs text-gray-500">{d.totalReviews}건</span>
                  </div>
                </div>
                <span className="text-lg font-bold text-[#FBBF24]">{d.averageRating}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Reviews */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-400" /> 최근 리뷰 요청
          </h3>
          <div className="space-y-3">
            {REVIEWS.map(r => (
              <div key={r.id} className="p-3 bg-[#0a0b14] rounded-lg">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{r.bookingId}</span>
                    <span className="text-xs text-gray-400">{r.customer}</span>
                    <span className="text-[10px] text-gray-600">({r.driver})</span>
                  </div>
                  <span className={`text-[10px] font-medium ${
                    r.status === 'responded' ? 'text-emerald-400' : r.status === 'sent' ? 'text-yellow-400' : 'text-gray-500'
                  }`}>
                    {r.status === 'responded' ? 'V 응답 완료' : r.status === 'sent' ? '대기 중' : '만료'}
                  </span>
                </div>
                {r.rating > 0 && (
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating rating={r.rating} />
                  </div>
                )}
                {r.text && <p className="text-xs text-gray-400 truncate">{r.text}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3 text-gray-600" />
                  <span className="text-[10px] text-gray-600">{r.platform} | 발송: {new Date(r.sentAt).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CS Kanban */}
      <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" /> CS 이슈 트래커
          </h3>
          <div className="flex gap-1">
            {['all', 'open', 'in_progress', 'resolved'].map(f => (
              <button
                key={f}
                onClick={() => setCsFilter(f)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  csFilter === f ? 'bg-[#FBBF24] text-black' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {f === 'all' ? '전체' : STATUS_STYLE[f]?.label || f}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['open', 'in_progress', 'resolved'].map(status => {
            const tickets = CS_TICKETS.filter(t => csFilter === 'all' ? t.status === status : t.status === status && csFilter === status);
            if (csFilter !== 'all' && csFilter !== status) return null;
            return (
              <div key={status} className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${status === 'open' ? 'bg-red-400' : status === 'in_progress' ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
                  <span className={`text-xs font-bold ${STATUS_STYLE[status].color}`}>{STATUS_STYLE[status].label}</span>
                  <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{tickets.length}</span>
                </div>
                {tickets.map(t => (
                  <div key={t.id} className="p-3 bg-[#0a0b14] rounded-lg border border-gray-800/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{t.bookingId}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[t.priority]}`}>{t.priority.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-200 font-medium mb-1">{t.issue}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-600">{t.customer}</span>
                      {t.status !== 'resolved' && (
                        <button className="text-[10px] text-[#FBBF24] hover:underline flex items-center gap-0.5">
                          {t.status === 'open' ? '처리 시작' : '해결 완료'} <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {tickets.length === 0 && (
                  <div className="p-4 text-center text-gray-600 text-xs bg-[#0a0b14] rounded-lg">없음</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
