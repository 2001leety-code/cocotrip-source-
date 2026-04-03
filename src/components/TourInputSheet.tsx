import { useState, useRef, useEffect } from 'react';

// ============================================================
// TourInputSheet
// Purpose: + button that opens a bottom sheet with checkbox-based
//          tour preferences. Outputs structured JSON for Gemini API.
// Stack: React + inline styles (no Tailwind dependency)
// Output: onSubmit(selections: TourSelections) => void
// ============================================================

const AREAS = [
  { id: 'seoul_city', label: 'Seoul City', labelKr: '서울시내', icon: '🏙' },
  { id: 'seoul_day', label: 'Seoul Day Trip', labelKr: '서울근교', icon: '🚐' },
  { id: 'provincial', label: 'Provincial', labelKr: '지방 (부산/경주/강릉)', icon: '🗻' },
];

const THEMES = [
  { id: 'kpop',     label: 'K-POP / Hallyu', color: '#b794e6' },
  { id: 'culture',  label: 'History & Culture', color: '#6bc98a' },
  { id: 'food',     label: 'Food & Cafe', color: '#e8a060' },
  { id: 'nature',   label: 'Nature & Scenic', color: '#60b8e8' },
  { id: 'shopping', label: 'Shopping', color: '#e87090' },
  { id: 'nightlife',label: 'Nightlife', color: '#c9a0e8' },
];

const VEHICLES = [
  { id: 'staria',   label: 'Staria Van',    desc: '1-8 passengers', price: '₩330,000/8hr' },
  { id: 'sprinter', label: 'Sprinter Mid',  desc: '9-15 passengers', price: 'Quote' },
  { id: 'bus',      label: 'Large Bus',     desc: '16+ passengers', price: 'Quote' },
];

const DURATIONS = [
  { id: 'half',  label: 'Half Day', hours: 4 },
  { id: 'full',  label: 'Full Day', hours: 8 },
  { id: 'multi', label: '2+ Days',  hours: null },
];

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
}

export function TourInputSheet({ onSubmit }: TourInputSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [area, setArea] = useState<string | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('staria');
  const [duration, setDuration] = useState('full');
  const [pax, setPax] = useState(4);
  const [days, setDays] = useState(1);
  const [note, setNote] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
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
        title="Tour Preferences"
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
            position: 'absolute',
            bottom: '48px',
            left: 0,
            width: '340px',
            maxHeight: '500px',
            overflowY: 'auto',
            borderRadius: '16px',
            background: '#12121a',
            border: '1px solid rgba(124,92,252,0.3)',
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
            zIndex: 20,
            animation: 'slideUp 0.25s ease-out',
          }}
        >
          <style>{`
            @keyframes slideUp {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Area */}
            <div>
              <div style={sectionTitle}>Tour Area</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {AREAS.map(a => (
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
                    <div style={{ fontSize: '9px', color: '#4a4a5e', marginTop: '2px' }}>{a.labelKr}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Themes */}
            <div>
              <div style={sectionTitle}>Tour Themes <span style={{ color: '#4a4a5e', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>(select multiple)</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {THEMES.map(t => {
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
              <div style={sectionTitle}>Vehicle</div>
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
                        <div style={{ fontSize: '9px', color: '#4a4a5e' }}>{v.desc}</div>
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
                <div style={sectionTitle}>Duration</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {DURATIONS.map(d => (
                    <button key={d.id} onClick={() => setDuration(d.id)}
                      style={{
                        flex: 1, padding: '7px 4px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                        background: duration === d.id ? '#1e1035' : '#16161f',
                        outline: `1px solid ${duration === d.id ? '#8b6cc7' : '#1e1e2e'}`,
                        color: duration === d.id ? '#b794e6' : '#6b6b80',
                        transition: 'all 0.15s',
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ width: '72px' }}>
                <div style={sectionTitle}>Pax</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => setPax(Math.max(1, pax - 1))}
                    style={{ width: '26px', height: '26px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#16161f', outline: '1px solid #1e1e2e', color: '#6b6b80', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <div style={{ width: '24px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#e0e0e8' }}>{pax}</div>
                  <button onClick={() => setPax(Math.min(45, pax + 1))}
                    style={{ width: '26px', height: '26px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#16161f', outline: '1px solid #1e1e2e', color: '#6b6b80', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
              </div>
            </div>

            {/* Multi-day count */}
            {duration === 'multi' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: '#6b6b80' }}>Number of days:</span>
                <input type="number" min={2} max={14} value={days}
                  onChange={e => setDays(Number(e.target.value))}
                  style={{ width: '52px', padding: '5px 8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textAlign: 'center', color: '#e0e0e8', background: '#16161f', border: '1px solid #1e1e2e', outline: 'none' }}
                />
              </div>
            )}

            {/* Special Request */}
            <div>
              <div style={sectionTitle}>Special Request <span style={{ color: '#4a4a5e', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>(optional)</span></div>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. wheelchair accessible, BTS spots, halal food..."
                maxLength={100}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', fontSize: '11px', color: '#a0a0b0', background: '#16161f', border: '1px solid #1e1e2e', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Prompt token preview */}
            {promptPreview && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', background: '#0a0a0f', border: '1px solid #1e1e2e' }}>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '2px', color: '#4a4a5e', fontWeight: 700, marginBottom: '3px' }}>Gemini Input Preview</div>
                <div style={{ fontSize: '10px', color: '#6b6b80', fontFamily: 'monospace', wordBreak: 'break-all' }}>{promptPreview}</div>
                <div style={{ fontSize: '9px', color: '#3a3a4e', marginTop: '3px' }}>~{Math.round(promptPreview.split(' ').length * 1.3)} tokens estimated</div>
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
              {canSubmit ? 'Generate Tour Plan →' : 'Select area & theme to continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '2px',
  color: '#8b6cc7',
  marginBottom: '8px',
};
