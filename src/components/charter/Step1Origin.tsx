// Step 1: 출발지 선택 — 주요 4개 + 펼치기 9개 + 기타
// PR-H: 자유 입력 → AddressAutocomplete (Naver Local Search + 미니 지도 확인 카드).
// 자동완성 결과만 허용 — 좌표를 보유해야 정확한 거리 산출 가능.
import { useState } from 'react';
import { Plane, Hotel, Car, ChevronDown, MapPin, Search } from 'lucide-react';
import type { WizardState, OriginCode } from './types';
import { AIRPORTS_CATALOG, CITIES_CATALOG } from '@/data/charterPricing';
import { getWizardI18n } from './wizard-i18n';
import { AddressAutocomplete, type AddressResult } from './AddressAutocomplete';
import { translations } from '@/i18n';

const PRIMARY: OriginCode[] = ['ICN', 'GMP', 'SEL_METRO', 'BUS_METRO'];
const SECONDARY: OriginCode[] = ['PUS', 'CJU', 'TAE', 'CJJ', 'MWX', 'KWJ', 'RSU', 'USN'];

function labelFor(code: OriginCode, lang: 'ko' | 'en'): { title: string; sub: string; Icon: typeof Plane } {
  const airports = AIRPORTS_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  const cities = CITIES_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  if (code in airports) {
    const a = airports[code];
    return { title: lang === 'ko' ? a.name_ko : a.name_en, sub: `(${code})`, Icon: Plane };
  }
  if (code in cities) {
    const c = cities[code];
    const Icon = code === 'SEL_METRO' ? Hotel : Car;
    return { title: lang === 'ko' ? c.name_ko : c.name_en, sub: lang === 'ko' ? '호텔·숙소' : 'Hotels', Icon };
  }
  return { title: code, sub: '', Icon: MapPin };
}

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step1Origin({ state, patch, language = 'en' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const lang = language === 'ko' ? 'ko' : 'en';
  const i18n = getWizardI18n(language);
  // 공항·도시 검색 — 타이핑하면 PRIMARY+SECONDARY 전체에서 이름/코드 매칭 필터.
  const q = query.trim().toLowerCase();
  const ALL_ORIGINS: OriginCode[] = [...PRIMARY, ...SECONDARY];
  const filtered = q
    ? ALL_ORIGINS.filter((code) => {
        const { title } = labelFor(code, lang);
        return title.toLowerCase().includes(q) || code.toLowerCase().includes(q);
      })
    : null;
  // PR-H: 자유 입력 → AddressAutocomplete. 자동완성 i18n 은 addressAutocomplete namespace.
  const aacText = (translations[language] as unknown as {
    addressAutocomplete?: { originLabel: string; placeholderHint: string };
  }).addressAutocomplete ?? { originLabel: 'Origin', placeholderHint: 'Try: Lotte Hotel Myeongdong' };

  // confirmed origin coord — state.originLat/Lng 있으면 read-only 모드.
  const confirmedOrigin: AddressResult | undefined =
    typeof state.originLat === 'number' && typeof state.originLng === 'number' && state.originName
      ? {
          name: state.originName,
          address: state.originAddress ?? '',
          lat: state.originLat,
          lng: state.originLng,
          category: state.originCategory,
        }
      : undefined;

  const card = (code: OriginCode) => {
    const { title, sub, Icon } = labelFor(code, lang);
    const selected = state.origin === code;
    return (
      <button
        key={code}
        type="button"
        onClick={() => patch({
          origin: code,
          originCustom: undefined,
          // 미리 정의된 origin 코드 선택 시 자유입력 좌표 reset.
          originLat: undefined, originLng: undefined,
          originAddress: undefined, originName: undefined, originCategory: undefined,
        })}
        className={`flex flex-col items-center justify-center py-4 px-3 rounded-xl border text-center transition-all ${
          selected
            ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/15 to-[#FF6B9D]/10 text-white'
            : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-[#B668FC]/40 hover:text-white/90'
        }`}
      >
        <Icon className="w-5 h-5 mb-1.5" />
        <p className="text-xs font-semibold leading-tight">{title}</p>
        <p className="text-[10px] opacity-55 mt-0.5">{sub}</p>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* 공항·도시 검색 (트립닷컴식) — 타이핑하면 카드 필터. 비우면 기존 주요/펼치기. */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'ko' ? '공항·도시 검색 (예: ICN, 인천, 부산)' : 'Search airport / city (e.g. ICN, Incheon, Busan)'}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white text-sm placeholder:text-white/40 outline-none focus:border-[#B668FC]/40"
        />
      </div>

      {filtered ? (
        filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">{filtered.map(card)}</div>
        ) : (
          <p className="text-center text-white/40 text-sm py-6">
            {lang === 'ko' ? '검색 결과 없음 — 아래 자유 주소 검색을 써보세요' : 'No match — try the free address search below'}
          </p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {PRIMARY.map(card)}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.02] text-white/50 text-xs hover:bg-white/[0.05] transition-colors"
      >
        {i18n.otherOrigins} ({SECONDARY.length + 1})
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <>
          {!filtered && (
            <div className="grid grid-cols-2 gap-3">
              {SECONDARY.map(card)}
            </div>
          )}
          {/* PR-H: 자유 입력 → AddressAutocomplete (자동완성 + 미니지도 확인). */}
          <AddressAutocomplete
            id="charter-origin-autocomplete"
            label={i18n.customAddress || aacText.originLabel}
            placeholder={aacText.placeholderHint}
            language={language}
            value={confirmedOrigin}
            onChange={(coord) => {
              if (!coord) {
                // 사용자가 "변경" 클릭 — 좌표 초기화. origin 도 풀어서 다시 카드 선택 가능하게.
                patch({
                  originLat: undefined, originLng: undefined,
                  originAddress: undefined, originName: undefined, originCategory: undefined,
                  origin: undefined, originCustom: undefined,
                });
                return;
              }
              patch({
                origin: 'CUSTOM',
                originCustom: coord.address || coord.name,
                originLat: coord.lat,
                originLng: coord.lng,
                originAddress: coord.address,
                originName: coord.name,
                originCategory: coord.category,
              });
            }}
          />
        </>
      )}
    </div>
  );
}
