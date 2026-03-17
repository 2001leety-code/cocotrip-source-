import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
        <Services t={t} />
        <Regions t={t} />
        <CustomerGallery />
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
        <Route path="/booking" element={<Booking />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
