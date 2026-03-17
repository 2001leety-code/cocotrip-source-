import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface HeroSliderProps {
  t: any;
}

// Add mobile-specific images
const slides = [
  {
    image: '/hero-seoul.jpg',
    imageMobile: '/hero-seoul-real.jpg', 
    tag: 'slide1.tag',
    title: 'slide1.title',
    subtitle: 'slide1.subtitle',
  },
  {
    image: '/hero-busan.jpg',
    imageMobile: '/hero-busan-real.jpg',
    tag: 'slide2.tag',
    title: 'slide2.title',
    subtitle: 'slide2.subtitle',
  },
  {
    image: '/hero-gyeongju.jpg',
    imageMobile: '/hero-hanok-real.jpg',
    tag: 'slide3.tag',
    title: 'slide3.title',
    subtitle: 'slide3.subtitle',
  },
  {
    image: '/hero-danyang.jpg',
    imageMobile: '/hero-food-real.png',
    tag: 'slide4.tag',
    title: 'slide4.title',
    subtitle: 'slide4.subtitle',
  },
  {
    image: '/hero-chuncheon.jpg',
    imageMobile: '/hero-banpo.jpg',
    tag: 'slide5.tag',
    title: 'slide5.title',
    subtitle: 'slide5.subtitle',
  },
];

export function HeroSlider({ t }: HeroSliderProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const isMobile = useIsMobile();

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }, []);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  }, []);

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 10000); // Resume autoplay after manual interaction
  };

  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(nextSlide, 5000);
    return () => clearInterval(interval);
  }, [isAutoPlaying, nextSlide]);

  const getSlideContent = (slideKey: string) => {
    const keys = slideKey.split('.');
    return t.hero[keys[0]][keys[1]];
  };

  return (
    <section className="relative h-screen w-full overflow-hidden">
      {/* Slides */}
      {slides.map((slide, index) => (
        <div
          key={index}
          className={`absolute inset-0 transition-opacity duration-1000 ${
            index === currentSlide ? 'opacity-100 z-10' : 'opacity-0 z-0'
          }`}
        >
          {/* Background Image - Use mobile image if isMobile is true */}
          <div
            className="absolute inset-0 bg-cover bg-center transform transition-transform duration-[8000ms]"
            style={{
              backgroundImage: `url(${isMobile ? slide.imageMobile : slide.image})`,
              transform: index === currentSlide ? 'scale(1.05)' : 'scale(1)',
            }}
          />
          {/* Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />
        </div>
      ))}

      {/* Content */}
      <div className="relative z-20 h-full flex items-center justify-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {slides.map((slide, index) => (
            <div
              key={index}
              className={`transition-all duration-700 ${
                index === currentSlide
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-8 absolute inset-0 pointer-events-none'
              }`}
            >
              {index === currentSlide && (
                <>
                  <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-wider text-white/90 border border-white/30 rounded-full backdrop-blur-sm">
                    {getSlideContent(slide.tag)}
                  </span>
                  {/* Responsive Font Sizes */}
                  <h1 className="text-4xl md:text-6xl font-bold text-white mb-3 leading-tight whitespace-pre-line drop-shadow-lg">
                    {getSlideContent(slide.title)}
                  </h1>
                  <p className="text-base md:text-lg text-white/90 mb-8 max-w-xs md:max-w-2xl mx-auto drop-shadow-md">
                    {getSlideContent(slide.subtitle)}
                  </p>
                  <Link
                    to="/booking"
                    className="inline-flex items-center gap-2 px-6 py-3 md:px-8 md:py-3 bg-white/10 backdrop-blur-sm border border-white/30 text-white rounded-full font-medium hover:bg-white hover:text-[#0f3460] transition-all duration-300"
                  >
                    {t.hero.cta}
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Arrows - Adjusted for mobile */}
      <button
        onClick={() => {
          prevSlide();
          setIsAutoPlaying(false);
          setTimeout(() => setIsAutoPlaying(true), 10000);
        }}
        className="absolute left-2 sm:left-8 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white hover:text-[#0f3460] transition-all duration-300"
      >
        <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
      </button>
      <button
        onClick={() => {
          nextSlide();
          setIsAutoPlaying(false);
          setTimeout(() => setIsAutoPlaying(true), 10000);
        }}
        className="absolute right-2 sm:right-8 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white hover:text-[#0f3460] transition-all duration-300"
      >
        <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
      </button>

      {/* Indicators - Simplified for a cleaner look */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentSlide
                ? 'w-6 bg-white'
                : 'w-1.5 bg-white/40 hover:bg-white/60'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
