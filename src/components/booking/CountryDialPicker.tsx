/**
 * CountryDialPicker — 트립닷컴식 국가번호 선택 (검색 + 자주찾는 + 전세계 ~239국 + 선택 체크).
 *
 * BookingInfoForm 의 국가번호 <select> 를 대체. Popover(Radix) + Command(cmdk) 재사용 —
 *   신규 dependency 0. 기존 ui/command.tsx · ui/popover.tsx 프리미티브 위에 다크테마 오버라이드.
 *
 * SSOT: COUNTRIES / PINNED_DIALS / flagOf (src/lib/country-dials.ts) — 로그인 전화인증과 동일 배열.
 * 배선 무변경: onChange(dial) 만 emit — BookingInfoForm 이 selDial/localNumber/emitPhone 소유.
 *
 * ⚠️ 다크테마: ui/command·popover 는 shadcn Tailwind 토큰(bg-popover 등)이나 BookingInfoForm 은
 *   inline 다크(#080b14/#7C5CFC). 미오버라이드 시 흰배경 시각회귀 → PopoverContent/CommandList/Item
 *   에 다크배경(#0f1220) + 보라 선택 하이라이트 강제. flag emoji 는 데이터 아닌 flagOf(code) 파생.
 */
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { COUNTRIES, PINNED_DIALS, findCountryByDial, flagOf, type CountryDial, type DialLang } from '@/lib/country-dials';

interface Props {
  value: string;            // 현재 선택된 dial (+ 없는 숫자, 예 '82')
  onChange: (dial: string) => void;
  lang: DialLang;
}

// picker 표시 텍스트 — 4언어 국가명(미제공 lang 은 en 폴백).
const nameOf = (c: CountryDial, lang: DialLang) => c.name[lang] || c.name.en;

// 자주찾는 섹션 = PINNED_DIALS 순서대로 첫 일치 국가. dial 중복('1'=US/CA) 은 findCountryByDial 첫 일치.
const pinnedCountries = (): CountryDial[] => {
  const out: CountryDial[] = [];
  for (const d of PINNED_DIALS) {
    const c = findCountryByDial(d);
    if (c) out.push(c);
  }
  return out;
};

// 다크테마 라벨 — i18n 4언어 (트립닷컴식).
const T: Record<DialLang, { ph: string; pinned: string; all: string; empty: string; aria: string }> = {
  ko: { ph: '국가 또는 지역', pinned: '자주 찾는 항목', all: '전체', empty: '검색 결과 없음', aria: '국가번호 선택' },
  en: { ph: 'Country or region', pinned: 'Frequently used', all: 'All', empty: 'No results', aria: 'Select country code' },
  ja: { ph: '国・地域', pinned: 'よく使う項目', all: 'すべて', empty: '結果なし', aria: '国番号を選択' },
  zh: { ph: '国家或地区', pinned: '常用项目', all: '全部', empty: '无结果', aria: '选择国家代码' },
};

export function CountryDialPicker({ value, onChange, lang }: Props) {
  const [open, setOpen] = useState(false);
  const t = T[lang] || T.en;
  const selected = findCountryByDial(value);
  const pinned = useMemo(() => pinnedCountries(), []);
  // 전세계 정렬 = 사용자 언어 localeCompare (가나다/알파벳/かな/拼音 순).
  const sorted = useMemo(
    () => [...COUNTRIES].sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang)),
    [lang],
  );

  const select = (dial: string) => {
    onChange(dial);
    setOpen(false);
  };

  // 다크테마 공통 (BookingInfoForm inline 다크와 일치).
  const itemCls =
    'text-white/90 aria-selected:bg-[#7C5CFC]/25 aria-selected:text-white data-[selected=true]:bg-[#7C5CFC]/25 data-[selected=true]:text-white cursor-pointer';

  const renderItem = (c: CountryDial) => {
    return (
      <CommandItem
        key={c.code}
        // 3중 검색: 현지어명 / 영문명 / dial / ISO2 코드.
        value={`${nameOf(c, lang)} ${c.name.en} ${c.dial} ${c.code}`}
        onSelect={() => select(c.dial)}
        className={itemCls}
      >
        <span className="mr-2 text-base leading-none">{flagOf(c.code)}</span>
        <span className="flex-1 truncate">{nameOf(c, lang)}</span>
        <span className="ml-2 text-white/50 tabular-nums">+{c.dial}</span>
        {c.dial === value && <Check className="ml-2 size-4 text-[#7C5CFC]" />}
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.aria}
          aria-expanded={open}
          aria-haspopup="listbox"
          style={{
            flex: '0 0 auto',
            width: 116,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '0 10px',
            height: 44,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.03)',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{flagOf(selected ? selected.code : '')}</span>
          <span style={{ flex: 1, textAlign: 'left' }}>+{value}</span>
          <span aria-hidden style={{ opacity: 0.5, fontSize: 11 }}>▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(92vw,360px)] p-0 border-white/10 bg-[#0f1220] text-white shadow-xl z-[10000]"
      >
        <Command
          className="bg-[#0f1220] text-white [&_[cmdk-group-heading]]:text-white/45"
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={t.ph}
            autoFocus
            className="text-white placeholder:text-white/40"
          />
          <CommandList className="max-h-[320px] bg-[#0f1220]">
            <CommandEmpty className="text-white/50">{t.empty}</CommandEmpty>
            <CommandGroup heading={t.pinned}>
              {pinned.map(renderItem)}
            </CommandGroup>
            <CommandSeparator className="bg-white/10" />
            <CommandGroup heading={t.all}>
              {sorted.map(renderItem)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
