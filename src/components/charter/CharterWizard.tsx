// CharterWizard — 6단계 스테퍼.
// 2026-05-07 정책 B: matrix miss → Geocoding 우선. Bus/VIP 차량은 가격 카드 대신 InquiryForm.
// 2026-05-10 (B9-35 잔여): wizard 진행 자동 저장 + 24h 이내 재진입 시 ResumeWizardModal.
import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useQuoteCalculator } from '@/hooks/useQuoteCalculator';
import { INITIAL_WIZARD_STATE } from './types';
import type { WizardState } from './types';
import { Step1Origin } from './Step1Origin';
import { Step2Service } from './Step2Service';
import { Step3Destination } from './Step3Destination';
import { Step4PaxVehicle } from './Step4PaxVehicle';
import { Step5DateOptions } from './Step5DateOptions';
import { Step6Quote } from './Step6Quote';
import { InquiryForm } from './InquiryForm';
import { getWizardI18n } from './wizard-i18n';
import {
  loadWizardSnapshot,
  useWizardPersistence,
  clearWizardSnapshot,
} from '@/hooks/useWizardPersistence';
import { ResumeWizardModal } from '@/components/ResumeWizardModal';

// localStorage 에 저장하는 charter wizard snapshot — state + manualKm + step.
// state object 만 저장하면 manualKm (Geocoding fail 후 사용자 직접 km 입력) 가
// 복원 안 됨 → 6단계 도중 새로고침 시 거리 다시 입력해야. 둘 다 묶어 저장.
type CharterSnapshotValues = { state: WizardState; manualKm: number | null };

type CharterWizardProps = {
  initialState?: Partial<WizardState>;
  onComplete?: (state: WizardState) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
};

// distanceSource 라벨 — 사용자에게 거리 출처 투명하게 노출.
function distanceSourceLabel(source: 'matrix' | 'geocoding' | 'manual' | null, lang: string): string {
  if (source === 'matrix') {
    return lang === 'ko' ? '매트릭스 직접' : lang === 'ja' ? 'マトリクス' : lang === 'zh' ? '矩阵查询' : 'Matrix lookup';
  }
  if (source === 'geocoding') {
    return lang === 'ko' ? '지도 추정' : lang === 'ja' ? '地図推定' : lang === 'zh' ? '地图估算' : 'Map estimate';
  }
  if (source === 'manual') {
    return lang === 'ko' ? '직접 입력' : lang === 'ja' ? '直接入力' : lang === 'zh' ? '手动输入' : 'Manual';
  }
  return '';
}

function geocodingFailedLabel(lang: string): string {
  if (lang === 'ko') return '자동 거리 계산 실패. km 직접 입력해주세요.';
  if (lang === 'ja') return '自動距離計算失敗。kmを直接入力してください。';
  if (lang === 'zh') return '自动距离计算失败。请手动输入公里数。';
  return 'Auto distance failed. Please enter km manually.';
}

function manualKmLabel(lang: string): string {
  if (lang === 'ko') return '거리 직접 입력 (km)';
  if (lang === 'ja') return '距離直接入力 (km)';
  if (lang === 'zh') return '手动输入距离 (km)';
  return 'Enter distance (km)';
}

export function CharterWizard({ initialState, onComplete, language = 'en' }: CharterWizardProps) {
  // 2026-05-10 (B9-35 잔여): 마운트 시 24h 이내 미완 snapshot 있으면 modal 노출.
  // initialState (caller 가 명시 prefill) 이 있으면 snapshot 무시 — caller intent 우선.
  const initialSnap = useMemo<CharterSnapshotValues | null>(() => {
    if (initialState && Object.keys(initialState).length > 0) return null;
    const snap = loadWizardSnapshot<CharterSnapshotValues>('charter');
    return snap?.values ?? null;
  }, [initialState]);
  const initialSnapStep = useMemo<number>(() => {
    if (initialState && Object.keys(initialState).length > 0) return 1;
    const snap = loadWizardSnapshot<CharterSnapshotValues>('charter');
    return snap?.step ?? 1;
  }, [initialState]);

  const [state, setState] = useState<WizardState>(() => {
    const filtered = Object.fromEntries(
      Object.entries(initialState ?? {}).filter(([, v]) => v !== undefined),
    );
    return { ...INITIAL_WIZARD_STATE, ...filtered };
  });
  const [currentStep, setCurrentStep] = useState(1);
  // 사용자 manual km override — Geocoding 실패 또는 직접 보정.
  const [manualKm, setManualKm] = useState<number | null>(null);
  // Resume modal — 사용자가 '이어서/새로 시작' 결정할 때까지 main snapshot 보존.
  const [resumeOpen, setResumeOpen] = useState<boolean>(!!initialSnap);

  const { quote, loading, geocodingFailed, distanceSource } = useQuoteCalculator(state, manualKm);

  // Resume modal 활성 시 'charter_paused' namespace 로 저장 → 사용자가 '새로 시작'
  // 누르기 전까지 원본 snapshot 유지. WizardForm/index.tsx 와 동일 패턴.
  useWizardPersistence<CharterSnapshotValues>(
    resumeOpen ? 'charter_paused' : 'charter',
    { state, manualKm },
    currentStep,
  );

  // Resume modal summary — origin → service → destination · pax 압축. snapshot 의 핵심만.
  const resumeSummary = useMemo<string>(() => {
    if (!initialSnap) return '';
    const s = initialSnap.state;
    const parts: string[] = [];
    if (s.origin) parts.push(s.origin === 'CUSTOM' ? (s.originAddress || 'Custom') : s.origin);
    if (s.service) parts.push(s.service.replace(/_/g, ' '));
    if (s.destinationKey) parts.push(s.destinationKey);
    if (s.paxCount && s.paxCount > 0) parts.push(`${s.paxCount} pax`);
    return parts.join(' · ');
  }, [initialSnap]);

  function handleResumeContinue() {
    if (!initialSnap) { setResumeOpen(false); return; }
    setState(initialSnap.state);
    setManualKm(initialSnap.manualKm);
    setCurrentStep(Math.max(1, Math.min(6, initialSnapStep)));
    setResumeOpen(false);
  }
  function handleResumeRestart() {
    clearWizardSnapshot('charter');
    setResumeOpen(false);
  }

  const patch = useCallback((p: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...p }));
  }, []);

  // Bus/VIP 는 InquiryForm 진행 — wizard 내 결제 X.
  const isInquiryVehicle = state.vehicle === 'bus' || state.vehicle === 'vip';

  const canAdvance = useCallback(() => {
    switch (currentStep) {
      case 1: {
        // 'CUSTOM' 출발지 — AddressAutocomplete 가 좌표 확정해야 advance 가능 (자유 입력 폐기).
        if (state.origin === 'CUSTOM') {
          return typeof state.originLat === 'number' && typeof state.originLng === 'number';
        }
        return !!state.origin;
      }
      case 2: return !!state.service;
      case 3: {
        // destinationKey (권역 카드) 또는 confirmed 좌표 — 자유 텍스트만 있는 경우는 차단 (자유 입력 폐기).
        if (state.destinationKey) return true;
        return typeof state.destLat === 'number' && typeof state.destLng === 'number';
      }
      case 4: return !!state.paxCount && state.paxCount >= 1 && !!state.vehicle;
      case 5: {
        if (!state.startDate) return false;
        // PR-W4 (이슈 35): 픽업 시각은 Step 3 select 입력. INITIAL_WIZARD_STATE 가 09:00 기본값.
        if (!state.pickupTime && !state.startTime) return false;
        if (!state.customerName || state.customerName.trim().length < 2) return false;
        const phoneDigits = (state.customerPhone ?? '').replace(/\D/g, '');
        if (phoneDigits.length < 7) return false;
        if (state.service === 'airport_transfer') {
          if (!state.airport?.flightNumber || state.airport.flightNumber.length < 3) return false;
          if (state.origin === 'ICN' && !state.airport?.terminal) return false;
        }
        if (state.service === 'multi_day') {
          if (!state.endDate) return false;
          if (!state.lodgingLocation) return false;
        }
        return true;
      }
      case 6: {
        if (isInquiryVehicle) return false; // InquiryForm 자체에 submit CTA — wizard nav 결제 비활성.
        if (!quote) return false;
        if (quote.needsCustomQuote) return true;
        return quote.subtotalKRW > 0;
      }
      default: return false;
    }
  }, [currentStep, state, quote, isInquiryVehicle]);

  const goNext = () => setCurrentStep(s => Math.min(6, s + 1));
  const goPrev = () => setCurrentStep(s => Math.max(1, s - 1));

  const i18n = getWizardI18n(language);
  const STEP_LABELS = [i18n.step1, i18n.step2, i18n.step3, i18n.step4, i18n.step5, i18n.step6];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-8">
        {STEP_LABELS.map((_, idx) => {
          const id = idx + 1;
          return (
            <div key={id} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                id < currentStep ? 'bg-emerald-500 text-white' :
                id === currentStep ? 'bg-[#B668FC] text-white m-pulse-glow' :
                'bg-white/10 text-white/55'
              }`}>
                {id < currentStep ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <motion.path
                      d="M3.5 8.5 L7 12 L13 4.5"
                      stroke="white"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
                    />
                  </svg>
                ) : id}
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 ${id < currentStep ? 'bg-emerald-500' : 'bg-white/10'}`} />
              )}
            </div>
          );
        })}
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">
        {STEP_LABELS[currentStep - 1]}
      </h2>
      <p className="text-sm text-white/55 mb-8">{i18n.stepOf} {currentStep} / {STEP_LABELS.length}</p>

      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 sm:p-8 mb-8">
        {currentStep === 1 && <Step1Origin      state={state} patch={patch} language={language} />}
        {currentStep === 2 && <Step2Service     state={state} patch={patch} language={language} />}
        {currentStep === 3 && <Step3Destination state={state} patch={patch} language={language} />}
        {currentStep === 4 && <Step4PaxVehicle  state={state} patch={patch} language={language} />}
        {currentStep === 5 && <Step5DateOptions state={state} patch={patch} language={language} />}
        {currentStep === 6 && (
          isInquiryVehicle ? (
            // Bus / VIP — 가격 카드 대신 상담 폼.
            <InquiryForm
              vehicle={state.vehicle as 'bus' | 'vip'}
              state={state}
              language={language}
            />
          ) : (
            <div className="space-y-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-white/55">
                  <Loader2 className="w-4 h-4 animate-spin" /> Geocoding...
                </div>
              )}
              {distanceSource && !loading && (
                <p className="text-xs text-white/55">
                  {language === 'ko' ? '거리 출처' : language === 'ja' ? '距離ソース' : language === 'zh' ? '距离来源' : 'Distance source'}:{' '}
                  <span className="text-white/85">{distanceSourceLabel(distanceSource, language)}</span>
                </p>
              )}
              <Step6Quote quote={quote} state={state} language={language} />
              {geocodingFailed && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                  <p className="text-sm text-amber-200/85 mb-2">⚠ {geocodingFailedLabel(language)}</p>
                  <label className="block text-xs text-white/60 mb-1">{manualKmLabel(language)}</label>
                  <input
                    type="number"
                    min={1}
                    value={manualKm ?? ''}
                    onChange={e => {
                      const n = Number(e.target.value);
                      setManualKm(Number.isFinite(n) && n > 0 ? n : null);
                    }}
                    className="w-32 px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] text-white/85 text-sm outline-none focus:border-[#B668FC]/40"
                  />
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="flex gap-3">
        {currentStep > 1 && (
          <button
            type="button"
            onClick={goPrev}
            className="flex-1 py-3 rounded-xl border border-white/15 text-white/70 text-sm font-medium hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> {i18n.prev}
          </button>
        )}
        {currentStep < 6 && (
          <button
            type="button"
            onClick={goNext}
            disabled={!canAdvance()}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            {i18n.next} <ChevronRight className="w-4 h-4" />
          </button>
        )}
        {currentStep === 6 && onComplete && !isInquiryVehicle && (
          <button
            type="button"
            onClick={() => {
              // 결제 진입 시 charter snapshot clear — 결제 완료/취소 후 빈 상태 재시작 보장.
              clearWizardSnapshot('charter');
              onComplete(state);
            }}
            disabled={!canAdvance()}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#0070BA' }}
          >
            {i18n.payProceed}
          </button>
        )}
      </div>

      <ResumeWizardModal
        open={resumeOpen}
        summary={resumeSummary}
        onContinue={handleResumeContinue}
        onRestart={handleResumeRestart}
      />
    </div>
  );
}

export default CharterWizard;
