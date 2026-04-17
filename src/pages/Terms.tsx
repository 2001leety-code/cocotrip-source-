import type { ReactNode } from 'react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';

const PageSection = ({ title, children, isMobile }: { title: string; children: ReactNode; isMobile?: boolean }) => (
  <section className="mb-8">
    <h2 className={`text-xl font-semibold pb-2 mb-4 border-b-2 ${
      isMobile ? 'text-white border-[#B668FC]/30' : 'text-[#1a1a2e] border-[#c0b283]'
    }`}>{title}</h2>
    <div className={`space-y-4 text-sm leading-relaxed ${isMobile ? 'text-white/50' : 'text-gray-700'}`}>{children}</div>
  </section>
);

export default function Terms() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-[#faf9f6]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className={`container mx-auto px-4 ${isMobile ? 'pt-6 pb-4' : 'py-16 sm:py-24'}`}>
        <div className={isMobile ? '' : 'max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg'}>
          <h1 className={`text-2xl font-bold text-center mb-8 ${isMobile ? 'm-shimmer-text' : 'text-[#1a1a2e] text-3xl sm:text-4xl sm:mb-12'}`}>Terms of Service</h1>
          
          <PageSection title="Article 1 (Purpose)" isMobile={isMobile}>
            <p>These terms and conditions aim to stipulate the conditions and procedures for using all travel-related services provided by COCOTRIP (hereinafter referred to as the 'Company').</p>
          </PageSection>

          <PageSection title="Article 2 (Booking Method)" isMobile={isMobile}>
            <p>1. Customers can book travel services through the 'Company' website, phone, or email.</p>
            <p>2. When booking, customers must provide accurate traveler information (name, contact information, email, etc.).</p>
            <p>3. After the booking request, a 'Company' representative will check availability and provide guidance. The booking is confirmed only after payment is completed.</p>
          </PageSection>

          <PageSection title="Article 3 (Fees and Payment)" isMobile={isMobile}>
            <p>1. Fees for all travel products follow the prices specified on the website and must be paid through designated payment methods (PayPal, bank transfer, etc.).</p>
            <p>2. Fees specify included items (vehicle, guide, entrance fees, etc.) and excluded items for each product, so please check them when booking.</p>
            <p>3. All payments must be completed before the booking is confirmed; otherwise, the booking may be automatically canceled.</p>
          </PageSection>

          <PageSection title="Article 4 (Cancellation and Refund Policy)" isMobile={isMobile}>
            <p>Cancellations and refunds for travel services are processed according to the following regulations:</p>
            <ul className={`list-disc list-inside space-y-2 ${isMobile ? 'text-white/40' : ''}`}>
              <li>Cancellation 15 days before the travel date: Full refund</li>
              <li>Cancellation 8 to 14 days before the travel date: Refund after deducting a 10% fee of the total fee</li>
              <li>Cancellation 2 to 7 days before the travel date: Refund after deducting a 50% fee of the total fee</li>
              <li>Cancellation 1 day before or on the day of travel: No refund</li>
              <li>In case of cancellation due to force majeure such as natural disasters, it will be handled through mutual consultation.</li>
            </ul>
          </PageSection>
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
