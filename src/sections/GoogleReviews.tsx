import { Star, ExternalLink, ShieldCheck, Headset, MapPin } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { MotionSection } from '@/components/MotionSection';

// NOTE: We do NOT display any aggregate rating, review count, or fabricated
// guest testimonials. Inventing an aggregate score, a review count, or
// fake names is false social proof and carries legal/consumer-protection risk.
// Until a real review data source is wired up, this section is purely an
// invitation to leave a genuine review on Google plus truthful, verifiable
// trust signals (licensed operator, English support, private guide).
const GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=cocotrip+korea+reviews';

export function GoogleReviews() {
  const { t } = useLanguage();
  const gr = (t as any).googleReviews || {};

  const trustSignals = [
    { icon: ShieldCheck, label: gr.trustLicensed || 'Licensed tour operator' },
    { icon: Headset, label: gr.trustSupport || '24/7 English support' },
    { icon: MapPin, label: gr.trustPrivate || 'Private guide & van' },
  ];

  return (
    <MotionSection className="py-20 overflow-hidden">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
          <span className="text-[#4285F4]">G</span>
          <span className="text-[#EA4335]">o</span>
          <span className="text-[#FBBC05]">o</span>
          <span className="text-[#4285F4]">g</span>
          <span className="text-[#34A853]">l</span>
          <span className="text-[#EA4335]">e</span>
          <span className="text-white ml-4 font-bold">{gr.reviewsLabel || 'Reviews'}</span>
        </h2>
        <p className="text-white/60 text-lg max-w-xl mx-auto">
          {gr.subtitle || 'Travelled with us? Share your honest experience on Google to help future guests.'}
        </p>

        {/* Truthful, verifiable trust signals (no ratings, no review counts) */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {trustSignals.map((signal) => {
            const Icon = signal.icon;
            return (
              <div
                key={signal.label}
                className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md shadow-sm"
              >
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#B668FC] to-[#FF6B9D] flex items-center justify-center">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-white/80 text-sm font-medium">{signal.label}</span>
              </div>
            );
          })}
        </div>

        {/* Call to action - leave a genuine review on Google */}
        <div className="mt-12">
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#B668FC] bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white px-8 py-4 rounded-full font-bold hover:from-[#FF6B9D] hover:to-[#B668FC] transition-all group shadow-xl"
          >
            <Star className="w-4 h-4 fill-white" />
            {gr.leaveReview || 'Review us on Google'}
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </MotionSection>
  );
}
