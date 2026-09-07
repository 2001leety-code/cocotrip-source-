import { useMemo, useRef, useState } from 'react';
import type { Language } from '@/i18n';
import { OwnerControllerSetupPanel } from '@/components/OwnerControllerSetupPanel';
import { OwnerNotificationPanel } from '@/components/OwnerNotificationPanel';
import type { OwnerNotificationAdapter, OwnerNotificationSnapshot } from '@/lib/ownerNotificationSetup';

type Scenario = 'default' | 'registered' | 'denied' | 'unsupported' | 'signed-out' | 'not-configured' | 'check-failed' | 'enroll-failed' | 'pending';
const scenarios: Scenario[] = ['default', 'registered', 'denied', 'unsupported', 'signed-out', 'not-configured', 'check-failed', 'enroll-failed', 'pending'];
const button = 'min-h-[44px] rounded-lg border border-white/20 bg-[#171923] px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200';

export default function OwnerNotificationDevHarness() {
  const [scenario, setScenario] = useState<Scenario>('default');
  const [language, setLanguage] = useState<Language>('ko');
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const finishPending = useRef<(() => void) | null>(null);
  const standalone = new URLSearchParams(window.location.search).get('standalone') === '1';
  const adapter = useMemo<OwnerNotificationAdapter>(() => {
    const snapshot: OwnerNotificationSnapshot = {
      permission: scenario === 'unsupported' ? 'unsupported' : scenario === 'denied' ? 'denied' : scenario === 'registered' ? 'granted' : 'default',
      account: scenario === 'signed-out' ? 'signed_out' : 'signed_in',
      configured: scenario !== 'not-configured',
      registered: scenario === 'registered',
    };
    return {
      key: `harness:${scenario}:${revision}`,
      read: async () => {
        setHistory((items) => [...items, 'read (memory only)']);
        if (scenario === 'check-failed') throw new Error('simulated read failure');
        return { ...snapshot };
      },
      enroll: async () => {
        setHistory((items) => [...items, 'enroll (memory only)']);
        if (scenario === 'enroll-failed') return false;
        if (scenario === 'pending') await new Promise<void>((resolve) => { finishPending.current = resolve; });
        snapshot.permission = 'granted';
        snapshot.registered = true;
        return true;
      },
    };
  }, [scenario, revision]);

  return (
    <main className="min-h-screen bg-[#0a0b14] px-4 py-6 text-white">
      <div className="mx-auto max-w-2xl space-y-4">
        <header>
          <h1 className="text-xl font-bold">오너 알림 설정 · DEV 검증</h1>
          <p className="mt-2 text-sm text-slate-300">가상 상태만 사용합니다. 로그인·권한 요청·기기 등록·알림 발송 API를 호출하지 않습니다.</p>
        </header>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-300">가상 상태
            <select aria-label="가상 상태" className={button} value={scenario} onChange={(event) => {
              setScenario(event.target.value as Scenario);
              setHistory([]);
            }}>
              {scenarios.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-300">언어
            <select aria-label="언어" className={button} value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {(['ko', 'en', 'ja', 'zh'] as Language[]).map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <a className={`${button} self-end content-center`} href={`?standalone=${standalone ? '0' : '1'}`}>{standalone ? '브라우저 상태 보기' : '설치 앱 상태 보기'}</a>
          <button type="button" className={`${button} self-end`} onClick={() => { setRevision((value) => value + 1); setHistory([]); }}>가상 상태 초기화</button>
          {scenario === 'pending' && <button type="button" className={`${button} self-end`} onClick={() => finishPending.current?.()}>진행 중 등록 완료</button>}
        </div>
        <OwnerControllerSetupPanel language={language}>
          <OwnerNotificationPanel key={adapter.key} adapter={adapter} language={language} />
        </OwnerControllerSetupPanel>
        <details className="text-xs text-slate-400">
          <summary className="min-h-[44px] cursor-pointer content-center">가상 호출 기록</summary>
          <pre className="whitespace-pre-wrap">{history.join('\n') || '호출 없음'}</pre>
        </details>
      </div>
    </main>
  );
}
