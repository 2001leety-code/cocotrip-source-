import React, { useState, useEffect } from 'react';
import { Send, CheckCircle, XCircle, AlertCircle, Shield, Clock, Search, Loader2 } from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type LogType = 'dispatch_sent' | 'inquiry_accepted' | 'inquiry_rejected' | 'inquiry_timeout' | 'pii_deleted';

interface TelegramLogEntry {
  id: string;
  timestamp: number;       // ms epoch
  type: LogType;
  driver: string;
  bookingId: string;
  messagePreview: string;
}

interface DispatchMessageDoc {
  orderID?: string;
  driverChatId?: number;
  driverName?: string;
  driverVehicle?: string;
  status?: 'sent' | 'accepted' | 'rejected' | 'expired';
  telegramMessageId?: number;
  sentAt?: Timestamp;
  respondedAt?: Timestamp;
  expiresAt?: Timestamp;
}

const TYPE_CONFIG: Record<LogType, { icon: React.ElementType; label: string; color: string }> = {
  dispatch_sent:     { icon: Send,        label: '배차 발송',  color: 'text-blue-400' },
  inquiry_accepted:  { icon: CheckCircle, label: '배차 수락',  color: 'text-green-400' },
  inquiry_rejected:  { icon: XCircle,     label: '배차 거절',  color: 'text-red-400' },
  inquiry_timeout:   { icon: Clock,       label: '10분 초과',  color: 'text-orange-400' },
  pii_deleted:       { icon: Shield,      label: 'PII 파기',  color: 'text-emerald-400' },
};

function statusToLogType(status: string | undefined): LogType {
  switch (status) {
    case 'accepted': return 'inquiry_accepted';
    case 'rejected': return 'inquiry_rejected';
    case 'expired': return 'inquiry_timeout';
    case 'sent':
    default: return 'dispatch_sent';
  }
}

function buildPreview(d: DispatchMessageDoc): string {
  const parts: string[] = [];
  if (d.driverVehicle) parts.push(d.driverVehicle);
  if (d.status === 'sent') parts.push('기사 응답 대기 중');
  if (d.status === 'accepted') parts.push('기사 수락 완료');
  if (d.status === 'rejected') parts.push('기사 거절 — 재배차 필요');
  if (d.status === 'expired') parts.push('10분 무응답 자동 취소 + PII 파기');
  return parts.join(' · ') || '배차 메시지';
}

export default function TelegramLogs() {
  const [logs, setLogs] = useState<TelegramLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    // 최근 100건 (sentAt 기준 내림차순)
    const q = query(
      collection(db, 'dispatch_messages'),
      orderBy('sentAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TelegramLogEntry[] = [];
        snap.forEach((doc) => {
          const d = doc.data() as DispatchMessageDoc;
          // 이벤트 시각: 응답된 경우 respondedAt, 아니면 sentAt
          const ts = (d.respondedAt || d.sentAt) as Timestamp | undefined;
          const ms = ts?.toMillis ? ts.toMillis() : Date.now();
          list.push({
            id: doc.id,
            timestamp: ms,
            type: statusToLogType(d.status),
            driver: d.driverName || `chat:${d.driverChatId || '-'}`,
            bookingId: d.orderID || doc.id,
            messagePreview: buildPreview(d),
          });
        });
        setLogs(list);
        setLoading(false);
      },
      (err) => {
        console.error('[TelegramLogs] listen error:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const drivers = Array.from(new Set(logs.map((l) => l.driver)));

  const filtered = logs.filter((log) => {
    if (filter !== 'all' && log.driver !== filter) return false;
    if (search && !log.messagePreview.includes(search) && !log.bookingId.includes(search)) return false;
    return true;
  });

  const counts = {
    sent: logs.filter((l) => l.type === 'dispatch_sent').length,
    accepted: logs.filter((l) => l.type === 'inquiry_accepted').length,
    rejected: logs.filter((l) => l.type === 'inquiry_rejected').length,
    expired: logs.filter((l) => l.type === 'inquiry_timeout').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="예약번호 또는 내용 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#12131C] border border-gray-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#FBBF24]"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-[#12131C] border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-[#FBBF24]"
        >
          <option value="all">전체 기사</option>
          {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '발송 (대기)', value: counts.sent, color: 'text-blue-400' },
          { label: '수락', value: counts.accepted, color: 'text-green-400' },
          { label: '거절', value: counts.rejected, color: 'text-red-400' },
          { label: '10분 초과', value: counts.expired, color: 'text-orange-400' },
        ].map((s, i) => (
          <div key={i} className="bg-[#12131C] border border-gray-800 rounded-xl p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#12131C] border border-gray-800 rounded-2xl overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 로딩 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            {logs.length === 0 ? '아직 배차 기록이 없습니다.' : '필터 조건에 맞는 기록 없음'}
          </div>
        ) : (
          filtered.map((log, idx) => {
            const config = TYPE_CONFIG[log.type];
            const Icon = config.icon;
            return (
              <div
                key={log.id}
                className={`flex items-start gap-3 p-4 ${idx !== filtered.length - 1 ? 'border-b border-gray-800/50' : ''} hover:bg-gray-800/20 transition-colors`}
              >
                <div className={`p-2 rounded-lg bg-gray-800/50 ${config.color} shrink-0 mt-0.5`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
                    <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{log.bookingId}</span>
                    <span className="text-[10px] text-gray-600">{log.driver}</span>
                  </div>
                  <p className="text-sm text-gray-300 truncate">{log.messagePreview}</p>
                  <span className="text-[10px] text-gray-600 mt-1 block">
                    {new Date(log.timestamp).toLocaleString('ko-KR')}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
