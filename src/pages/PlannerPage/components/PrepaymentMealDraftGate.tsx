import { mealDraftGuestHeaders } from '@/lib/mealDraftIdentity';
import * as React from 'react';
import { MealOptionsCard, type MealOption } from '@/components/MealOptionsCard';
import type { MealOptionLanguage } from '@/lib/mealOptionMessages';
import { authFetch } from '@/lib/authFetch';

type Draft = { id: string; revision: string | number; fingerprint: string; openingNoticeVersion?: 'meal-opening-unconfirmed-v1' };
type ReferenceMeal = { mealId: string; day: number; referenceOptions: MealOption[] };
type State = { referenceMeals?: ReferenceMeal[]; scope: string; status: 'checking' | 'verified' | 'opening_unconfirmed' | 'unknown' | 'no_feasible' | 'route_failed' | 'unauthorized'; draft?: Draft };
type Props = { input: Record<string, unknown> | null; language: string; userId: string | null; children: (draft: Draft) => React.ReactNode };
const words = {
  ko: { openingNotice: '영업시간이 미확인인 식당이 있습니다. 방문 전 매장에 운영시간·휴무일을 다시 확인해 주세요. 식당 예약이나 영업을 보장하지 않습니다. 식이 정보와 이동 경로는 별도로 확인되었습니다.', checking: '식사 가능 여부를 확인하고 있어요.', unknown: '식사 정보를 확인하지 못했어요.', no_feasible: '현재 일정에서 가능한 식사 계획을 찾지 못했어요.', route_failed: '식사 장소까지의 이동을 확인하지 못했어요.', unauthorized: '로그인 후 식사 계획을 확인해 주세요.', retry: '다시 확인' },
  en: { openingNotice: 'Opening hours for some restaurants are unconfirmed. Please check before visiting. A restaurant booking or operation is not guaranteed. Dietary information and travel routes were checked separately.', checking: 'Checking meal availability.', unknown: 'Meal information could not be confirmed.', no_feasible: 'No feasible meal plan was found for this itinerary.', route_failed: 'Travel to the meal location could not be confirmed.', unauthorized: 'Please sign in to check the meal plan.', retry: 'Check again' },
  ja: { openingNotice: '一部のレストランの営業時間は未確認です。訪問前にご確認ください。レストランの予約や営業は保証されません。食事条件と移動経路は別途確認しています。', checking: '食事の可否を確認しています。', unknown: '食事情報を確認できませんでした。', no_feasible: 'この旅程で実行可能な食事プランが見つかりませんでした。', route_failed: '食事場所への移動を確認できませんでした。', unauthorized: 'ログインして食事プランを確認してください。', retry: '再確認' },
  zh: { openingNotice: '部分餐厅的营业时间尚未确认，请在到访前核实。不保证餐厅预订或营业。饮食信息与行程路线已分别核查。', checking: '正在确认用餐安排。', unknown: '无法确认用餐信息。', no_feasible: '未找到适合此行程的可行用餐计划。', route_failed: '无法确认前往用餐地点的路线。', unauthorized: '请登录后确认用餐计划。', retry: '重新确认' },
} as const;

export function PrepaymentMealDraftGate({ input, language, userId, children }: Props) {
  const body = JSON.stringify(input);
  const scope = JSON.stringify([body, language, userId]);
  const [state, setState] = React.useState<State>({ scope: '', status: 'checking' });
  const [attempt, setAttempt] = React.useState(0);
  const text = words[language as keyof typeof words] || words.en;

  React.useEffect(() => {
    let active = true;
    if (body === 'null') {
      Promise.resolve().then(() => { if (active) setState({ scope, status: 'unknown' }); });
      return () => { active = false; };
    }
    mealDraftGuestHeaders().then((guestHeaders) => authFetch('/api/meal-plan-draft', { method: 'POST', headers: { 'Content-Type': 'application/json', ...guestHeaders }, body: JSON.stringify({ input: JSON.parse(body), language }) }))
      .then(async (response) => {
        if (response.status === 401) return { status: 'unauthorized' } as State;
        const value = await response.json() as { ok?: boolean; status?: string; draftId?: unknown; revision?: unknown; fingerprint?: unknown; referenceMeals?: ReferenceMeal[] };
        if (response.ok && value.ok === true && value.status === 'verified' && typeof value.draftId === 'string' && value.draftId && (typeof value.revision === 'string' || typeof value.revision === 'number') && typeof value.fingerprint === 'string' && value.fingerprint) {
          return { scope, status: 'verified', draft: { id: value.draftId, revision: value.revision, fingerprint: value.fingerprint } } as State;
        }
        if (response.ok && value.ok === true && value.status === 'opening_unconfirmed' && typeof value.draftId === 'string' && value.draftId && (typeof value.revision === 'string' || typeof value.revision === 'number') && typeof value.fingerprint === 'string' && value.fingerprint) {
          const referenceMeals = Array.isArray(value.referenceMeals) ? value.referenceMeals.filter((meal) => meal && Array.isArray(meal.referenceOptions)) : [];
          return { scope, status: 'opening_unconfirmed', referenceMeals, draft: { id: value.draftId, revision: value.revision, fingerprint: value.fingerprint, openingNoticeVersion: 'meal-opening-unconfirmed-v1' } } as State;
        }
        const status = ['unknown', 'no_feasible', 'route_failed'].includes(value.status || '') ? value.status as 'unknown' | 'no_feasible' | 'route_failed' : 'unknown';
        const referenceMeals = status === 'unknown' && Array.isArray(value.referenceMeals) ? value.referenceMeals.filter((meal) => meal && Array.isArray(meal.referenceOptions)) : [];
        return { scope, status, referenceMeals } as State;
      }).catch(() => ({ scope, status: 'unknown' } as State))
      .then((next) => { if (active) setState({ ...next, scope }); });
    return () => { active = false; };
  }, [scope, body, language, attempt]);

  const current: State = state.scope === scope ? state : { scope, status: 'checking' };
  if (current.status === 'verified' && current.draft) return <>{children(current.draft)}</>;
  if (current.status === 'opening_unconfirmed' && current.draft) return <div className="space-y-2">
    <div role="status" className="space-y-2 rounded-ec-md border border-ec-line bg-ec-sunken p-3 text-ec-ink">
      <p className="text-sm font-semibold">{text.openingNotice}</p>
      {current.referenceMeals?.map((meal) => <MealOptionsCard key={`${meal.day}-${meal.mealId}`} options={[]} referenceOptions={meal.referenceOptions} baselineId={null} selectedId={null} busy={false} readOnly onSelect={() => {}} status="information_unknown" lang={(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as MealOptionLanguage} />)}
    </div>
    {children(current.draft)}
  </div>;
  return <div role="status" aria-live="polite" className="space-y-2 rounded-ec-md border border-ec-line bg-ec-sunken p-3 text-ec-ink">
    <p className="text-sm">{text[current.status === 'verified' || current.status === 'opening_unconfirmed' ? 'unknown' : current.status]}</p>
    {current.status === 'unknown' && current.referenceMeals?.map((meal) => <MealOptionsCard key={`${meal.day}-${meal.mealId}`} options={[]} referenceOptions={meal.referenceOptions} baselineId={null} selectedId={null} busy={false} readOnly onSelect={() => {}} status="information_unknown" lang={(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as MealOptionLanguage} />)}
    {current.status !== 'checking' && <button type="button" onClick={() => { setState({ scope: '', status: 'checking' }); setAttempt((n) => n + 1); }} className="ec-btn ec-btn-secondary min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{text.retry}</button>}
  </div>;
}
