// PromoBannerPanel — 프로모 배너 + 팝업 어드민 설정 패널 (2026-06-07).
// /api/admin-promo-config (GET → {banner,popup}, POST {target,config} 저장).
// 배포 없이 배너 문구/CTA/마감일/켜끄기 + 팝업 제목/내용/이미지/CTA/빈도/켜끄기.
// RuntimeFlagsPanel 패턴 동일.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface BannerConfig {
  enabled: boolean;
  copy: Record<string, string>;
  ctaText: Record<string, string>;
  ctaHref: string;
  endDate: string;
}

interface PopupConfig {
  enabled: boolean;
  title: Record<string, string>;
  body: Record<string, string>;
  imageUrl: string;
  ctaText: Record<string, string>;
  ctaHref: string;
  frequency: 'once' | 'daily' | 'every_visit';
}

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
type Lang = typeof LANGS[number];

const LANG_LABEL: Record<Lang, string> = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文' };

const FREQ_LABEL: Record<PopupConfig['frequency'], string> = {
  once: '한 번만 (영구)',
  daily: '하루 1회',
  every_visit: '매 방문',
};

// ─── 입력 공통 클래스 ──────────────────────────────────────────────────────────
const inputCls = 'flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#7C5CFC]/60 min-h-[36px]';
const inputFullCls = `w-full ${inputCls}`;

export function PromoBannerPanel() {
  const { user } = useAuth();

  // ── 배너 상태 ──
  const [banner, setBanner] = useState<BannerConfig | null>(null);
  const [bannerDraft, setBannerDraft] = useState<BannerConfig | null>(null);
  const [bannerSaving, setBannerSaving] = useState(false);

  // ── 팝업 상태 ──
  const [popup, setPopup] = useState<PopupConfig | null>(null);
  const [popupDraft, setPopupDraft] = useState<PopupConfig | null>(null);
  const [popupSaving, setPopupSaving] = useState(false);

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-promo-config', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.ok) {
        // 신 구조: { banner, popup }
        if (json.banner) { setBanner(json.banner); setBannerDraft(structuredClone(json.banner)); }
        if (json.popup)  { setPopup(json.popup);   setPopupDraft(structuredClone(json.popup)); }
      }
    } catch { /* 무시 */ } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  // ── 배너 저장 ──
  const saveBanner = async () => {
    if (!user || !bannerDraft) return;
    setBannerSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-promo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target: 'banner', config: bannerDraft }),
      });
      const json = await res.json();
      if (json.ok && json.banner) {
        setBanner(json.banner);
        setBannerDraft(structuredClone(json.banner));
        toast.success('배너 설정 저장 완료 (~60초 후 반영)');
      } else {
        toast.error(json.error || '저장 실패');
      }
    } catch { toast.error('네트워크 오류'); } finally { setBannerSaving(false); }
  };

  // ── 팝업 저장 ──
  const savePopup = async () => {
    if (!user || !popupDraft) return;
    setPopupSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-promo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target: 'popup', config: popupDraft }),
      });
      const json = await res.json();
      if (json.ok && json.popup) {
        setPopup(json.popup);
        setPopupDraft(structuredClone(json.popup));
        toast.success('팝업 설정 저장 완료 (~60초 후 반영)');
      } else {
        toast.error(json.error || '저장 실패');
      }
    } catch { toast.error('네트워크 오류'); } finally { setPopupSaving(false); }
  };

  if (loading || !bannerDraft || !popupDraft) return null;

  const bannerDirty = JSON.stringify(bannerDraft) !== JSON.stringify(banner);
  const popupDirty  = JSON.stringify(popupDraft)  !== JSON.stringify(popup);

  // ── 배너 setter ──
  const setBannerEnabled  = (val: boolean) => setBannerDraft((d) => d ? { ...d, enabled: val } : d);
  const setBannerCopyLang = (lang: Lang, val: string) => setBannerDraft((d) => d ? { ...d, copy: { ...d.copy, [lang]: val } } : d);
  const setBannerCtaLang  = (lang: Lang, val: string) => setBannerDraft((d) => d ? { ...d, ctaText: { ...d.ctaText, [lang]: val } } : d);
  const setBannerCtaHref  = (val: string) => setBannerDraft((d) => d ? { ...d, ctaHref: val } : d);
  const setBannerEndDate  = (val: string) => setBannerDraft((d) => d ? { ...d, endDate: val } : d);

  // ── 팝업 setter ──
  const setPopupEnabled    = (val: boolean) => setPopupDraft((d) => d ? { ...d, enabled: val } : d);
  const setPopupTitleLang  = (lang: Lang, val: string) => setPopupDraft((d) => d ? { ...d, title: { ...d.title, [lang]: val } } : d);
  const setPopupBodyLang   = (lang: Lang, val: string) => setPopupDraft((d) => d ? { ...d, body: { ...d.body, [lang]: val } } : d);
  const setPopupImageUrl   = (val: string) => setPopupDraft((d) => d ? { ...d, imageUrl: val } : d);
  const setPopupCtaLang    = (lang: Lang, val: string) => setPopupDraft((d) => d ? { ...d, ctaText: { ...d.ctaText, [lang]: val } } : d);
  const setPopupCtaHref    = (val: string) => setPopupDraft((d) => d ? { ...d, ctaHref: val } : d);
  const setPopupFrequency  = (val: PopupConfig['frequency']) => setPopupDraft((d) => d ? { ...d, frequency: val } : d);

  const toggleBtn = (on: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all min-h-[36px] ${
        on
          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
          : 'bg-white/[0.04] border-white/[0.12] text-white/55 hover:border-white/25'
      }`}
    >
      {label}
    </button>
  );

  const saveBtn = (saving: boolean, dirty: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={saving || !dirty}
      className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all min-h-[36px] disabled:opacity-40 ${
        dirty
          ? 'bg-[#7C5CFC]/30 border border-[#7C5CFC]/60 text-white hover:bg-[#7C5CFC]/45'
          : 'bg-white/[0.04] border border-white/[0.08] text-white/40'
      }`}
    >
      {saving ? '저장 중...' : '저장'}
    </button>
  );

  return (
    <div className="space-y-3">

      {/* ── 배너 패널 ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.06] px-3 sm:px-4 py-3 space-y-3">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[12px] font-bold text-white/85 flex items-center gap-1.5 flex-wrap">
            📣 프로모 배너 설정
            <span className="text-[10px] font-normal text-white/45">저장 후 ~60초 반영</span>
          </p>
          {toggleBtn(bannerDraft.enabled, bannerDraft.enabled ? '✓ 배너 켜짐' : '배너 꺼짐', () => setBannerEnabled(!bannerDraft.enabled))}
        </div>

        {/* 배너 문구 (copy) */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/60 font-semibold">배너 문구</p>
          {LANGS.map((lang) => (
            <div key={lang} className="flex items-start gap-2">
              <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
              <input type="text" value={bannerDraft.copy[lang] || ''} onChange={(e) => setBannerCopyLang(lang, e.target.value)}
                className={inputCls} placeholder={`배너 문구 (${LANG_LABEL[lang]})`} />
            </div>
          ))}
        </div>

        {/* CTA 문구 */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/60 font-semibold">CTA 버튼 문구</p>
          {LANGS.map((lang) => (
            <div key={lang} className="flex items-start gap-2">
              <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
              <input type="text" value={bannerDraft.ctaText[lang] || ''} onChange={(e) => setBannerCtaLang(lang, e.target.value)}
                className={inputCls} placeholder={`CTA (${LANG_LABEL[lang]})`} />
            </div>
          ))}
        </div>

        {/* CTA 링크 + 마감일 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-[11px] text-white/60 font-semibold">CTA 이동 경로</p>
            <input type="text" value={bannerDraft.ctaHref} onChange={(e) => setBannerCtaHref(e.target.value)}
              className={inputFullCls} placeholder="/tours" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-white/60 font-semibold">마감일 표시 <span className="text-white/35 font-normal">(예: 6/30, 비우면 긴급성 문구 없음)</span></p>
            <input type="text" value={bannerDraft.endDate} onChange={(e) => setBannerEndDate(e.target.value)}
              className={inputFullCls} placeholder="6/28" />
          </div>
        </div>

        <div className="flex justify-end pt-1">{saveBtn(bannerSaving, bannerDirty, saveBanner)}</div>
      </div>

      {/* ── 팝업 패널 ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#EA537E]/25 bg-[#EA537E]/[0.04] px-3 sm:px-4 py-3 space-y-3">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[12px] font-bold text-white/85 flex items-center gap-1.5 flex-wrap">
            🪄 프로모 팝업 설정
            <span className="text-[10px] font-normal text-white/45">저장 후 ~60초 반영 · 기본 OFF</span>
          </p>
          {toggleBtn(popupDraft.enabled, popupDraft.enabled ? '✓ 팝업 켜짐' : '팝업 꺼짐', () => setPopupEnabled(!popupDraft.enabled))}
        </div>

        {/* 팝업 제목 (title) */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/60 font-semibold">팝업 제목</p>
          {LANGS.map((lang) => (
            <div key={lang} className="flex items-start gap-2">
              <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
              <input type="text" value={popupDraft.title[lang] || ''} onChange={(e) => setPopupTitleLang(lang, e.target.value)}
                className={inputCls} placeholder={`제목 (${LANG_LABEL[lang]})`} />
            </div>
          ))}
        </div>

        {/* 팝업 내용 (body) */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/60 font-semibold">팝업 내용</p>
          {LANGS.map((lang) => (
            <div key={lang} className="flex items-start gap-2">
              <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
              <textarea value={popupDraft.body[lang] || ''} onChange={(e) => setPopupBodyLang(lang, e.target.value)}
                rows={2}
                className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-[#EA537E]/60 resize-none"
                placeholder={`내용 (${LANG_LABEL[lang]})`} />
            </div>
          ))}
        </div>

        {/* 이미지 URL */}
        <div className="space-y-1">
          <p className="text-[11px] text-white/60 font-semibold">이미지 URL <span className="text-white/35 font-normal">(선택, 비우면 이미지 없음)</span></p>
          <input type="url" value={popupDraft.imageUrl} onChange={(e) => setPopupImageUrl(e.target.value)}
            className={inputFullCls} placeholder="https://..." />
        </div>

        {/* CTA 문구 */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/60 font-semibold">CTA 버튼 문구</p>
          {LANGS.map((lang) => (
            <div key={lang} className="flex items-start gap-2">
              <span className="text-[10px] text-white/40 w-14 shrink-0 pt-1.5">{LANG_LABEL[lang]}</span>
              <input type="text" value={popupDraft.ctaText[lang] || ''} onChange={(e) => setPopupCtaLang(lang, e.target.value)}
                className={inputCls} placeholder={`CTA (${LANG_LABEL[lang]})`} />
            </div>
          ))}
        </div>

        {/* CTA 링크 + 빈도 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-[11px] text-white/60 font-semibold">CTA 이동 경로</p>
            <input type="text" value={popupDraft.ctaHref} onChange={(e) => setPopupCtaHref(e.target.value)}
              className={inputFullCls} placeholder="/tours" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-white/60 font-semibold">노출 빈도</p>
            <select
              value={popupDraft.frequency}
              onChange={(e) => setPopupFrequency(e.target.value as PopupConfig['frequency'])}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#EA537E]/60 min-h-[36px]"
            >
              {(['once', 'daily', 'every_visit'] as const).map((f) => (
                <option key={f} value={f} className="bg-[#0d0a1a]">{FREQ_LABEL[f]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-1">{saveBtn(popupSaving, popupDirty, savePopup)}</div>
      </div>

    </div>
  );
}
