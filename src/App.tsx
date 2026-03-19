import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { HeroSlider } from '@/sections/HeroSlider';
import { Services } from '@/sections/Services';
import { Regions } from '@/sections/Regions';
import { CustomerGallery } from '@/sections/CustomerGallery';
import { CTA } from '@/sections/CTA';
import { Footer } from '@/sections/Footer';
import { RegionDetail } from '@/pages/RegionDetail';
import Booking from '@/pages/Booking';
import About from '@/pages/About';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import TravelTerms from '@/pages/TravelTerms';

function HomePage() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
      />
      <main>
        <HeroSlider t={t} />
        <CustomerGallery />
        <Services t={t} />
        <Regions t={t} />
        <CTA t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/region/:regionId" element={<RegionDetail />} />
        <Route path="/booking" element={<BookingPageWrapper />} />
        <Route path="/about" element={<About />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/travel-terms" element={<TravelTerms />} />
      </Routes>
    </BrowserRouter>
  );
}

// Wrapper to handle the close action of the booking modal when accessed via route
function BookingPageWrapper() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-black/90 relative" style={{ backgroundImage: "url('/1uA0qa_반포대교(1).jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <Booking onClose={() => navigate(-1)} />
    </div>
  );
}

export default App;
