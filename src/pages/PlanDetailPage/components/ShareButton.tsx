// ShareButton: Web Share API + clipboard fallback + public/private toggle.
// Main ShareButton for OutroSlide, ShareMiniIcon for IntroSlide.
import { useState } from 'react';
import { Share2, Link2, Globe, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { trackShare } from '@/lib/analytics';
import { toast } from 'sonner';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';

interface ShareButtonProps {
  planId: string;
  plan: PlanDocument;
  isOwner: boolean;
}

/** Fire-and-forget share reward call */
async function claimShareReward(
  userId: string,
  planId: string,
  shareMethod: string,
  rewardLabel: string,
) {
  try {
    const res = await fetch('/api/loyalty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'earn-share',
        userId,
        planId,
        shareMethod,
      }),
    });
    const data = await res.json();
    if (data.success && !data.alreadyRewarded) {
      toast.success(rewardLabel || '+20 Trip Coins earned!');
    }
  } catch (e) {
    console.warn('[ShareButton] reward error:', e);
    // 리워드 실패해도 공유 자체는 성공 — 조용히
  }
}

export function ShareButton({ planId, plan, isOwner }: ShareButtonProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const pd = getPlanDetailDict(t);
  const sh = pd.share || {};
  const [isPublic, setIsPublic] = useState<boolean>(plan?.isPublic || false);
  const [toggling, setToggling] = useState(false);

  const shareUrl = `https://cocotripkr.com/my-plans/${planId}?shared=1`;

  const handleShare = async () => {
    const title = plan?.itinerary?.tour_title || 'Korea Trip';
    let shareMethod = '';

    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        trackShare('native', planId);
        shareMethod = 'native';
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') console.warn('[ShareButton] share error:', e);
        return; // 사용자 취소/실패 시 포인트 지급 X
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(sh.shareSuccess || 'URL copied!');
        trackShare('clipboard', planId);
        shareMethod = 'clipboard';
      } catch {
        toast.error('Failed to copy URL');
        return;
      }
    }

    // 리워드 지급 (fire-and-forget, 소유자만)
    if (isOwner && user?.uid && shareMethod) {
      claimShareReward(user.uid, planId, shareMethod, sh.shareReward);
    }
  };

  const handleToggle = async (checked: boolean) => {
    if (!isOwner || toggling) return;
    setToggling(true);
    try {
      await updateDoc(doc(db, 'plans', planId), { isPublic: checked });
      setIsPublic(checked);
      toast.success(checked
        ? (sh.sharePublic || 'Public')
        : (sh.sharePrivate || 'Private')
      );
    } catch (e) {
      console.error('[ShareButton] toggle error:', e);
      toast.error('Failed to update');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Public/Private Toggle - owner only */}
      {isOwner && (
        <div className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-3">
            {isPublic
              ? <Globe className="w-5 h-5 text-[#7C5CFC]" />
              : <Lock className="w-5 h-5 text-white/40" />
            }
            <div>
              <p className="text-sm font-semibold">
                {isPublic ? (sh.sharePublic || 'Public') : (sh.sharePrivate || 'Private')}
              </p>
              <p className="text-xs text-white/40">
                {isPublic
                  ? (sh.togglePublicConfirm || 'Anyone with the link can view')
                  : (sh.privateNotice || 'Only you can view this plan')
                }
              </p>
            </div>
          </div>
          <Switch
            checked={isPublic}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />
        </div>
      )}

      {/* Share Button */}
      <button
        onClick={handleShare}
        disabled={isOwner && !isPublic}
        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-[#7C5CFC]/30 bg-[#7C5CFC]/10 hover:bg-[#7C5CFC]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Share2 className="w-5 h-5 text-[#7C5CFC]" />
        {sh.shareButton || 'Share'}
      </button>
    </div>
  );
}

// Mini icon for IntroSlide
export function ShareMiniIcon({ planId, plan }: { planId: string; plan: PlanDocument }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const sh = (getPlanDetailDict(t).share || {}) as Record<string, string>;

  const handleShare = async () => {
    const shareUrl = `https://cocotripkr.com/my-plans/${planId}?shared=1`;
    const title = plan?.itinerary?.tour_title || 'Korea Trip';
    let shareMethod = '';

    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        trackShare('native_mini', planId);
        shareMethod = 'native_mini';
      } catch { /* AbortError ok */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(sh.shareSuccess || 'URL copied!');
        trackShare('clipboard_mini', planId);
        shareMethod = 'clipboard_mini';
      } catch { /* ok */ }
    }

    // 리워드 지급 (소유자만 — plan.uid == user.uid)
    if (user?.uid && plan?.uid === user.uid && shareMethod) {
      claimShareReward(user.uid, planId, shareMethod, sh.shareReward);
    }
  };

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] transition-colors ml-2"
      aria-label="Share"
    >
      <Link2 className="w-4 h-4 text-white/50" />
    </button>
  );
}
