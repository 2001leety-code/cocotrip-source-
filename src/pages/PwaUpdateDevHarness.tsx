import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PWAUpdatePromptView } from '@/components/PWAUpdatePrompt';
import { usePwaUpdateGuard } from '@/hooks/usePwaUpdateGuard';
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';

function Session({ scenario }: { scenario: string }) {
  const [reloads, setReloads] = useState(0);
  const [activations, setActivations] = useState(0);
  const [payment, setPayment] = useState(false);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  const { guard, state } = usePwaUpdateGuard(reload);
  const { language, changeLanguage } = useLanguage();
  const update = useCallback(async () => {
    setActivations((count) => count + 1);
    // Local simulation only: no service worker, payment provider or network call.
    window.setTimeout(guard.onNeedReload, scenario === 'slow' ? 4000 : 100);
  }, [guard, scenario]);
  useEffect(() => {
    if (scenario === 'external') {
      const timer = window.setTimeout(guard.onNeedReload, 1000);
      return () => window.clearTimeout(timer);
    }
    return guard.scheduleAutomatic(update);
  }, [guard, scenario, update]);
  return <main className="min-h-screen bg-slate-950 p-5 pb-72 text-slate-100">
    <h1 className="text-xl font-bold">업데이트 보호 · 로컬 모의검사</h1>
    <p className="mt-2 text-sm">실제 알림·결제·고객 데이터·새로고침 없음</p>
    <p className="mt-3" data-testid="reload-count">새로고침: {reloads}</p>
    <p data-testid="activation-count">활성화 요청: {activations}</p>
    <p data-testid="guard-reason">보호 상태: {state.reason || 'none'} · 준비: {String(state.ready)}</p>
    <label className="mt-4 block" htmlFor="pwa-draft">작성 중인 메모</label>
    <textarea id="pwa-draft" className="mt-1 block min-h-24 w-full max-w-xl rounded border border-slate-500 bg-slate-900 p-3" />
    <label className="my-4 flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={payment} onChange={(event) => setPayment(event.target.checked)} />가짜 결제 창</label>
    {payment && <iframe name="paypal-local-test" title="외부 통신 없는 가짜 결제 창" src="about:blank" className="h-12 w-full border border-slate-500" />}
    <label htmlFor="pwa-language">화면 언어</label>
    <select id="pwa-language" value={language} onChange={(event) => changeLanguage(event.target.value as Language)} className="ml-2 min-h-[44px] bg-slate-800 p-2">
      <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option>
    </select>
    <PWAUpdatePromptView needRefresh={scenario !== 'external'} state={state} standalone onUpdate={() => { void guard.requestManual(update); }} />
  </main>;
}
export default function PwaUpdateDevHarness() {
  const { search } = useLocation();
  const scenario = new URLSearchParams(search).get('scenario') || 'auto';
  return <Session key={search} scenario={scenario} />;
}
