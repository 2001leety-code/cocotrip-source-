// CharterWizard — 6단계 스테퍼 (B2 Step 컴포넌트 실물 연결 완료)
import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useQuoteCalculator } from '@/hooks/useQuoteCalculator';
import { INITIAL_WIZARD_STATE } from './types';
import type { WizardState } from './types';
import { Step1Origin } from './Step1Origin';
import { Step2Service } from './Step2Service';
import { Step3Destination } from './Step3Destination';
import { Step4PaxVehicle } from './Step4PaxVehicle';
import { Step5DateOptions } from './Step5DateOptions';
import { Step6Quote } from './Step6Quote';
import { getWizardI18n } from './wizard-i18n';

type CharterWizardProps = {
  initialState?: Partial<WizardState>;
  onComplete?: (state: WizardState) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
};

export function CharterWizard({ initialState, onComplete, language = 'en' }: CharterWizardProps) {
  const [state, setState] = useState<WizardState>(() => {
    // initialState의 undefined 값은 INITIAL 기본값을 덮어쓰지 않도록 필터
    const filtered = Object.fromEntries(
      Object.entries(initialState ?? {}).filter(([, v]) => v !== undefined),
    );
    return { ...INITIAL_WIZARD_STATE, ...filtered };
  });
  const [currentStep, setCurrentStep] = useState(1);

  const quote = useQuoteCalculator(state);

  const patch = useCallback((p: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...p }));
  }, []);

  const canAdvance = useCallback(() => {
    switch (currentStep) {
      case 1: return !!state.origin || !!state.originCustom;
      case 2: return !!state.service;
      case 3: return !!state.destinationKey || !!state.destinationCustom;
      case 4: return !!state.paxCount && !!state.vehicle;
      case 5: {
        if (!state.startDate) return false;
        // 공항 픽업: 편명 필수, ICN이면 터미널도 필수
        if (state.service === 'airport_transfer') {
          if (!state.airport?.flightNumber || state.airport.flightNumber.length < 3) return false;
          if (state.origin === 'ICN' && !state.airport?.terminal) return false;
        }
        // 다일 투어: endDate 필요
        if (state.service === 'multi_day' && !state.endDate) return false;
        return true;
      }
      case 6: return !!quote && quote.subtotalKRW > 0;
      default: return false;
    }
  }, [currentStep, state, quote]);

  const goNext = () => setCurrentStep(s => Math.min(6, s + 1));
  const goPrev = () => setCurrentStep(s => Math.max(1, s - 1));

  const i18n = getWizardI18n(language);
  const STEP_LABELS = [i18n.step1, i18n.step2, i18n.step3, i18n.step4, i18n.step5, i18n.step6];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* 진행 표시 */}
      <div className="flex items-center justify-between mb-8">
        {STEP_LABELS.map((_, idx) => {
          const id = idx + 1;
          return (
            <div key={id} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                id < currentStep ? 'bg-emerald-500 text-white' :
                id === currentStep ? 'bg-[#B668FC] text-white' :
                'bg-white/10 text-white/55'
              }`}>
                {id < currentStep ? <Check className="w-4 h-4" /> : id}
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 ${id < currentStep ? 'bg-emerald-500' : 'bg-white/10'}`} />
              )}
            </div>
          );
        })}
      </div>

      <h2 className="text-xl font-bold text-white mb-1">
        {STEP_LABELS[currentStep - 1]}
      </h2>
      <p className="text-sm text-white/55 mb-6">{i18n.stepOf} {currentStep} / {STEP_LABELS.length}</p>

      {/* 스텝 슬롯 */}
      <div className="min-h-[280px] bg-white/[0.04] border border-white/10 rounded-2xl p-6 mb-6">
        {currentStep === 1 && <Step1Origin      state={state} patch={patch} language={language} />}
        {currentStep === 2 && <Step2Service     state={state} patch={patch} language={language} />}
        {currentStep === 3 && <Step3Destination state={state} patch={patch} language={language} />}
        {currentStep === 4 && <Step4PaxVehicle  state={state} patch={patch} language={language} />}
        {currentStep === 5 && <Step5DateOptions state={state} patch={patch} language={language} />}
        {currentStep === 6 && <Step6Quote       quote={quote} state={state}      language={language} />}
      </div>

      {/* 네비게이션 */}
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
        {currentStep === 6 && onComplete && (
          <button
            type="button"
            onClick={() => onComplete(state)}
            disabled={!canAdvance()}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#0070BA' }}
          >
            {i18n.payProceed}
          </button>
        )}
      </div>
    </div>
  );
}

export default CharterWizard;
