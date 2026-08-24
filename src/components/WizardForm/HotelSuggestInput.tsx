// HotelSuggestInput — 호텔/숙소 입력 보조: 자유입력 유지 + Naver 검색 제안 드롭다운.
// ⚠️ 차터 AddressAutocomplete 와 달리 "선택 강제 X" — Naver 검색에 없는 소형 숙소·
//    에어비앤비도 타이핑한 그대로 유효(예약 막힘 방지). 제안은 정확한 한글명 입력 보조용.
// state 는 문자열(hotelAddress) 그대로 유지 → resume·5-step 호환.
import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface PlaceItem {
  name?: string;
  title?: string;
  address?: string;
  roadAddress?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  lang?: 'ko' | 'en' | 'ja' | 'zh';
  /** Optional — connects a visible <label htmlFor> to the inner input. Callers
   *  that don't pass it keep the previous unlabelled behavior (backward compat). */
  id?: string;
}

export function HotelSuggestInput({ value, onChange, placeholder, className, lang = 'en', id }: Props) {
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (v: string) => {
    if (debRef.current) clearTimeout(debRef.current);
    if (v.trim().length < 2) { setItems([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // 한글 입력이면 ko(한글 결과 — geocode 성공률↑), 아니면 사용자 언어.
        const qLang = /[가-힣]/.test(v) ? 'ko' : lang;
        const r = await fetch(`/api/place-search?query=${encodeURIComponent(v.trim())}&limit=6&lang=${qLang}`);
        const data = await r.json();
        const list: PlaceItem[] = Array.isArray(data?.items) ? data.items.slice(0, 6) : [];
        setItems(list);
        setOpen(list.length > 0);
      } catch {
        setItems([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 400);
  };

  const handleInput = (v: string) => {
    onChange(v); // 자유입력은 항상 유효 — 선택 강제하지 않음
    runSearch(v);
  };

  const pick = (it: PlaceItem) => {
    onChange(it.name || it.title || it.roadAddress || it.address || '');
    setOpen(false);
    setItems([]);
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (items.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-ec-ink-3 pointer-events-none" />
      )}
      {open && items.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay overflow-hidden max-h-64 overflow-y-auto">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              className="w-full min-h-[44px] text-left px-4 py-2.5 hover:bg-ec-sunken border-b border-ec-line last:border-0"
            >
              <div className="text-sm text-ec-ink-2">{it.name || it.title}</div>
              {(it.roadAddress || it.address) && (
                <div className="text-[11px] text-ec-ink-3 mt-0.5">{it.roadAddress || it.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
