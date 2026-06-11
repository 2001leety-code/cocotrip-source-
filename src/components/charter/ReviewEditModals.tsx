// ReviewEditModals — 결제 전 예약정보 검수 단계의 필드별 인라인 편집 모달.
//
// 2026-06-11: 운영자 비전 ② "입력 후 예약정보 한 번 더 띄워 검수 → 잘못 입력한 거 수정 → 결제".
// 가격 무영향(이름/연락처/메모/항공편) + 가벼운 재계산 필드(날짜/시각)만 인라인. 가격구조(서비스/차종/
// 출발/목적지)는 위저드 재진입(onBack). 저장 시 onPatchState → CharterNewPage state patch → useQuoteCalculator 자동 재계산.
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export interface EditFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'tel' | 'date' | 'time' | 'textarea';
  value: string;
}

export function EditFieldModal({
  spec, onSave, onClose, saveLabel, cancelLabel,
}: {
  spec: EditFieldSpec;
  onSave: (value: string) => void;
  onClose: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [val, setVal] = useState(spec.value);
  useEffect(() => { setVal(spec.value); }, [spec.value, spec.key]);

  const inputCls = 'w-full rounded-xl bg-white/[0.06] border border-white/15 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#B668FC]/60';

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#0c1220] border border-white/10 rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm">{spec.label}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10" aria-label={cancelLabel}>
            <X size={16} className="text-white/50" />
          </button>
        </div>
        {spec.type === 'textarea' ? (
          <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} className={inputCls} autoFocus />
        ) : (
          <input type={spec.type} value={val} onChange={(e) => setVal(e.target.value)} className={inputCls} autoFocus />
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSave(val)} className="flex-1 py-2.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6a4ce0] text-white font-semibold text-sm transition-colors">
            {saveLabel}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white/70 text-sm transition-colors">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
