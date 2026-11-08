import { Link } from 'react-router-dom';
import { useAiPlanNotices } from '../hooks/useAiPlanNotices';
type Notice = ReturnType<typeof useAiPlanNotices>['notices'][number];
const SAFE_PLAN_ID = /^[A-Za-z0-9_-]{1,160}$/;
const CONTACT = 'https://wa.me/821087140611';
interface Props { uid: string | null | undefined; p: {aiIssuanceTitle?:string;aiIssuanceBody?:string;aiIssuanceStorageWarning?:string;aiIssuanceOpenPlan?:string;aiIssuanceOrder?:string;aiIssuanceCheckoutBlocked?:string;contactWhatsApp?:string} }
export function AiPlanIssuanceNoticePanel({ uid, p }: Props) {
  const { notices, storageUnavailable, tabHold } = useAiPlanNotices(uid);
  if (!uid && !tabHold) return null;
  // 같은 UID 의 order별 dedupe: planId 있는 쪽 > 최신 createdAt
  const byOrder = new Map<string, Notice>();
  for (const n of notices) {
    if (n.uid !== uid) continue;
    const prev = byOrder.get(n.orderId);
    const better = !prev || (!!n.planId && !prev.planId) || (!!n.planId === !!prev.planId && n.createdAt > prev.createdAt);
    if (better) byOrder.set(n.orderId, n);
  }
  if (byOrder.size === 0 && !tabHold) return null;
  return (
    <section className="ec-card mx-auto mt-4 max-w-3xl p-4" role="status" aria-live="polite">
      <h2 className="text-base font-semibold">{p.aiIssuanceTitle || 'Itinerary completion not confirmed'}</h2>
      <p className="mt-1 text-sm">{tabHold ? p.aiIssuanceCheckoutBlocked : p.aiIssuanceBody}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {Array.from(byOrder.values()).map((n) => {
          const safeId = n.planId && SAFE_PLAN_ID.test(n.planId) ? n.planId : null;
          return (
            <li key={n.orderId} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{p.aiIssuanceOrder} {n.orderId}</span>
              {safeId ? (
                <Link to={`/my-plans/${safeId}`} className="underline">{p.aiIssuanceOpenPlan || 'Open plan'}</Link>
              ) : (
                <a href={CONTACT} target="_blank" rel="noreferrer" className="underline">WhatsApp</a>
              )}
            </li>
          );
        })}
      </ul>
      <a href={CONTACT} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">{p.contactWhatsApp || 'Contact us on WhatsApp'}</a>
      {storageUnavailable && (
        <p className="mt-2 text-xs opacity-80">{p.aiIssuanceStorageWarning || 'This notice could not be saved on this device and may disappear after reload.'}</p>
      )}
    </section>
  );
}
