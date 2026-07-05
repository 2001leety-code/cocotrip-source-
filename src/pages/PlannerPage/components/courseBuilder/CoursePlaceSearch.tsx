/**
 * CoursePlaceSearch — 코스 입력용 경량 장소 자동완성 (2026-07-05).
 *
 * /api/place-search 를 직접 호출해 후보를 드롭다운으로 보여주고, 선택 시 좌표(lat/lng)와
 * 도로명주소를 콜백으로 넘긴다 → CourseBuilderShell 이 addStop 에 좌표까지 저장(지도 동선 가능).
 * 자유입력(좌표 없이 이름만)도 유지 — Enter/직접추가로 넘어가 예약/작성 막힘 방지.
 * (무드 MoodAiBooking·차터 AddressAutocomplete 와 동일한 place-search 계약을 재사용.)
 */
import { useCallback, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

export interface CoursePlacePick {
  title: string;
  lat?: number;
  lng?: number;
  address?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onPick: (p: CoursePlacePick) => void;
  onEnterFreeText: () => void; // 좌표 없이 현재 입력값으로 추가 (자유입력)
  placeholder: string;
  searchLabel: string;
  lang: string;
  inputClassName: string;
}

interface Hit { name: string; address: string; lat: number; lng: number; }

export function CoursePlaceSearch({
  value, onChange, onPick, onEnterFreeText, placeholder, searchLabel, lang, inputClassName,
}: Props) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const runSearch = useCallback(async () => {
    const q = value.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    setBusy(true);
    setHits(null);
    try {
      const res = await fetch(`/api/place-search?query=${encodeURIComponent(q)}&limit=5&lang=${encodeURIComponent(lang)}`);
      const json = await res.json().catch(() => ({}));
      if (my !== seq.current) return; // 최신 검색만 반영
      const items: Hit[] = (Array.isArray(json?.items) ? json.items : [])
        .filter((it: { lat?: number; lng?: number }) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)))
        .slice(0, 5)
        .map((it: { name?: string; roadAddress?: string; address?: string; lat: number; lng: number }) => ({
          name: String(it.name || ''), address: String(it.roadAddress || it.address || ''),
          lat: Number(it.lat), lng: Number(it.lng),
        }));
      setHits(items);
    } catch {
      setHits([]);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [value, lang]);

  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); if (hits) setHits(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (value.trim().length >= 2) void runSearch();
            }
          }}
          placeholder={placeholder}
          className={`flex-1 min-w-0 ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={busy || value.trim().length < 2}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 sm:rounded-xl"
          style={{ background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.5)' }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {searchLabel}
        </button>
      </div>

      {hits !== null && (
        <div
          className="mt-1 flex flex-col gap-0.5 rounded-lg border border-white/10 p-1"
          style={{ background: 'rgba(12,8,24,0.98)' }}
        >
          {hits.length === 0 ? (
            <button
              type="button"
              onClick={() => { onEnterFreeText(); setHits(null); }}
              className="rounded-md px-2 py-1.5 text-left text-[11px] text-white/60 hover:bg-white/[0.06]"
            >
              {`"${value.trim()}"`} — {placeholder.includes('주소') ? '그대로 추가 (좌표 없음)' : 'add as-is (no map pin)'}
            </button>
          ) : (
            hits.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onPick({ title: h.name, lat: h.lat, lng: h.lng, address: h.address }); setHits(null); }}
                className="rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-white/[0.06]"
              >
                <span className="font-bold text-white">{h.name}</span>
                {h.address && <span className="ml-1.5 text-white/45">{h.address}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
