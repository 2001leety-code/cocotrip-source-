import { mealDraftGuestHeaders } from '@/lib/mealDraftIdentity';
import * as React from 'react';
import { MealOptionsCard, type MealOption, type MealOptionsStatus } from '@/components/MealOptionsCard';
import { authFetch } from '@/lib/authFetch';
import type { MealOptionLanguage } from '@/lib/mealOptionMessages';
import type { PlanDocument } from '../types';

type Meal = { baselineInvalid?: boolean; mealId: string; day: number; status: MealOptionsStatus; baselineId: string | null; selectedId: string | null; options: MealOption[]; referenceOptions?: MealOption[] };
type Proposal = { mealId: string; candidateId: string; proposalId: string; changes: string[] };
type ResponseData = { ok?: boolean; status?: string; revision?: string | number; meals?: Meal[]; proposalId?: string; changes?: unknown[]; plan?: PlanDocument };
type Props = { planId: string; accessToken?: string | null; day: number; language: MealOptionLanguage; isOwner: boolean; onPlanSaved?: (plan?: PlanDocument) => void | Promise<void> };
const copy = {
  ko: { retry: '다시 불러오기', savedRefresh: '선택은 저장됐지만 최신 일정을 확인하지 못했어요. 다시 불러와 주세요.', error: '식사 선택 정보를 확인하지 못했어요. 다시 시도해 주세요.', readOnly: '공유 보기에서는 식당을 선택할 수 없어요.', confirm: '일정 변경 내용을 확인하고 적용할까요?', cancel: '취소', apply: '확인하고 적용', changed: '선택한 식당에 맞춰 일정이 변경될 수 있어요.' },
  en: { retry: 'Reload', savedRefresh: 'Your selection was saved, but the latest itinerary could not be loaded. Please reload.', error: 'Meal options could not be checked. Please try again.', readOnly: 'Restaurant selection is unavailable in a shared view.', confirm: 'Review and apply these itinerary changes?', cancel: 'Cancel', apply: 'Confirm and apply', changed: 'The itinerary may change for the selected restaurant.' },
  ja: { retry: '再読み込み', savedRefresh: '選択は保存されましたが、最新の旅程を取得できませんでした。再読み込みしてください。', error: '食事候補を確認できませんでした。もう一度お試しください。', readOnly: '共有表示ではレストランを選択できません。', confirm: '旅程の変更を確認して適用しますか？', cancel: 'キャンセル', apply: '確認して適用', changed: '選択したレストランに合わせて旅程が変更される場合があります。' },
  zh: { retry: '重新加载', savedRefresh: '选择已保存，但无法加载最新行程。请重新加载。', error: '无法确认用餐选项，请重试。', readOnly: '共享视图中无法选择餐厅。', confirm: '确认并应用这些行程变更吗？', cancel: '取消', apply: '确认并应用', changed: '行程可能会根据所选餐厅调整。' },
} as const;

export function PlanMealOptions({ planId, accessToken, day, language, isOwner, onPlanSaved }: Props) {
  const [meals, setMeals] = React.useState<Meal[]>([]);
  const [revision, setRevision] = React.useState<string | number | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<'failed' | 'saved_refresh' | null>(null);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);
  const generation = React.useRef(0);
  const text = copy[language] || copy.en;
  const request = React.useCallback(async (body: Record<string, unknown>): Promise<ResponseData> => {
    const guestHeaders = await mealDraftGuestHeaders();
    const res = await authFetch('/api/plan-meal-options', { method: 'POST', headers: { 'Content-Type': 'application/json', ...guestHeaders }, body: JSON.stringify({ planId, token: accessToken || undefined, ...body }) });
    const data = await res.json() as ResponseData;
    if (!res.ok || !data.ok) throw new Error('request failed');
    return data;
  }, [planId, accessToken]);

  const load = React.useCallback(async (current: number) => {
    const result = await request({ action: 'load' });
    if (generation.current !== current) return;
    if (!Array.isArray(result.meals) || result.revision === undefined) throw new Error('invalid response');
    setMeals(result.meals.filter((meal) => Number(meal.day) === day));
    setRevision(result.revision);
  }, [request, day]);

  React.useEffect(() => {
    const current = ++generation.current;
    load(current).catch(() => { if (generation.current === current) setError('failed'); })
      .finally(() => { if (generation.current === current) setBusy(false); });
    return () => { if (generation.current === current) generation.current = current + 1; };
  }, [load]);

  const reload = async () => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setProposal(null);
    try { if (error === 'saved_refresh' && onPlanSaved) await onPlanSaved(); await load(current); if (generation.current === current) setError(null); }
    catch { /* Keep the saved-vs-failed distinction until a reload succeeds. */ }
    finally { if (generation.current === current) setBusy(false); }
  };

  const commit = async (selection: Proposal, confirmed: boolean) => {
    if (!isOwner || busy || revision === null) return;
    const current = generation.current;
    setBusy(true); setError(null);
    try {
      const result = await request({ action: 'commit', mealId: selection.mealId, candidateId: selection.candidateId, baseRevision: revision, proposalId: selection.proposalId, ...(confirmed ? { confirmedProposalId: selection.proposalId } : {}) });
      if (generation.current !== current) return;
      if (result.status !== 'saved' || result.revision === undefined) throw new Error('not saved');
      setProposal(null);
      try { if (onPlanSaved) await onPlanSaved(result.plan); if (generation.current === current) await load(current); } catch { if (generation.current === current) setError('saved_refresh'); }
    } catch { if (generation.current === current) { setProposal(null); setError('failed'); } }
    finally { if (generation.current === current) setBusy(false); }
  };

  const select = async (mealId: string, candidateId: string) => {
    if (!isOwner || busy || revision === null) return;
    const current = generation.current;
    setBusy(true); setError(null); setProposal(null);
    try {
      const result = await request({ action: 'preview', mealId, candidateId, baseRevision: revision });
      if (generation.current !== current) return;
      if (!result.proposalId || !['ready', 'confirmation_required'].includes(result.status || '')) throw new Error('preview failed');
      const changes = Array.isArray(result.changes) ? result.changes.flatMap((change) => {
        if (typeof change === 'string') return [change];
        if (change && typeof change === 'object') {
          const item = change as { description?: unknown; name?: unknown };
          const label = item.description || item.name;
          return typeof label === 'string' ? [label] : [];
        }
        return [];
      }) : [];
      const next = { mealId, candidateId, proposalId: result.proposalId, changes };
      if (result.status === 'confirmation_required') setProposal(next);
      else {
        const saved = await request({ action: 'commit', mealId, candidateId, baseRevision: revision, proposalId: result.proposalId });
        if (generation.current !== current) return;
        if (saved.status !== 'saved' || saved.revision === undefined) throw new Error('not saved');
        try { if (onPlanSaved) await onPlanSaved(saved.plan); if (generation.current === current) await load(current); } catch { if (generation.current === current) setError('saved_refresh'); }
      }
    } catch { if (generation.current === current) { setProposal(null); setError('failed'); } }
    finally { if (generation.current === current) setBusy(false); }
  };

  if (!meals.length && !error) return null;
  return <div className="my-3 space-y-2">
    {error && <div role="alert" className="space-y-2 text-sm text-white"><p>{error === 'saved_refresh' ? text.savedRefresh : text.error}</p>
      <button type="button" disabled={busy} onClick={() => { void reload(); }} className="min-h-[44px] rounded-lg border border-white/30 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300 disabled:opacity-50">{text.retry}</button></div>}
    {!isOwner && meals.length > 0 && <p className="text-xs text-white/80">{text.readOnly}</p>}
    {meals.map((meal) => <MealOptionsCard key={meal.mealId} options={meal.options} referenceOptions={meal.referenceOptions} baselineId={meal.baselineId} baselineInvalid={meal.baselineInvalid} selectedId={meal.selectedId} busy={busy} readOnly={!isOwner || !!error} onSelect={(id) => { void select(meal.mealId, id); }} status={meal.status} lang={language} />)}
    {proposal && <div role="region" aria-label={text.confirm} className="rounded-lg border border-purple-300/40 bg-slate-900 p-3 text-white">
      <p className="text-sm font-medium">{text.confirm}</p>
      <p className="mt-1 text-xs text-white/80">{text.changed}</p>
      {proposal.changes.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-white/80">{proposal.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>}
      <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => setProposal(null)} className="min-h-[44px] rounded-lg border border-white/30 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300 disabled:opacity-50">{text.cancel}</button>
      <button type="button" disabled={busy} onClick={() => { void commit(proposal, true); }} className="min-h-[44px] rounded-lg border border-purple-300/40 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300 disabled:opacity-50">{text.apply}</button></div>
    </div>}
  </div>;
}
