// PromoBannerPanel — 프로모 배너 어드민 설정 패널 (2026-06-07).
// /api/admin-promo-config (GET 현재값, POST {config} 저장). 배포 없이 배너 문구/CTA/마감일/켜끄기.
// RuntimeFlagsPanel 패턴 동일.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface PromoConfig {
  enabled: boolean;
  copy: Record<string, string>;
  ctaText: Record<string, string>;
  ctaHref: string;
  endDate: string;
}

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
type Lang = typeof LANGS[number];

const LANG_LABEL: Record<Lang, string> = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文' };

export function PromoBannerPanel() {
  const { user } = useAuth();
  const [config, setConfig] = useState<PromoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 편집 중인 로컬 값
  const [draft, setDraft] = useState<PromoConfig | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-promo-config', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.ok && json.config) {
        setConfig(json.config);
        setDraft(structuredClone(json.config));
      }
    } catch { /* 무시 */ } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!user || !draft) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-promo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config: draft }),
      });
      const json = await res.json();
      if (json.ok && json.config) {
        setConfig(json.config);
        setDraft(structuredClone(json.config));
        toast.success('배너 설정 저장 완료 (~60초 후 반영)');
      } else {
        toast.error(json.error || '저장 실패');
      }
    } catch { toast.error('네트워크 오류'); } finally { setSaving(false); }
  };

  if (loading || !draft) return null;

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  function setEnabled(val: boolean) {
    setDraft((d) => d ? { ...d, enabled: val } : d);
  }
  function setCopyLang(lang: Lang, val: string) {
    setDraft((d) => d ? { ...d, copy: { ...d.copy, [lang]: val } } : d);
  }
  function setCtaTextLang(lang: Lang, val: string) {
    setDraft((d) => d ? { ...d, ctaText: { ...d.ctaText, [lang]: val } } : d);
  }
  function setCtaHref(val: string) {
    setDraft((d) => d ? { ...d, ctaHref: val } : d);
  }
  function setEndDate(val: string) {
    setDraft((d) => d ? { ...d, endDate: val } : d);
  }

  return (
    <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.06] px-3 sm:px-4 py-3 space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] font-bold text-white/85 flex items-center gap-1.5 flex-wrap">
          📣 프로모 배너 설정
          <span className="text-[10px] font-normal text-white/45">저장 후 ~60초 반영</span>
        </p>
        <div className="flex items-center gap-2">
          {/* 켜기/끄기 토글 */}
          <button
            onClick={() => setEnabled(!draft.enabled)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all min-h-[36px] ${
              draft.enabled
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-white/[0.04] border-white/[0.12] text-white/55 hover:border-white/25'
            }`}
          >
            {draft.enabled ? '✓ 배너 켜짐' : '배너 꺼짐'}
          </button>
        </div>
      </div>

      {/* 배너 문구 (copy) */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-white/60 font-semibold">배너 문구</p>
        {LANGS.map((lang) => (
          <div key={lang} className="flex items-start gap-2">
            <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
            <input
              type="text"
              value={draft.copy[lang] || ''}
              onChange={(e) => setCopyLang(lang, e.target.value)}
              className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#7C5CFC]/60 min-h-[36px]"
              placeholder={`배너 문구 (${LANG_LABEL[lang]})`}
            />
          </div>
        ))}
      </div>

      {/* CTA 문구 (ctaText) */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-white/60 font-semibold">CTA 버튼 문구</p>
        {LANGS.map((lang) => (
          <div key={lang} className="flex items-start gap-2">
            <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
            <input
              type="text"
              value={draft.ctaText[lang] || ''}
              onChange={(e) => setCtaTextLang(lang, e.target.value)}
              className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#7C5CFC]/60 min-h-[36px]"
              placeholder={`CTA (${LANG_LABEL[lang]})`}
            />
          </div>
        ))}
      </div>

      {/* CTA 링크 + 마감일 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[11px] text-white/60 font-semibold">CTA 이동 경로</p>
          <input
            type="text"
            value={draft.ctaHref}
            onChange={(e) => setCtaHref(e.target.value)}
            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#7C5CFC]/60 min-h-[36px]"
            placeholder="/tours"
          />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-white/60 font-semibold">마감일 표시 <span className="text-white/35 font-normal">(예: 6/30, 비우면 선착순)</span></p>
          <input
            type="text"
            value={draft.endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#7C5CFC]/60 min-h-[36px]"
            placeholder="6/28"
          />
        </div>
      </div>

      {/* 저장 버튼 */}
      <div className="flex justify-end pt-1">
        <button
          onClick={save}
          disabled={saving || !isDirty}
          className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all min-h-[36px] disabled:opacity-40 ${
            isDirty
              ? 'bg-[#7C5CFC]/30 border border-[#7C5CFC]/60 text-white hover:bg-[#7C5CFC]/45'
              : 'bg-white/[0.04] border border-white/[0.08] text-white/40'
          }`}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
