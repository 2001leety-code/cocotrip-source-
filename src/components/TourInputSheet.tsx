import { useState, useRef, useEffect } from 'react';
import type { Language } from '@/i18n';

// ============================================================
// TourInputSheet — 4개국어 체크박스 투어 선택 패널
// ============================================================

type L = Language; // shorthand

const AREAS: Record<L, { id: string; label: string; sub: string }[]> = {
  en: [
    { id: 'seoul_city', label: 'Seoul City', sub: '서울시내' },
    { id: 'seoul_day', label: 'Seoul Day Trip', sub: '서울근교' },
    { id: 'provincial', label: 'Provincial', sub: 'Busan/Gyeongju' },
  ],
  ko: [
    { id: 'seoul_city', label: '서울 시내', sub: 'Seoul City' },
    { id: 'seoul_day', label: '서울 근교', sub: 'Day Trip' },
    { id: 'provincial', label: '지방', sub: '부산/경주/강릉' },
  ],
  ja: [
    { id: 'seoul_city', label: 'ソウル市内', sub: 'Seoul City' },
    { id: 'seoul_day', label: 'ソウル近郊', sub: 'Day Trip' },
    { id: 'provincial', label: '地方', sub: '釜山/慶州' },
  ],
  zh: [
    { id: 'seoul_city', label: '首尔市区', sub: 'Seoul City' },
    { id: 'seoul_day', label: '首尔近郊', sub: 'Day Trip' },
    { id: 'provincial', label: '地方', sub: '釜山/庆州' },
  ],
};

const THEMES: Record<L, { id: string; label: string; color: string }[]> = {
  en: [
    { id: 'kpop', label: 'K-POP / Hallyu', color: '#b794e6' },
    { id: 'culture', label: 'History & Culture', color: '#6bc98a' },
    { id: 'food', label: 'Food & Cafe', color: '#e8a060' },
    { id: 'nature', label: 'Nature & Scenic', color: '#60b8e8' },
    { id: 'shopping', label: 'Shopping', color: '#e87090' },
    { id: 'nightlife', label: 'Nightlife', color: '#c9a0e8' },
  ],
  ko: [
    { id: 'kpop', label: 'K-POP / 한류', color: '#b794e6' },
    { id: 'culture', label: '역사 / 문화', color: '#6bc98a' },
    { id: 'food', label: '맛집 / 카페', color: '#e8a060' },
    { id: 'nature', label: '자연 / 힐링', color: '#60b8e8' },
    { id: 'shopping', label: '쇼핑', color: '#e87090' },
    { id: 'nightlife', label: '나이트라이프', color: '#c9a0e8' },
  ],
  ja: [
    { id: 'kpop', label: 'K-POP / 韓流', color: '#b794e6' },
    { id: 'culture', label: '歴史 / 文化', color: '#6bc98a' },
    { id: 'food', label: 'グルメ / カフェ', color: '#e8a060' },
    { id: 'nature', label: '自然 / 癒し', color: '#60b8e8' },
    { id: 'shopping', label: 'ショッピング', color: '#e87090' },
    { id: 'nightlife', label: 'ナイトライフ', color: '#c9a0e8' },
  ],
  zh: [
    { id: 'kpop', label: 'K-POP / 韩流', color: '#b794e6' },
    { id: 'culture', label: '历史 / 文化', color: '#6bc98a' },
    { id: 'food', label: '美食 / 咖啡', color: '#e8a060' },
    { id: 'nature', label: '自然 / 治愈', color: '#60b8e8' },
    { id: 'shopping', label: '购物', color: '#e87090' },
    { id: 'nightlife', label: '夜生活', color: '#c9a0e8' },
  ],
};

const VEHICLES = [
  { id: 'staria', label: 'Staria Van', desc: '1-8', price: '₩330,000/8hr' },
  { id: 'sprinter', label: 'Sprinter Mid', desc: '9-15', price: 'Quote' },
  { id: 'bus', label: 'Large Bus', desc: '16+', price: 'Quote' },
];

const DURATIONS: Record<L, { id: string; label: string }[]> = {
  en: [{ id: 'half', label: 'Half Day' }, { id: 'full', label: 'Full Day' }, { id: 'multi', label: '2+ Days' }],
  ko: [{ id: 'half', label: '반나절' }, { id: 'full', label: '종일' }, { id: 'multi', label: '2일+' }],
  ja: [{ id: 'half', label: '半日' }, { id: 'full', label: '終日' }, { id: 'multi', label: '2日以上' }],
  zh: [{ id: 'half', label: '半天' }, { id: 'full', label: '全天' }, { id: 'multi', label: '2天以上' }],
};

const UI_TEXT: Record<L, {
  area: string; themes: string; themeSub: string; vehicle: string;
  vehiclePassengers: string; duration: string; pax: string;
  request: string; requestOpt: string; requestPlaceholder: string;
  preview: string; tokens: string; submit: string; submitDisabled: string;
  multiDays: string;
}> = {
  en: {
    area: 'Tour Area', themes: 'Tour Themes', themeSub: '(select multiple)', vehicle: 'Vehicle',
    vehiclePassengers: 'passengers', duration: 'Duration', pax: 'Pax',
    request: 'Special Request', requestOpt: '(optional)',
    requestPlaceholder: 'e.g. wheelchair accessible, BTS spots, halal food...',
    preview: 'Gemini Input Preview', tokens: 'tokens estimated',
    submit: 'Generate Tour Plan →', submitDisabled: 'Select area & theme to continue',
    multiDays: 'Number of days:',
  },
  ko: {
    area: '투어 지역', themes: '관광 테마', themeSub: '(복수 선택 가능)', vehicle: '차량',
    vehiclePassengers: '명', duration: '일정', pax: '인원',
    request: '특별 요청', requestOpt: '(선택사항)',
    requestPlaceholder: '예: 휠체어, BTS 명소, 할랄 음식...',
    preview: 'AI 입력 미리보기', tokens: '토큰 예상',
    submit: '투어 플랜 생성 →', submitDisabled: '지역과 테마를 선택해주세요',
    multiDays: '일정 일수:',
  },
  ja: {
    area: 'ツアーエリア', themes: 'ツアーテーマ', themeSub: '(複数選択可)', vehicle: '車両',
    vehiclePassengers: '名', duration: '日程', pax: '人数',
    request: '特別リクエスト', requestOpt: '(任意)',
    requestPlaceholder: '例: 車椅子対応、BTS聖地、ハラール...',
    preview: 'AI入力プレビュー', tokens: 'トークン推定',
    submit: 'ツアープラン作成 →', submitDisabled: 'エリアとテーマを選択してください',
    multiDays: '日数:',
  },
  zh: {
    area: '旅游区域', themes: '旅游主题', themeSub: '(可多选)', vehicle: '车辆',
    vehiclePassengers: '人', duration: '行程', pax: '人数',
    request: '特殊要求', requestOpt: '(可选)',
    requestPlaceholder: '例: 轮椅出行、BTS圣地、清真食品...',
    preview: 'AI输入预览', tokens: '预估Token',
    submit: '生成旅游计划 →', submitDisabled: '请选择区域和主题',
    multiDays: '天数:',
  },
};

interface TourSelections {
  area: string;
  themes: string[];
  vehicle: string;
  duration: string;
  pax: number;
  days: number;
  note: string | null;
}

interface TourInputSheetProps {
  onSubmit: (selections: TourSelections) => void;
  language?: Language;
}

export function TourInputSheet({ onSubmit, language = 'en' }: TourInputSheetProps) {
  const lang = language;
  const txt = UI_TEXT[lang];
  const areas = AREAS[lang];
  const themes_list = THEMES[lang];
  const durations = DURATIONS[lang];

  const [isOpen, setIsOpen] = useState(false);
  const [area, setArea] = useState<string | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('staria');
  const [duration, setDuration] = useState('full');
  const [pax, setPax] = useState(4);
  const [days, setDays] = useState(1);
  const [note, setNote] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleTheme = (id: string) => {
    setThemes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleSubmit = () => {
    if (!area || themes.length === 0) return;
    onSubmit({
      area,
      themes,
      vehicle,
      duration,
      pax,
      days: duration === 'multi' ? days : 1,
      note: note.trim() || null,
    });
    setIsOpen(false);
  };

  const promptPreview = area && themes.length > 0
    ? `Plan: ${duration === 'multi' ? days : 1}d ${area} tour. Themes: ${themes.join(',')}. Pax: ${pax}. Vehicle: ${vehicle}.${note ? ' Note: ' + note : ''}`
    : null;

  const canSubmit = !!area && themes.length > 0;

  return (
    <div ref={sheetRef} style={{ position: 'relative' }}>
      {/* + Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={txt.area}
        style={{
          width: '36px', height: '36px', borderRadius: '50%',
          flexShrink: 0, cursor: 'pointer',
          background: isOpen ? 'linear-gradient(135deg, #8b6cc7, #6b4ca7)' : 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(124,92,252,0.4)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          transition: 'all 0.2s',
          boxShadow: isOpen ? '0 0 12px rgba(139,108,199,0.4)' : 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {/* Bottom Sheet */}
      {isOpen && (
        <div
          style={{
            position: 'absolute', bottom: '48px', left: 0, width: '340px',
            maxHeight: '500px', overflowY: 'auto', borderRadius: '16px',
            background: '#12121a', border: '1px solid rgba(124,92,252,0.3)',
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)', zIndex: 20,
            animation: 'slideUp 0.25s ease-out',
          }}
        >
          <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Area */}
            <div>
              <div style={sectionTitle}>{txt.area}</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {areas.map(a => (
                  <button key={a.id} onClick={() => setArea(a.id)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: '10px', border: 'none',
                      cursor: 'pointer', textAlign: 'center',
                      background: area === a.id ? '#1e1035' : '#16161f',
                      outline: `1px solid ${area === a.id ? '#8b6cc7' : '#1e1e2e'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 600, color: area === a.id ? '#b794e6' : '#6b6b80' }}>{a.label}</div>
                    <div style={{ fontSize: '9px', color: '#4a4a5e', marginTop: '2px' }}>{a.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Themes */}
            <div>
              <div style={sectionTitle}>{txt.themes} <span style={{ color: '#4a4a5e', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>{txt.themeSub}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {themes_list.map(t => {
                  const selected = themes.includes(t.id);
                  return (
                    <button key={t.id} onClick={() => toggleTheme(t.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 10px', borderRadius: '10px', border: 'none',
                        cursor: 'pointer',
                        background: selected ? '#16161f' : '#12121a',
                        outline: `1px solid ${selected ? t.color + '60' : '#1e1e2e'}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{
                        width: '14px', height: '14px', borderRadius: '4px', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: selected ? t.color : 'transparent',
                        outline: `1.5px solid ${selected ? t.color : '#3a3a4e'}`,
                        transition: 'all 0.15s',
                      }}>
                        {selected && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 500, color: selected ? t.color : '#6b6b80' }}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vehicle */}
            <div>
              <div style={sectionTitle}>{txt.vehicle}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {VEHICLES.map(v => (
                  <button key={v.id} onClick={() => setVehicle(v.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                      background: vehicle === v.id ? '#1e1035' : '#16161f',
                      outline: `1px solid ${vehicle === v.id ? '#8b6cc7' : '#1e1e2e'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '13px', height: '13px', borderRadius: '50%',
                        border: `2px solid ${vehicle === v.id ? '#8b6cc7' : '#3a3a4e'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {vehicle === v.id && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#8b6cc7' }}/>}
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: vehicle === v.id ? '#e0e0e8' : '#6b6b80' }}>{v.label}</div>
                        <div style={{ fontSize: '9px', color: '#4a4a5e' }}>{v.desc} {txt.vehiclePassengers}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: vehicle === v.id ? '#b794e6' : '#4a4a5e' }}>{v.price}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration + Pax */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={sectionTitle}>{txt.duration}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {durations.map(d => (
                    <button key={d.id} onClick={() => setDuration(d.id)}
                      style={{
                        flex: 1, padding: '7px 4px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                        background: duration === d.id ? '#1e1035' : '#16161f',
                        outline: `1px solid ${duration === d.id ? '#8b6cc7' : '#1e1e2e'}`,
                        color: duration === d.id ? '#b794e6' : '#6b6b80',
                        transition: 'all 0.15s',
                      }}
                    >{d.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ width: '72px' }}>
                <div style={sectionTitle}>{txt.pax}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => setPax(Math.max(1, pax - 1))}
                    style={{ width: '26px', height: '26px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#16161f', outline: '1px solid #1e1e2e', color: '#6b6b80', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <div style={{ width: '24px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#e0e0e8' }}>{pax}</div>
                  <button onClick={() => setPax(Math.min(45, pax + 1))}
                    style={{ width: '26px', height: '26px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#16161f', outline: '1px solid #1e1e2e', color: '#6b6b80', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
              </div>
            </div>

            {/* Multi-day */}
            {duration === 'multi' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: '#6b6b80' }}>{txt.multiDays}</span>
                <input type="number" min={2} max={14} value={days}
                  onChange={e => setDays(Number(e.target.value))}
                  style={{ width: '52px', padding: '5px 8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textAlign: 'center', color: '#e0e0e8', background: '#16161f', border: '1px solid #1e1e2e', outline: 'none' }}
                />
              </div>
            )}

            {/* Special Request */}
            <div>
              <div style={sectionTitle}>{txt.request} <span style={{ color: '#4a4a5e', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>{txt.requestOpt}</span></div>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder={txt.requestPlaceholder}
                maxLength={100}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', fontSize: '11px', color: '#a0a0b0', background: '#16161f', border: '1px solid #1e1e2e', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Prompt preview */}
            {promptPreview && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', background: '#0a0a0f', border: '1px solid #1e1e2e' }}>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '2px', color: '#4a4a5e', fontWeight: 700, marginBottom: '3px' }}>{txt.preview}</div>
                <div style={{ fontSize: '10px', color: '#6b6b80', fontFamily: 'monospace', wordBreak: 'break-all' }}>{promptPreview}</div>
                <div style={{ fontSize: '9px', color: '#3a3a4e', marginTop: '3px' }}>~{Math.round(promptPreview.split(' ').length * 1.3)} {txt.tokens}</div>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: '100%', padding: '11px', borderRadius: '12px', border: 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'linear-gradient(135deg, #8b6cc7, #6b4ca7)' : '#1e1e2e',
                color: canSubmit ? '#fff' : '#4a4a5e',
                fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px',
                transition: 'all 0.2s',
              }}
            >
              {canSubmit ? txt.submit : txt.submitDisabled}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '2px', color: '#8b6cc7', marginBottom: '8px',
};
