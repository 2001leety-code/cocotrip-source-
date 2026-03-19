import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';

const customers = [
  { image: '/고객사진/KakaoTalk_20250923_114705709_11.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20250923_114705709_12.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_01.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_02.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_03.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_04.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_05.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_06.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_07.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_08.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_09.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_10.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_11.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_12.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_13.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_14.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_15.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_16.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_17.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_18.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_19.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_20.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_21.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_22.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_23.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_24.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_25.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_26.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_27.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_28.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308_29.png', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120843308.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120844521_01.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120844521_02.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
  { image: '/고객사진/KakaoTalk_20260116_120844521.jpg', name: 'Happy Traveler', location: 'Korea Tour', quote: 'Amazing experience with COCOTRIP!' },
];

const CustomerCard = ({ customer }: { customer: typeof customers[0] }) => (
  <div className="group relative overflow-hidden rounded-2xl bg-white shadow-lg">
    <div className="aspect-[4/5] overflow-hidden">
      <img
        src={customer.image}
        alt={customer.name}
        className="w-full h-full object-cover transition-transform duration-500"
      />
    </div>
    <div className="absolute inset-0 bg-gradient-to-t from-[#0f3460]/90 via-transparent to-transparent" />
    <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
        <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/80 shrink-0">
                <img src={customer.image} alt={customer.name} className="w-full h-full object-cover" />
            </div>
            <div>
                <p className="text-white font-semibold text-sm">{customer.name}</p>
                <p className="text-white/80 text-xs">{customer.location}</p>
            </div>
        </div>
    </div>
    <div className="absolute top-4 left-4 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-xs font-medium text-[#0f3460]">
      {customer.location}
    </div>
  </div>
);

export function CustomerGallery() {
  const [emblaRef] = useEmblaCarousel({
    loop: true,
    align: 'start',
    dragFree: true,
  }, [Autoplay({ delay: 2000, stopOnInteraction: false })]);

  return (
    <section className="py-20 lg:py-32 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16 px-4">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1a1a2e] mb-4">
            Our Happy Travelers
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Real moments from our guests exploring Korea
          </p>
          <div className="w-20 h-1 bg-[#c0b283] mx-auto rounded-full mt-6" />
        </div>

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex -ml-4">
            {customers.map((customer, index) => (
              <div
                key={index}
                className="flex-grow-0 flex-shrink-0 w-4/5 sm:w-2/5 md:w-1/3 lg:w-1/4 pl-4 sm:pl-5 md:pl-6"
              >
                <CustomerCard customer={customer} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
