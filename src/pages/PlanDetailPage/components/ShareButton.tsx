// ShareButton: Web Share API + clipboard fallback + public/private toggle.
// Main ShareButton for OutroSlide, ShareMiniIcon for IntroSlide.
import { useState } from 'react';
import { Share2, Link2, Globe, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
import { trackShare } from '@/lib/analytics';
import { toast } from 'sonner';

interface ShareButtonProps {
  planId: string;
  plan: any;
  isOwner: boolean;
}

export function ShareButton({ planId, plan, isOwner }: ShareButtonProps) {
  const { t } = useLanguage();
  const pd = (t as any).planDetail || {};
  const sh = pd.share || {};
  const [isPublic, setIsPublic] = useState<boolean>(plan?.isPublic || false);
  const [toggling, setToggling] = useState(false);

  const shareUrl = `https://cocotripkr.com/my-plans/${planId}?shared=1`;

  const handleShare = async () => {
    const title = plan?.itinerary?.tour_title || 'Korea Trip';

    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        trackShare('native', planId);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.warn('[ShareButton] share error:', e);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(sh.shareSuccess || 'URL copied!');
        trackShare('clipboard', planId);
      } catch {
        toast.error('Failed to copy URL');
      }
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
export function ShareMiniIcon({ planId, plan }: { planId: string; plan: any }) {
  const { t } = useLanguage();
  const sh = ((t as any).planDetail || {}).share || {};

  const handleShare = async () => {
    const shareUrl = `https://cocotripkr.com/my-plans/${planId}?shared=1`;
    const title = plan?.itinerary?.tour_title || 'Korea Trip';

    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        trackShare('native_mini', planId);
      } catch { /* AbortError ok */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(sh.shareSuccess || 'URL copied!');
        trackShare('clipboard_mini', planId);
      } catch { /* ok */ }
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
