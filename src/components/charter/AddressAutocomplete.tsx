// AddressAutocomplete — Naver Local Search 기반 주소 자동완성 + 동적 미니 지도 미리보기.
// 차터 위저드 출발/도착 주소 입력에 사용. 자유 입력 폐기 — 자동완성 클릭한 결과만 허용.
//
// 흐름:
//   1. 사용자 타이핑 → 400ms debounce → /api/place-search?query=... 호출
//   2. 후보 5-10개 드롭다운 → 사용자 클릭
//   3. 미니 지도 카드 노출 (NaverMap SDK v3 동적 로드 + Marker 1개)
//   4. "맞음" → onChange({ name, address, lat, lng, category }) + 입력 read-only
//   5. "다시" → selected=null → 드롭다운 다시
//
// SDK 로드: 모듈 단위 싱글톤 — 첫 번째 인스턴스가 script 태그 inject + onload 대기.
// 동일 페이지에 출발/도착 두 인스턴스 = SDK 1회 로드.
//
// 환경변수: VITE_NAVER_MAP_CLIENT_ID (NaverCloudPlatform Maps ncpClientId).
// 미설정 시 — 미니 지도는 fallback 텍스트 카드로 노출, 자동완성 자체는 동작.

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Edit2, Loader2, X, Check } from 'lucide-react';

// ── Naver Maps SDK 타입 (전역) ────────────────────────────────────────────
declare global {
  interface Window {
    naver?: {
      maps: {
        Map: new (el: HTMLElement, options: Record<string, unknown>) => unknown;
        LatLng: new (lat: number, lng: number) => unknown;
        Marker: new (options: Record<string, unknown>) => unknown;
        Position: { TOP_RIGHT: number; TOP_LEFT: number; BOTTOM_RIGHT: number; BOTTOM_LEFT: number };
      };
    };
  }
}

// ── i18n (4-lang inline — 컴포넌트 단위 정적 텍스트만) ─────────────────────
type Lang = 'ko' | 'en' | 'ja' | 'zh';

const I18N: Record<Lang, {
  searching: string;
  noResults: string;
  confirmTitle: string;
  confirmYes: string;
  confirmNo: string;
  changeButton: string;
  errorMessage: string;
  mapUnavailable: string;
  selectedLabel: string;
}> = {
  ko: {
    searching: '검색 중...',
    noResults: '검색 결과 없음. 다시 입력해보세요.',
    confirmTitle: '이 주소가 맞나요?',
    confirmYes: '맞음',
    confirmNo: '다시 입력',
    changeButton: '변경',
    errorMessage: '검색 실패. 잠시 후 다시 시도하세요.',
    mapUnavailable: '미니 지도를 불러올 수 없습니다',
    selectedLabel: '선택됨',
  },
  en: {
    searching: 'Searching...',
    noResults: 'No results. Try different keywords.',
    confirmTitle: 'Is this the right address?',
    confirmYes: 'Yes',
    confirmNo: 'Re-enter',
    changeButton: 'Change',
    errorMessage: 'Search failed. Please try again.',
    mapUnavailable: 'Mini map unavailable',
    selectedLabel: 'Selected',
  },
  ja: {
    searching: '検索中...',
    noResults: '検索結果なし。別のキーワードをお試しください。',
    confirmTitle: 'この住所で正しいですか？',
    confirmYes: 'はい',
    confirmNo: '再入力',
    changeButton: '変更',
    errorMessage: '検索失敗。しばらくしてから再度お試しください。',
    mapUnavailable: 'ミニマップを読み込めません',
    selectedLabel: '選択済み',
  },
  zh: {
    searching: '搜索中...',
    noResults: '没有搜索结果。请尝试其他关键词。',
    confirmTitle: '这个地址对吗？',
    confirmYes: '是',
    confirmNo: '重新输入',
    changeButton: '更改',
    errorMessage: '搜索失败。请稍后再试。',
    mapUnavailable: '迷你地图无法加载',
    selectedLabel: '已选择',
  },
};

function asLang(s: string): Lang {
  if (s === 'ko' || s === 'en' || s === 'ja' || s === 'zh') return s;
  return 'en';
}

// ── Naver Maps SDK 동적 로드 (싱글톤) ─────────────────────────────────────
let sdkLoadPromise: Promise<boolean> | null = null;

function loadNaverMapsSdk(): Promise<boolean> {
  // SSR / 미설정 환경 가드
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.naver?.maps) return Promise.resolve(true);
  if (sdkLoadPromise) return sdkLoadPromise;

  const ncpClientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined;
  if (!ncpClientId) {
    console.warn('[AddressAutocomplete] VITE_NAVER_MAP_CLIENT_ID not set — mini map disabled');
    return Promise.resolve(false);
  }

  sdkLoadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${encodeURIComponent(ncpClientId)}`;
    script.onload = () => {
      if (window.naver?.maps) {
        resolve(true);
      } else {
        console.error('[AddressAutocomplete] SDK loaded but window.naver.maps undefined');
        resolve(false);
      }
    };
    script.onerror = (err) => {
      console.error('[AddressAutocomplete] SDK script load error:', err);
      sdkLoadPromise = null; // 다음 시도 가능하도록 reset
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

// ── 타입 ──────────────────────────────────────────────────────────────────
export interface AddressResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string;
}

export interface AddressAutocompleteProps {
  value?: AddressResult;          // 외부 confirmed value — 있으면 read-only로 노출
  onChange: (coord: AddressResult | null) => void;
  label: string;
  placeholder?: string;
  language: 'ko' | 'en' | 'ja' | 'zh';
  /** input id (라벨 a11y용) */
  id?: string;
  /** 비활성 모드 (ex. 출발지 미확정 시 도착지 비활성) */
  disabled?: boolean;
}

interface ApiItem {
  name: string;
  address: string;
  roadAddress: string;
  category: string;
  tel: string;
  lat: number;
  lng: number;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────
let mapInstanceCounter = 0;

export function AddressAutocomplete({
  value,
  onChange,
  label,
  placeholder,
  language,
  id,
  disabled = false,
}: AddressAutocompleteProps) {
  const lang = asLang(language);
  const t = I18N[lang];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApiItem | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mapEl, setMapEl] = useState<string>(() => `cocotrip-map-${++mapInstanceCounter}`);

  // 외부 value 변경 추적 — 부모가 reset 시키면 내부도 reset.
  useEffect(() => {
    if (!value) {
      // confirmed → 다시 풀기
      setSelected(null);
      setQuery('');
      setResults([]);
      setMapEl(`cocotrip-map-${++mapInstanceCounter}`);
    }
  }, [value]);

  // Debounced 검색.
  useEffect(() => {
    if (selected || value) return;
    if (!query || query.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/place-search?query=${encodeURIComponent(query.trim())}&limit=10`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.warn('[AddressAutocomplete] api error', res.status, txt);
          setError(t.errorMessage);
          setResults([]);
          setShowDropdown(true);
          return;
        }
        const data = await res.json();
        const items: ApiItem[] = Array.isArray(data?.items) ? data.items : [];
        setResults(items);
        setShowDropdown(true);
      } catch (e) {
        console.error('[AddressAutocomplete] fetch err:', e);
        setError(t.errorMessage);
        setResults([]);
        setShowDropdown(true);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [query, selected, value, t.errorMessage]);

  // ── 미니 지도 동적 임베드 (selected 변경 시) ─────────────────────────────
  const mapInstanceRef = useRef<unknown>(null);
  const markerInstanceRef = useRef<unknown>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (!selected) {
      setMapReady(false);
      setMapFailed(false);
      mapInstanceRef.current = null;
      markerInstanceRef.current = null;
      return;
    }

    let cancelled = false;
    setMapReady(false);
    setMapFailed(false);

    loadNaverMapsSdk().then((ok) => {
      if (cancelled) return;
      if (!ok || !window.naver?.maps) {
        setMapFailed(true);
        return;
      }
      const el = document.getElementById(mapEl);
      if (!el) {
        // 다음 frame 에서 재시도 — 첫 렌더 직후 div 가 아직 mount 안 됐을 수 있음.
        requestAnimationFrame(() => {
          if (cancelled) return;
          const el2 = document.getElementById(mapEl);
          if (!el2 || !window.naver?.maps) {
            setMapFailed(true);
            return;
          }
          initMap(el2);
        });
        return;
      }
      initMap(el);
    }).catch((err) => {
      if (cancelled) return;
      console.error('[AddressAutocomplete] map load err:', err);
      setMapFailed(true);
    });

    function initMap(el: HTMLElement) {
      if (cancelled) return;
      try {
        const naverMaps = window.naver!.maps;
        const center = new naverMaps.LatLng(selected!.lat, selected!.lng);
        const map = new naverMaps.Map(el, {
          center,
          zoom: 16,
          minZoom: 8,
          maxZoom: 19,
          zoomControl: false,
          // touchEvents 끄기 — 카드 안의 인터랙션은 가벼운 스크롤 정도로 제한.
          draggable: true,
          scrollWheel: false,
        });
        const marker = new naverMaps.Marker({
          position: center,
          map,
        });
        mapInstanceRef.current = map;
        markerInstanceRef.current = marker;
        setMapReady(true);
      } catch (e) {
        console.error('[AddressAutocomplete] map init err:', e);
        setMapFailed(true);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [selected, mapEl]);

  // ── 핸들러 ──────────────────────────────────────────────────────────────
  const handleSelect = useCallback((item: ApiItem) => {
    setSelected(item);
    setShowDropdown(false);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selected) return;
    onChange({
      name: selected.name,
      address: selected.roadAddress || selected.address,
      lat: selected.lat,
      lng: selected.lng,
      category: selected.category || undefined,
    });
  }, [selected, onChange]);

  const handleReject = useCallback(() => {
    setSelected(null);
    setShowDropdown(true);
    setMapEl(`cocotrip-map-${++mapInstanceCounter}`);
  }, []);

  const handleChangeRequest = useCallback(() => {
    onChange(null);
    setSelected(null);
    setQuery('');
    setResults([]);
    setMapEl(`cocotrip-map-${++mapInstanceCounter}`);
  }, [onChange]);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  // 외부에서 confirmed value 가 있으면 읽기 전용 표기.
  if (value) {
    return (
      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-wider text-white/55 font-semibold">
          {label}
        </label>
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/90 font-medium truncate">{value.name}</p>
            <p className="text-xs text-white/55 truncate">{value.address}</p>
          </div>
          <button
            type="button"
            onClick={handleChangeRequest}
            className="text-xs text-[#B668FC] hover:text-[#B668FC]/80 font-medium flex items-center gap-1 shrink-0"
          >
            <Edit2 className="w-3 h-3" /> {t.changeButton}
          </button>
        </div>
      </div>
    );
  }

  // 검색 + 드롭다운 + 미니지도 카드 단계.
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs uppercase tracking-wider text-white/55 font-semibold">
        {label}
      </label>

      {/* 입력창 — selected 상태에서는 숨김 (미니지도가 대체) */}
      {!selected && (
        <div className="relative">
          <input
            id={id}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
            className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/55 outline-none focus:border-[#B668FC]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/55">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}

          {/* 드롭다운 */}
          {showDropdown && !disabled && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/15 bg-[#1a1a1a] shadow-xl max-h-72 overflow-y-auto">
              {loading && (
                <div className="px-4 py-3 text-xs text-white/55 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t.searching}
                </div>
              )}
              {!loading && error && (
                <div className="px-4 py-3 text-xs text-amber-300">
                  {error}
                </div>
              )}
              {!loading && !error && results.length === 0 && query.length >= 2 && (
                <div className="px-4 py-3 text-xs text-white/55">
                  {t.noResults}
                </div>
              )}
              {!loading && !error && results.length > 0 && (
                <ul className="divide-y divide-white/[0.06]">
                  {results.map((it, idx) => (
                    <li key={`${it.name}-${idx}-${it.lat}-${it.lng}`}>
                      <button
                        type="button"
                        onClick={() => handleSelect(it)}
                        className="w-full text-left px-4 py-3 hover:bg-white/[0.06] transition-colors flex items-start gap-2"
                      >
                        <MapPin className="w-4 h-4 text-[#B668FC] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/90 font-medium truncate">{it.name}</p>
                          <p className="text-xs text-white/55 truncate">
                            {it.roadAddress || it.address}
                          </p>
                          {it.category && (
                            <p className="text-[10px] text-white/40 mt-0.5 truncate">{it.category}</p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* 미니 지도 카드 — selected 시 노출, "맞음/다시" 버튼 */}
      {selected && (
        <div className="rounded-xl border border-[#B668FC]/30 bg-[#B668FC]/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-start gap-2">
            <MapPin className="w-4 h-4 text-[#B668FC] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/90 font-semibold truncate">{selected.name}</p>
              <p className="text-xs text-white/65 truncate">
                {selected.roadAddress || selected.address}
              </p>
              {selected.category && (
                <p className="text-[10px] text-white/45 mt-0.5 truncate">{selected.category}</p>
              )}
            </div>
          </div>

          <div className="relative w-full bg-black/30" style={{ height: 180 }}>
            {!mapFailed ? (
              <div id={mapEl} className="absolute inset-0" aria-label="Mini map preview" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-white/55 px-4 text-center">
                {t.mapUnavailable}
              </div>
            )}
            {!mapFailed && !mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="w-5 h-5 animate-spin text-white/70" />
              </div>
            )}
          </div>

          <div className="px-4 py-3">
            <p className="text-xs text-white/75 mb-2 font-medium">{t.confirmTitle}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                <Check className="w-3.5 h-3.5" /> {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white/85 border border-white/20 hover:bg-white/[0.06] flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> {t.confirmNo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AddressAutocomplete;
