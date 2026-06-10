// /admin/decisions — 의사결정 큐 (자가운영 에이전시 P5). 운영자가 결정할 것만 카드로 (승인/거절).
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface DecisionItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  link: string;
  createdAtMs: number;
}

const cardStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' };
const TYPE_LABEL: Record<string, string> = {
  content_publish: '📣 콘텐츠 발행',
  cs_reply: '💬 문의 응대',
  ops_alert: '🛠️ 운영 경보',
  'payment-audit': '💰 결제 감사',
  'plan-stuck': '🚨 plan 미생성',
  'error-surge': '🛠️ 에러 폭증',
  ops: '🛠️ 운영',
  general: '📥 일반',
};

export default function AdminDecisions() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [items, setItems] = useState<DecisionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-decisions', { headers: { Authorization: `Bearer ${idToken}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setItems(json.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const resolve = useCallback(async (id: string, action: 'approve' | 'reject') => {
    if (!user) return;
    setBusy(id);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-decisions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || '처리 실패'); }
      setItems((prev) => (prev || []).filter((it) => it.id !== id)); // 낙관적 제거
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setBusy(null);
    }
  }, [user]);

  return (
    <div className="min-h-screen" style={{ background: '#0a0b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/60 hover:text-white text-sm">
            <ArrowLeft size={16} /> 어드민
          </Link>
          <button onClick={reload} disabled={loading} className="px-3 py-1.5 rounded-lg text-sm text-white/80" style={cardStyle}>
            {loading ? '갱신 중...' : '↻ 갱신'}
          </button>
        </div>
        <h1 className="text-[22px] font-black text-white mb-1">📥 결정 대기</h1>
        <p className="text-[12px] text-white/40 mb-4">사무실이 올린 "사장님 결정이 필요한 일" · 승인/거절</p>

        {error && <p className="text-red-400 text-sm py-3">{error}</p>}
        {items && items.length === 0 && !error && (
          <p className="text-white/40 py-12 text-center">결정 대기 항목 없음 ✅</p>
        )}
        {!items && !error && <p className="text-white/40 py-12 text-center">불러오는 중...</p>}

        <div className="space-y-3">
          {(items || []).map((it) => (
            <div key={it.id} className="rounded-2xl p-4" style={cardStyle}>
              <p className="text-[11px] text-white/40 mb-1">{TYPE_LABEL[it.type] || it.type}</p>
              <p className="text-[15px] font-bold text-white">{it.title}</p>
              {it.summary && <p className="text-[13px] text-white/60 mt-1">{it.summary}</p>}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => resolve(it.id, 'approve')}
                  disabled={busy === it.id}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold"
                  style={{ background: 'rgba(16,185,129,0.18)', color: '#6EE7B7' }}
                >
                  {busy === it.id ? '…' : '✓ 승인'}
                </button>
                <button
                  onClick={() => resolve(it.id, 'reject')}
                  disabled={busy === it.id}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold"
                  style={{ background: 'rgba(248,113,113,0.15)', color: '#FCA5A5' }}
                >
                  ✕ 거절
                </button>
                {it.link && (
                  <Link to={it.link} className="px-3 py-1.5 rounded-lg text-sm text-white/70" style={cardStyle}>
                    보기 →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
