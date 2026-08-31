// RuntimeFlagsPanel — 어드민 조종석 런타임 토글 (2026-06-06).
// /api/admin-runtime-flags (GET 현재값+스키마, POST {key,value} 토글). 재배포 없이 백엔드 플래그 on/off.
// 화이트리스트(백엔드 RUNTIME_FLAG_KEYS)만 노출. fail-safe: 백엔드 읽기 실패 시 기본값 OFF.
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { RuntimeFlagsView, type RuntimeFlagSchema } from '@/components/admin/RuntimeFlagsView';

interface RuntimeFlagsPanelProps {
  onlyKeys?: readonly string[];
}

export function RuntimeFlagsPanel({ onlyKeys }: RuntimeFlagsPanelProps = {}) {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [schema, setSchema] = useState<Record<string, RuntimeFlagSchema>>({});
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
        + 'Vercel Production의 자동접수·UTC 시작시각·시간창·일일상한·공용 처리수 설정을 먼저 확인했습니까?\n'
        + '접수확인만 운영할 때는 초안·최종답변 워커를 꺼 두어야 합니다.\n'
        + '최종 견적 답변은 계속 운영자가 별도로 검토해 보내야 합니다.',
      );
      if (!confirmed) return;
    }
    void toggle(key, value);
  };

  if (loading) return null;
  return (
    <RuntimeFlagsView
      flags={flags}
      schema={schema}
      busy={busy}
      onlyKeys={onlyKeys}
      onRequestToggle={requestToggle}
    />
  );
}
