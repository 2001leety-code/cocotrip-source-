// RuntimeFlagsPanel — 어드민 조종석 런타임 토글 (2026-06-06).
// /api/admin-runtime-flags (GET 현재값+스키마, POST {key,value} 토글). 재배포 없이 백엔드 플래그 on/off.
// 화이트리스트(백엔드 RUNTIME_FLAG_KEYS)만 노출. fail-safe: 백엔드 읽기 실패 시 기본값 OFF.
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface FlagSchema { label: string; desc: string; default: boolean }

export function RuntimeFlagsPanel() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [schema, setSchema] = useState<Record<string, FlagSchema>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const load = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin-runtime-flags', { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (active && json.ok) {
          setFlags(json.flags || {});
          setSchema(json.schema || {});
        }
      } catch { /* 무시 — 패널 미표시 */ } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [user]);

  const toggle = async (key: string, value: boolean) => {
    if (!user) return;
    setBusy(key);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-runtime-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (json.ok) { setFlags(json.flags || {}); toast.success(`${schema[key]?.label}: ${value ? '켜짐' : '꺼짐'}`); }
      else toast.error(json.error || '토글 실패');
    } catch { toast.error('네트워크 오류'); } finally { setBusy(null); }
  };

  const requestToggle = (key: string, value: boolean) => {
    if (key === 'inquiry_auto_ack_enabled' && value) {
      const confirmed = window.confirm(
        '새 문의에 자동 접수 확인 메일을 실제 발송합니다.\n\n'
        + 'Vercel Production의 워커·자동접수·UTC 시작시각·시간창·일일상한 설정을 먼저 확인했습니까?\n'
        + '최종 견적 답변은 계속 운영자가 별도로 검토해 보내야 합니다.',
      );
      if (!confirmed) return;
    }
    void toggle(key, value);
  };

  if (loading) return null;
  const keys = Object.keys(schema);
  if (keys.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.06] px-3 sm:px-4 py-3 space-y-2.5">
      <p className="text-[12px] font-bold text-white/85 flex items-center gap-1.5 flex-wrap">
        🎛️ 운영 토글
        <span className="text-[10px] font-normal text-white/45">저장 후 다음 백엔드 실행부터 반영</span>
      </p>
      {keys.map((key) => {
        const on = !!flags[key];
        return (
          <div key={key} className="flex items-start justify-between gap-3 pt-1.5 border-t border-white/[0.05] first:border-t-0 first:pt-0">
            <div className="min-w-0">
              <p className="text-[12px] text-white/80 font-medium">{schema[key].label}</p>
              <p className="text-[10.5px] text-white/45 leading-snug">{schema[key].desc}</p>
            </div>
            <button
              type="button"
              onClick={() => requestToggle(key, !on)}
              disabled={busy === key}
              className={`min-h-[44px] shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D86FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b14] disabled:opacity-50 ${
                on
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-white/[0.04] border-white/[0.12] text-white/55 hover:border-white/25'
              }`}
            >
              {busy === key ? '...' : on ? '✓ 켜짐' : '꺼짐'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
