// TourBookingDialog — 투어 상세 CTA 클릭 시 인원수·날짜·언어·addon 선택 + PayPal 직진입.
// productType 매핑 있으면 (대부분) PayPalBookingButton, 없으면 (multicity-3d) charter 페이지 redirect.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Calendar, Users, Languages, Plus, Minus, Check } from 'lucide-react';
import pricingSpec from '@/data/pricing_spec.json';
import { getTourProductType, getTourPriceKRW } from '@/data/tours';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { useAuth } from '@/hooks/useAuth';
import type { Tour, DriverLanguage } from '@/data/tours';
import type { Language } from '@/i18n';

type AddonItem = {
  id: string;
  labels: { ko: string; en: string; ja: string; zh: string };
  priceKRW: number;
  unit: 'per_trip' | 'per_person' | 'per_day';
  applies_to: ('tour' | 'charter' | 'airport_transfer')[];
};

const ADDONS: AddonItem[] = ((pricingSpec as { addons?: { items?: AddonItem[] } }).addons?.items || []) as AddonItem[];

function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

function computeAddonTotal(selectedIds: Set<string>, pax: number, days: number): number {
  let total = 0;
  for (const a of ADDONS) {
    if (!selectedIds.has(a.id)) continue;
    if (a.unit === 'per_person') total += a.priceKRW * pax;
    else if (a.unit === 'per_day') total += a.priceKRW * days;
    else total += a.priceKRW;
  }
  return total;
}

const I18N: Record<Language, {
  title: string; pax: string; date: string; lang: string; addons: string;
  priceBase: string; priceAddons: string; priceTotal: string;
  cancel: string; submit: string; pickDate: string;
}> = {
  ko: { title: '투어 예약', pax: '인원수', date: '투어 날짜', lang: '기사 언어', addons: '추가 옵션',
        priceBase: '기본', priceAddons: '추가옵션', priceTotal: '총액 (예상)',
        cancel: '취소', submit: '결제 페이지로 이동', pickDate: '날짜 선택' },
  en: { title: 'Book This Tour', pax: 'Passengers', date: 'Tour date', lang: 'Driver language', addons: 'Add-ons',
        priceBase: 'Base', priceAddons: 'Add-ons', priceTotal: 'Estimated total',
        cancel: 'Cancel', submit: 'Continue to payment', pickDate: 'Select date' },
  ja: { title: 'ツアー予約', pax: '人数', date: 'ツアー日', lang: 'ドライバー言語', addons: '追加オプション',
        priceBase: '基本', priceAddons: 'オプション', priceTotal: '合計（予想）',
        cancel: 'キャンセル', submit: '決済ページへ', pickDate: '日付を選択' },
  zh: { title: '预订旅游', pax: '人数', date: '旅游日期', lang: '司机语言', addons: '附加选项',
        priceBase: '基本', priceAddons: '附加选项', priceTotal: '估计总额',
        cancel: '取消', submit: '继续到付款页', pickDate: '选择日期' },
};

const DRIVER_LANG_LABELS: Record<DriverLanguage, Record<Language, string>> = {
  en: { ko: '영어', en: 'English',  ja: '英語', zh: '英语' },
  ja: { ko: '일본어', en: 'Japanese', ja: '日本語', zh: '日语' },
  zh: { ko: '중국어', en: 'Chinese',  ja: '中国語', zh: '中文' },
};

interface Props {
  tour: Tour;
  language: Language;
  trigger: React.ReactNode;
}

export function TourBookingDialog({ tour, language, trigger }: Props) {
  const labels = I18N[language] || I18N.en;
  const auth = useAuth();
  const userEmail = auth?.user?.email || '';
  const availableLangs: DriverLanguage[] = (tour.driverLanguages && tour.driverLanguages.length > 0)
    ? tour.driverLanguages
    : (['en'] as DriverLanguage[]);

  const [pax, setPax] = useState<number>(2);
  const [date, setDate] = useState<string>('');
  const [driverLang, setDriverLang] = useState<DriverLanguage>(availableLangs[0]);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());

  const days = Math.max(1, tour.durationDays);

  // 비-영어 기사는 자동으로 해당 addon 추가
  const effectiveAddons = useMemo(() => {
    const next = new Set(selectedAddons);
    if (driverLang === 'ja') next.add('japanese_driver');
    if (driverLang === 'zh') next.add('chinese_driver');
    return next;
  }, [selectedAddons, driverLang]);

  // SSOT 기반 가격 — pricing_spec.json daily_tour_prices 우선, 없으면 priceFrom × KRW
  const baseKRW = useMemo(() => getTourPriceKRW(tour.id, tour.priceFrom), [tour.id, tour.priceFrom]);
  const addonKRW = computeAddonTotal(effectiveAddons, pax, days);
  const totalKRW = baseKRW + addonKRW;

  const productType = useMemo(() => getTourProductType(tour.id), [tour.id]);
  const canCheckoutDirectly = productType !== null && totalKRW > 0 && !!date;

  // 투어 적용 가능 addon만 (driver lang 옵션은 lang select에서 자동 처리)
  const visibleAddons = ADDONS.filter(a =>
    a.applies_to.includes('tour') && !['japanese_driver', 'chinese_driver'].includes(a.id)
  );

  const submitUrl = useMemo(() => {
    const params = new URLSearchParams({
      tour: tour.slug,
      pax: String(pax),
      driverLang,
    });
    if (date) params.set('date', date);
    const addonIds = Array.from(effectiveAddons);
    if (addonIds.length) params.set('addons', addonIds.join(','));
    return `/charter?${params.toString()}`;
  }, [tour.slug, pax, date, driverLang, effectiveAddons]);

  const today = new Date();
  const minDate = today.toISOString().slice(0, 10);

  const toggleAddon = (id: string) => {
    setSelectedAddons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-w-md mx-auto max-h-[85vh] overflow-y-auto"
        style={{ background: 'linear-gradient(180deg, #0f0820 0%, #0a0512 100%)', border: '1px solid rgba(182,104,252,0.20)', color: 'white' }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-black">{labels.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Pax stepper */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/40 uppercase tracking-wider mb-1.5">
              <Users className="w-3.5 h-3.5" />{labels.pax}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPax(p => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                aria-label="Decrease pax"
              >
                <Minus className="w-4 h-4 text-white/70" />
              </button>
              <span className="text-[18px] font-black tabular-nums w-10 text-center">{pax}</span>
              <button
                type="button"
                onClick={() => setPax(p => Math.min(tour.maxPax, p + 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                aria-label="Increase pax"
              >
                <Plus className="w-4 h-4 text-white/70" />
              </button>
              <span className="text-[10px] text-white/30">max {tour.maxPax}</span>
            </div>
          </div>

          {/* Date picker */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/40 uppercase tracking-wider mb-1.5">
              <Calendar className="w-3.5 h-3.5" />{labels.date}
            </label>
            <input
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-[13px] focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
              placeholder={labels.pickDate}
            />
          </div>

          {/* Driver language */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/40 uppercase tracking-wider mb-1.5">
              <Languages className="w-3.5 h-3.5" />{labels.lang}
            </label>
            <div className="flex gap-1.5">
              {(['en', 'ja', 'zh'] as DriverLanguage[]).map(l => {
                const isAvailable = availableLangs.includes(l);
                const isActive = driverLang === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => isAvailable && setDriverLang(l)}
                    disabled={!isAvailable}
                    className="flex-1 text-[12px] font-semibold py-2 rounded-xl transition-colors"
                    style={
                      isActive
                        ? { background: 'rgba(140,200,255,0.18)', border: '1px solid rgba(140,200,255,0.45)', color: '#A0CBFF' }
                        : isAvailable
                        ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }
                        : { background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.20)', cursor: 'not-allowed' }
                    }
                  >
                    {DRIVER_LANG_LABELS[l][language]}
                    {l !== 'en' && isAvailable && (
                      <span className="text-[9px] text-white/30 ml-1">+₩80k</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add-ons */}
          <div>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5">{labels.addons}</p>
            <div className="space-y-1.5">
              {visibleAddons.map(a => {
                const checked = selectedAddons.has(a.id);
                const unitLabel = a.unit === 'per_person'
                  ? (language === 'ko' ? '/인' : language === 'ja' ? '/人' : language === 'zh' ? '/人' : '/pax')
                  : a.unit === 'per_day'
                  ? (language === 'ko' ? '/일' : language === 'ja' ? '/日' : language === 'zh' ? '/天' : '/day')
                  : '';
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAddon(a.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left transition-colors"
                    style={
                      checked
                        ? { background: 'rgba(182,104,252,0.10)', border: '1px solid rgba(182,104,252,0.35)' }
                        : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }
                    }
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-4 h-4 rounded shrink-0 flex items-center justify-center"
                        style={
                          checked
                            ? { background: '#B668FC', border: '1px solid #B668FC' }
                            : { background: 'transparent', border: '1px solid rgba(255,255,255,0.20)' }
                        }
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-[12px] text-white/75 truncate">{a.labels[language] || a.labels.en}</span>
                    </div>
                    <span className="text-[11px] font-bold text-white/55 shrink-0">
                      ₩{a.priceKRW.toLocaleString('ko-KR')}{unitLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price summary */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex justify-between text-[11px] text-white/45 mb-1">
              <span>{labels.priceBase}</span>
              <span>{formatKRW(baseKRW)}</span>
            </div>
            {addonKRW > 0 && (
              <div className="flex justify-between text-[11px] text-white/45 mb-1">
                <span>{labels.priceAddons}</span>
                <span>+{formatKRW(addonKRW)}</span>
              </div>
            )}
            <div className="h-px bg-white/[0.08] my-1.5" />
            <div className="flex justify-between text-[14px] font-black">
              <span className="text-white">{labels.priceTotal}</span>
              <span style={{ color: '#C99FFF' }}>{formatKRW(totalKRW)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-3 flex-col">
          {canCheckoutDirectly && productType ? (
            <div className="w-full">
              {/* PayPal 직진입 — 인원수·날짜·언어·addon 포함 가격으로 결제 */}
              <PayPalBookingButton
                productType={productType}
                passengers={pax}
                dateStart={date}
                dateEnd={date}
                priceKRW={totalKRW}
                p={{}}
                lang={language}
                pickupLocation={tour.defaultPickup ? (tour.defaultPickup[language] || tour.defaultPickup.en) : ''}
                vehicleType={tour.vehicleType.toLowerCase()}
                memo={`Tour: ${tour.title.en} | ${pax} pax | ${driverLang.toUpperCase()} driver | Add-ons: ${Array.from(effectiveAddons).join(', ') || 'none'}`}
                userEmail={userEmail}
              />
            </div>
          ) : (
            <Link
              to={submitUrl}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-white"
              style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
            >
              {labels.submit}
            </Link>
          )}
          {!date && productType && (
            <p className="text-[10px] text-white/30 text-center mt-1">
              {language === 'ko' ? '날짜를 선택하면 결제로 진행할 수 있습니다.' :
               language === 'ja' ? '日付を選択すると決済へ進めます。' :
               language === 'zh' ? '选择日期后可继续付款。' :
               'Select a date to proceed to payment.'}
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
