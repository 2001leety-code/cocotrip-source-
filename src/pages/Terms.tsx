import type { ReactNode } from 'react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { translations } from '@/i18n';

const PageSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-8">
    <h2 className="text-2xl font-semibold text-[#1a1a2e] border-b-2 border-[#c0b283] pb-2 mb-4">{title}</h2>
    <div className="space-y-4 text-gray-700">{children}</div>
  </section>
);

export default function Terms() {
  const language = 'en';
  const t = translations.en;
  const noop = () => {};

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={noop} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">Terms of Service</h1>
          
          <PageSection title="Article 1 (Purpose)">
            <p>These terms and conditions aim to stipulate the conditions and procedures for using all travel-related services provided by COCOTRIP (hereinafter referred to as the 'Company').</p>
          </PageSection>

          <PageSection title="Article 2 (Booking Method)">
            <p>1. Customers can book travel services through the 'Company' website, phone, or email.</p>
            <p>2. When booking, customers must provide accurate traveler information (name, contact information, email, etc.).</p>
            <p>3. After the booking request, a 'Company' representative will check availability and provide guidance. The booking is confirmed only after payment is completed.</p>
          </PageSection>

          <PageSection title="Article 3 (Fees and Payment)">
            <p>1. Fees for all travel products follow the prices specified on the website and must be paid through designated payment methods (PayPal, bank transfer, etc.).</p>
            <p>2. Fees specify included items (vehicle, guide, entrance fees, etc.) and excluded items for each product, so please check them when booking.</p>
            <p>3. All payments must be completed before the booking is confirmed; otherwise, the booking may be automatically canceled.</p>
          </PageSection>

          <PageSection title="Article 4 (Cancellation and Refund Policy)">
            <p>Cancellations and refunds for travel services are processed according to the following regulations:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Cancellation 15 days before the travel date: Full refund</li>
              <li>Cancellation 8 to 14 days before the travel date: Refund after deducting a 10% fee of the total fee</li>
              <li>Cancellation 2 to 7 days before the travel date: Refund after deducting a 50% fee of the total fee</li>
              <li>Cancellation 1 day before or on the day of travel: No refund</li>
              <li>In case of cancellation due to force majeure such as natural disasters, it will be handled through mutual consultation.</li>
            </ul>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
