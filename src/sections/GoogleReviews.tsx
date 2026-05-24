import { Star, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const reviews = [
  {
    name: "Sarah Jenkins",
    date: "2 weeks ago",
    text: "Absolutely incredible private tour of Seoul! Our guide was so knowledgeable and tailored the entire day to our interests. The van was very comfortable and the food recommendations were amazing. 10/10!",
    rating: 5
  },
  {
    name: "Hiroshi Tanaka",
    date: "1 month ago",
    text: "Highly professional service. We booked a 3-day family package for Gyeongju and Busan. Everything was perfectly timed and the historical explanations were very deep. Best way to travel in Korea.",
    rating: 5
  },
  {
    name: "Michael Chen",
    date: "2 months ago",
    text: "COCOTRIP made our first visit to Korea so easy. From airport pickup to the DMZ tour, everything was seamless. The private tour is worth every penny for the convenience and personal touch.",
    rating: 5
  },
  {
    name: "Emma Wilson",
    date: "3 months ago",
    text: "The Hanok village tour and traditional craft experience were highlights of our trip. Our guide spoke perfect English and really helped us connect with the local culture. Thank you!",
    rating: 5
  },
  {
    name: "David Rossi",
    date: "4 months ago",
    text: "Great experience with the Danyang natural tour. The scenery was breathtaking and the organization was flawless. Professional, friendly, and very accommodating. Highly recommend!",
    rating: 5
  }
];

export function GoogleReviews() {
  const { t } = useLanguage();
  const gr = (t as any).googleReviews || {};
  return (
    <section className="py-20 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header with Google Logo Colors and Overall Rating */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-16 gap-8 text-center md:text-left">
          <div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
              <span className="text-[#4285F4]">G</span>
              <span className="text-[#EA4335]">o</span>
              <span className="text-[#FBBC05]">o</span>
              <span className="text-[#4285F4]">g</span>
              <span className="text-[#34A853]">l</span>
              <span className="text-[#EA4335]">e</span>
              <span className="text-white ml-4 font-bold">{gr.reviewsLabel || 'Reviews'}</span>
            </h2>
            <p className="text-white/60 text-lg">{gr.subtitle || 'What our global guests are saying about us'}</p>
          </div>
          
          <div className="bg-white/[0.04] backdrop-blur-md p-6 rounded-2xl flex items-center gap-6 shadow-sm border border-white/[0.08]">
            <div className="text-center">
              <div className="text-5xl font-bold text-white">5.0</div>
              <div className="flex gap-1 mt-1 justify-center">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-[#FBBC05] text-[#FBBC05]" />
                ))}
              </div>
              <div className="text-white/60 text-sm mt-2">{gr.basedOn || 'Based on 150+ reviews'}</div>
            </div>
            <div className="w-[1px] h-16 bg-white/[0.15]" />
            <a 
              href="https://www.google.com/search?q=cocotrip+korea+reviews" 
              target="_blank" 
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md">
                <svg className="w-6 h-6" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.1-1.93 3.31-4.77 3.31-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </div>
              <span className="text-xs font-bold text-white uppercase tracking-tighter">{gr.verified || 'Verified'}</span>
            </a>
          </div>
        </div>

        {/* Review Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {reviews.map((review, index) => (
            <div 
              key={index} 
              className={`p-8 rounded-2xl border border-white/[0.08] shadow-sm transition-all hover:shadow-md hover:-translate-y-1 bg-white/[0.04] backdrop-blur-md ${index >= 3 ? 'lg:flex' : ''}`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#B668FC] to-[#FF6B9D] flex items-center justify-center text-white font-bold">
                    {review.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-white">{review.name}</div>
                    <div className="text-white/40 text-xs">{review.date}</div>
                  </div>
                </div>
                <div className="flex">
                  {[...Array(review.rating)].map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-[#FBBC05] text-[#FBBC05]" />
                  ))}
                </div>
              </div>
              <p className="text-white/60 text-sm leading-relaxed line-clamp-4 italic">
                "{review.text}"
              </p>
            </div>
          ))}
        </div>

        {/* Call to Action Button */}
        <div className="mt-16 text-center">
          <a
            href="https://www.google.com/search?q=cocotrip+korea+reviews"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white px-8 py-4 rounded-full font-bold hover:from-[#FF6B9D] hover:to-[#B668FC] transition-all group shadow-xl"
          >
            {gr.seeAll || 'See all reviews on Google'}
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  );
}
