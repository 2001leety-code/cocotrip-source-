import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useLanguage, LanguageProvider } from '@/hooks/useLanguage';
import { AuthRequired } from '@/components/AuthRequired';
import { Header } from '@/sections/Header';
import { HeroSlider } from '@/sections/HeroSlider';
import { Services } from '@/sections/Services';
import { Regions } from '@/sections/Regions';
import { CustomerGallery } from '@/sections/CustomerGallery';
import { GoogleReviews } from '@/sections/GoogleReviews';
import { CTA } from '@/sections/CTA';
import { Footer } from '@/sections/Footer';
import { RegionDetail } from '@/pages/RegionDetail';
import Booking from '@/pages/Booking';
import About from '@/pages/About';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import TravelTerms from '@/pages/TravelTerms';
import Admin from '@/pages/Admin';
import PlannerPage from '@/pages/PlannerPage';
import { AdminRoute } from '@/components/AdminRoute';
import { HeroCards } from '@/sections/HeroCards';
import CharterPage from '@/pages/CharterPage';
import { ChatWidget } from '@/components/ChatWidget';
import { EarlyBirdBanner } from '@/components/EarlyBirdBanner';
import { KpopConcertPopup } from '@/components/KpopConcertPopup';
import { handleRedirectResult } from '@/lib/firebase';

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
        <HeroCards t={t} />
        <CustomerGallery />
        <GoogleReviews />
        <Services t={t} />
        <Regions t={t} />
        <CTA t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}

function GlobalWidgets() {
  const { language } = useLanguage();

  // Google Redirect 로그인 결과 처리 (signInWithRedirect 폴백 후 페이지 복귀 시)
  useEffect(() => {
    handleRedirectResult().catch(console.error);
  }, []);

  return (
    <>
      <EarlyBirdBanner language={language} />
      <KpopConcertPopup />
      <ChatWidget language={language} />
    </>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <GlobalWidgets />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/region/:regionId" element={<RegionDetail />} />
          <Route path="/booking" element={<BookingPageWrapper />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route
            path="/charter"
            element={
              <AuthRequired>
                <CharterPage />
              </AuthRequired>
            }
          />
          <Route
            path="/planner"
            element={
              <AuthRequired>
                <PlannerPage />
              </AuthRequired>
            }
          />
          <Route path="/about" element={<About />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/travel-terms" element={<TravelTerms />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
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
