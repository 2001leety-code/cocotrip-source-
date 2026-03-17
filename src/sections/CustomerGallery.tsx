import { useState, useEffect, useCallback } from 'react';
import { Quote, ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import useEmblaCarousel from 'embla-carousel-react';

const customers = [
  {
    image: '/customers/customer1.jpg',
    name: 'Singapore Family',
    location: 'Ganghwa Luge',
    quote: 'Amazing experience! Our guide made everything so easy and fun.',
  },
  {
    image: '/customers/customer2.jpg',
    name: 'Family from UAE',
    location: 'Nami Island',
    quote: 'Beautiful scenery and perfect arrangement for our family.',
  },
  {
    image: '/customers/customer3.jpg',
    name: 'Group from USA',
    location: 'Seoul Night View',
    quote: 'The best way to see Seoul! Highly recommended.',
  },
  {
    image: '/customers/customer4.jpg',
    name: 'Friends from Europe',
    location: 'Itaewon',
    quote: 'Unforgettable memories with COCOTRIP!',
  },
  {
    image: '/customers/customer5.jpg',
    name: 'Solo Traveler',
    location: 'Bukhansan',
    quote: 'Safe and enjoyable solo trip experience.',
  },
  {
    image: '/customers/customer6.jpg',
    name: 'Tao from Singapore',
    location: 'Seoul',
    quote: 'See you again in Korea! - Tao',
  },
  {
    image: '/customers/customer7.jpg',
    name: 'Marino from Italy',
    location: 'Seoul',
    quote: 'See you again in Korea! - Marino',
  },
  {
    image: '/customers/customer8.jpg',
    name: 'Femi from UK',
    location: 'Seoul',
    quote: 'See you again in Korea! - Femi',
  },
];

const CustomerCard = ({ customer }: { customer: typeof customers[0] }) => (
  <div className="group relative overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-xl transition-all duration-300">
    <div className="aspect-[4/5] overflow-hidden">
      <img
        src={customer.image}
        alt={customer.name}
        className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
      />
    </div>
    <div className="absolute inset-0 bg-gradient-to-t from-[#0f3460]/90 via-[#0f3460]/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
      <Quote className="w-8 h-8 text-[#c0b283] mb-3" />
      <p className="text-white text-sm mb-2 italic">\"{customer.quote}\"</p>
      <p className="text-[#c0b283] font-semibold text-sm">{customer.name}</p>
      <p className="text-white/70 text-xs">{customer.location}</p>
    </div>
    <div className="absolute top-4 left-4 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-xs font-medium text-[#0f3460]">
      {customer.location}
    </div>
  </div>
);

export function CustomerGallery() {
  const isMobile = useIsMobile();
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true, 
    align: isMobile ? 'center' : 'start',
    containScroll: 'trimSnaps',
  });
  const [currentIndex, setCurrentIndex] = useState(0);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setCurrentIndex(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi]);

  return (
    <section className="py-20 lg:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
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
                className="flex-grow-0 flex-shrink-0 pl-4 lg:pl-6"
                style={{ flexBasis: isMobile ? '85%' : 'calc(100% / 2 - 24px)' }} // Mobile: 1 card, SM: 2 cards, LG: 4 cards
              >
                <CustomerCard customer={customer} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center items-center gap-4 mt-8">
          <button onClick={scrollPrev} className="w-12 h-12 rounded-full bg-white shadow-md flex items-center justify-center text-[#0f3460] hover:bg-[#0f3460] hover:text-white transition-colors duration-300">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex gap-2">
            {Array.from({ length: Math.ceil(customers.length / (isMobile ? 1 : 2)) }).map((_, i) => (
              <div 
                key={i} 
                className={`w-2 h-2 rounded-full transition-colors duration-200 ${currentIndex === i ? 'bg-[#0f3460]' : 'bg-gray-300'}`}
              />
            ))}
          </div>
          <button onClick={scrollNext} className="w-12 h-12 rounded-full bg-white shadow-md flex items-center justify-center text-[#0f3460] hover:bg-[#0f3460] hover:text-white transition-colors duration-300">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
