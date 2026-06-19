import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { useLanguage } from '@/hooks/useLanguage';
import { MotionSection } from '@/components/MotionSection';

const customers = [
  { image: '/고객사진/KakaoTalk_20250923_114705709_11.jpg', name: 'Maria from Italy', location: 'Seoul Tour', quote: 'The best way to see Seoul! Highly recommended.' },
  { image: '/고객사진/KakaoTalk_20250923_114705709_12.jpg', name: 'John & Family', location: 'Busan Coast', quote: 'Beautiful scenery and perfect arrangement for our family.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_03.jpg', name: 'Elena from Spain', location: 'Nami Island', quote: 'Safe and enjoyable solo trip experience.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_04.jpg', name: 'Kenji from Japan', location: 'DMZ Tour', quote: 'Very informative and well-organized tour.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_05.jpg', name: 'Wei from China', location: 'Jeju Island', quote: 'The local food recommendations were spot on!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_06.jpg', name: 'Anna & Tom', location: 'Seoul Night View', quote: 'A magical evening we will never forget.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_07.jpg', name: 'Michael from Canada', location: 'Danyang Paragliding', quote: 'Exhilarating experience, felt completely safe.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_08.jpg', name: 'Sophie from Germany', location: 'Korean BBQ Tour', quote: 'Delicious food and great company.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_09.jpg', name: 'Lucas from France', location: 'Ganghwa History', quote: 'Learned so much about Korean history.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_10.jpg', name: 'Emma from Australia', location: 'Busan Seafood', quote: 'The freshest seafood I have ever had.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_11.jpg', name: 'Oliver from Brazil', location: 'Gyeongbokgung', quote: 'Wearing Hanbok was the highlight of the trip.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_12.jpg', name: 'Isabella from Mexico', location: 'Chuncheon Lakes', quote: 'Such a peaceful and relaxing getaway.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_13.jpg', name: 'William from UK', location: 'Incheon Airport', quote: 'Smooth pickup and great start to the holiday.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_14.jpg', name: 'Mia from Italy', location: 'Seoul Shopping', quote: 'Found all the best spots thanks to the guide.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_15.jpg', name: 'James from USA', location: 'Jeonju Bibimbap', quote: 'Authentic taste, highly recommended.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_16.jpg', name: 'Charlotte from Canada', location: 'DMZ Tour', quote: 'A sobering but essential experience.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_17.jpg', name: 'Benjamin from Spain', location: 'Nami Island', quote: 'Beautiful autumn colors everywhere.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_18.jpg', name: 'Amelia from Japan', location: 'Gyeongju Night', quote: 'The illuminated palaces are stunning.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_19.jpg', name: 'Elijah from China', location: 'Busan Haeundae', quote: 'Great beach vibes and nightlife.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_20.jpg', name: 'Harper from France', location: 'Seoul Street Food', quote: 'So many delicious snacks to try.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_21.jpg', name: 'Alexander from Germany', location: 'Danyang Caves', quote: 'Fascinating natural formations.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_22.jpg', name: 'Evelyn from Australia', location: 'Ganghwa Luge', quote: 'Fun for the whole family!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_23.jpg', name: 'Daniel & Sarah', location: 'Incheon Chinatown', quote: 'Loved the lively atmosphere and food.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_24.jpg', name: 'Abigail from Brazil', location: 'Seoul Palaces', quote: 'Felt like stepping back in time.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_25.jpg', name: 'Matthew from Mexico', location: 'Busan Temples', quote: 'Serene and beautifully located.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_26.jpg', name: 'Elizabeth from UK', location: 'Gyeongju History', quote: 'A deeply educational tour.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_27.jpg', name: 'Jackson from USA', location: 'Jeonju Hanok', quote: 'Loved staying in a traditional house.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_28.jpg', name: 'Sofia from Italy', location: 'Nami Island', quote: 'Perfect day trip out of the city.' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_29.png', name: 'Avery from Canada', location: 'DMZ Tour', quote: 'An eye-opening journey.' },
  { image: '/고객사진/KakaoTalk_20260116_120844521.jpg', name: 'Grace from France', location: 'Seoul Food', quote: 'Can not get enough of Korean BBQ!' },
];

const CustomerCard = ({ customer, verifiedLabel }: { customer: typeof customers[0]; verifiedLabel: string }) => (
  <div className="group relative overflow-hidden rounded-2xl bg-white/[0.04] backdrop-blur-md border border-white/[0.08] hover:border-[#B668FC]/30 shadow-lg flex flex-col h-full transition-colors">
    <div className="aspect-[4/5] overflow-hidden shrink-0">
      <img
        src={customer.image}
        alt={customer.name}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    </div>
    
    <div className="p-5 flex-1 flex flex-col justify-between bg-transparent relative">
       {/* Location Badge positioned over the image overlap slightly */}
       
       <div className="mt-2">
         <p className="text-white/80 text-sm leading-snug italic mb-4 line-clamp-3 relative">
            <span className="text-2xl text-[#FF6B9D] font-serif leading-none absolute -top-1 -left-2">"</span>
            &nbsp;&nbsp;&nbsp;{customer.quote}
            <span className="text-2xl text-[#FF6B9D] font-serif leading-none absolute -bottom-3 ml-1">"</span>
         </p>
       </div>
       
       <div className="flex items-center gap-3 mt-auto pt-4 border-t border-white/[0.08]">
           <div className="w-8 h-8 rounded-full overflow-hidden bg-white/[0.08] shrink-0 border border-white/[0.15]">
             {/* Using a placeholder avatar or the main image as avatar if user avatars aren't available */}
                <img src={customer.image} alt={customer.name} loading="lazy" className="w-full h-full object-cover" />
           </div>
           <div>
               <p className="text-white font-bold text-xs">{customer.name}</p>
                <p className="text-[#FF6B9D] text-[10px] uppercase tracking-wider font-semibold">{verifiedLabel}</p>
           </div>
       </div>
    </div>
  </div>
);

export function CustomerGallery() {
  const { t } = useLanguage();
  const g = (t as any).gallery || {};
  const [emblaRef] = useEmblaCarousel({
    loop: true,
    align: 'start',
    dragFree: true,
  }, [Autoplay({ delay: 3000, stopOnInteraction: false })]);

  return (
    <MotionSection className="py-20 lg:py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16 px-4">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            {g.title || 'Our Happy Travelers'}
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            {g.subtitle || 'Real moments and stories from our guests exploring Korea'}
          </p>
          <div className="w-20 h-1 bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] mx-auto rounded-full mt-6" />
        </div>

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex -ml-4 py-4">
            {customers.map((customer, index) => (
              <div
                key={index}
                className="flex-grow-0 flex-shrink-0 w-[85%] sm:w-1/2 md:w-1/3 lg:w-1/4 pl-4 sm:pl-5 md:pl-6"
              >
                <div className="h-full">
                  <CustomerCard customer={customer} verifiedLabel={g.verifiedTraveler || 'Guest Photo'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
