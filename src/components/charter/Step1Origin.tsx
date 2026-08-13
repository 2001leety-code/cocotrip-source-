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

type Lang = 'ko' | 'en' | 'ja' | 'zh';

// 앱 소유 문구는 4언어 — 카탈로그(name_ko/name_en)만 ko/en 2종이라 데이터 언어는 따로 접는다.
const CITY_SUB: Record<Lang, string> = {
  ko: '호텔·숙소', en: 'Hotels', ja: 'ホテル・宿泊先', zh: '酒店·住宿',
};
const SEARCH_PLACEHOLDER: Record<Lang, string> = {
  ko: '공항·도시 검색 (예: ICN, 인천, 부산)',
  en: 'Search airport / city (e.g. ICN, Incheon, Busan)',
  // ja/zh 는 전각이라 같은 글자수에서 더 넓다 — 390px 입력폭에서 잘리지 않게 예시를 2개로.
  ja: '空港・都市検索（例: ICN、仁川）',
  zh: '搜索机场·城市（例: ICN、仁川）',
};
const NO_MATCH: Record<Lang, string> = {
  ko: '검색 결과 없음 — 아래 자유 주소 검색을 써보세요',
  en: 'No match — try the free address search below',
  ja: '該当なし — 下の住所検索をお試しください',
  zh: '无匹配结果 — 请使用下方地址搜索',
};

// 카탈로그(pricing_spec.json)는 가격 SSOT 라 name_ko/name_en 2종뿐 — ja/zh 표기가 없다.
// 가격 데이터를 건드리지 않고 이 화면 표시용으로만 덮는 정적 매핑 (Step1 노출 코드 12개 전부).
// zh 는 사이트 표준인 간체(首尔·济州·丽水·机场). 공항 코드 표기 "(ICN)" 은 언어와 무관하게 유지.
const ORIGIN_NAME_JA_ZH: Record<string, { ja: string; zh: string }> = {
  ICN: { ja: '仁川国際空港', zh: '仁川国际机场' },
  GMP: { ja: '金浦国際空港', zh: '金浦国际机场' },
  PUS: { ja: '金海国際空港', zh: '金海国际机场' },
  CJU: { ja: '済州国際空港', zh: '济州国际机场' },
  TAE: { ja: '大邱国際空港', zh: '大邱国际机场' },
  CJJ: { ja: '清州国際空港', zh: '清州国际机场' },
  MWX: { ja: '務安国際空港', zh: '务安国际机场' },
  KWJ: { ja: '光州空港', zh: '光州机场' },
  RSU: { ja: '麗水空港', zh: '丽水机场' },
  USN: { ja: '蔚山空港', zh: '蔚山机场' },
  SEL_METRO: { ja: 'ソウル市内', zh: '首尔市区' },
  BUS_METRO: { ja: '釜山市内', zh: '釜山市区' },
};

// 매핑에 없는 코드(향후 카탈로그 추가분)는 기존 안전 동작 그대로 name_en 폴백.
function localName(code: string, lang: Lang, nameKo: string, nameEn: string): string {
  if (lang === 'ko') return nameKo;
  if (lang === 'en') return nameEn;
  const l10n = ORIGIN_NAME_JA_ZH[code];
  return l10n ? l10n[lang] : nameEn;
}

function labelFor(code: OriginCode, lang: Lang): { title: string; sub: string; Icon: typeof Plane } {
  const airports = AIRPORTS_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  const cities = CITIES_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  if (code in airports) {
    const a = airports[code];
    return { title: localName(code, lang, a.name_ko, a.name_en), sub: `(${code})`, Icon: Plane };
  }
  if (code in cities) {
    const c = cities[code];
    const Icon = code === 'SEL_METRO' ? Hotel : Car;
    return { title: localName(code, lang, c.name_ko, c.name_en), sub: CITY_SUB[lang], Icon };
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
  const lang: Lang = language;
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
        data-origin-code={code}
        onClick={() => patch({
          origin: code,
          originCustom: undefined,
          // 미리 정의된 origin 코드 선택 시 자유입력 좌표 reset.
          originLat: undefined, originLng: undefined,
          originAddress: undefined, originName: undefined, originCategory: undefined,
        })}
        className={`group flex min-h-[48px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all sm:min-h-[92px] sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-4 ${
          selected
            ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/18 to-[#FF6B9D]/10 text-white shadow-[0_16px_40px_rgba(124,92,252,0.16)]'
            : 'border-white/10 bg-white/[0.035] text-white/65 hover:border-[#B668FC]/40 hover:bg-white/[0.055] hover:text-white/90'
        }`}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border sm:h-11 sm:w-11 sm:rounded-2xl ${
          selected ? 'border-[#B668FC]/35 bg-[#B668FC]/20 text-[#D8C0FF]' : 'border-white/10 bg-white/[0.035] text-white/45 group-hover:text-white/70'
        }`}>
          <Icon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold leading-tight sm:text-sm">{title}</span>
          <span className="mt-0.5 block text-[9px] opacity-55 sm:mt-1 sm:text-[11px]">{sub}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2 sm:space-y-4">
      {/* 공항·도시 검색 (트립닷컴식) — 타이핑하면 카드 필터. 비우면 기존 주요/펼치기. */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER[lang]}
          className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] py-1.5 pl-9 pr-3 text-base text-white outline-none placeholder:text-white/40 focus:border-[#B668FC]/40 sm:py-2.5"
        />
      </div>

      {filtered ? (
        filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{filtered.map(card)}</div>
        ) : (
          <p className="text-center text-white/40 text-sm py-6">
            {NO_MATCH[lang]}
          </p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PRIMARY.map(card)}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] py-2 text-xs text-white/50 transition-colors hover:bg-white/[0.05] sm:py-2.5"
      >
        {i18n.otherOrigins} ({SECONDARY.length + 1})
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <>
          {!filtered && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
