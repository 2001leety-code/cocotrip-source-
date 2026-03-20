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

export default function TravelTerms() {
  const language = 'en';
  const t = translations.en;
  const noop = () => {};

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={noop} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">Travel Terms</h1>
          
          <PageSection title="Article 1 (Purpose)">
            <p>These terms and conditions aim to stipulate the detailed implementation and compliance of overseas travel contracts concluded between COCOTRIP (hereinafter referred to as the 'Company') and travelers. This is based on the Standard Terms for Overseas Travel of the Fair Trade Commission.</p>
          </PageSection>

          <PageSection title="Article 2 (Obligations of the Company and Traveler)">
            <p>1. Company: The Company faithfully performs various tasks such as establishing, implementing, and post-managing travel plans to provide safe and satisfactory travel services to travelers.</p>
            <p className="pl-4 text-sm text-gray-600">
              - Name: COCOTRIP<br />
              - Business Registration Number: 423-88-03168<br />
              - Address: B01, 30 Hangang-daero 81-gil, Yongsan-gu, Seoul
            </p>
            <p>2. Traveler: Travelers must faithfully respond to the Company's guidance and cooperation requests for traveler safety and smooth travel.</p>
          </PageSection>

          <PageSection title="Article 3 (Formation of Contract)">
            <p>The travel contract is formed at the time the Company notifies the traveler of booking confirmation and the traveler pays the deposit or full travel fee to the Company.</p>
          </PageSection>

          <PageSection title="Article 4 (Travel Fees)">
            <p>Travel fees include airfare, accommodation, meals, transportation, guide fees, and entrance fees specified in the contract. Personal expenses (drinks, tips, optional tours, etc.) are not included.</p>
          </PageSection>

          <PageSection title="Article 5 (Contract Termination and Modification)">
            <p>1. The contract can be terminated according to the Company's Cancellation and Refund Policy (Article 4 of the Terms of Service).</p>
            <p>2. If travel is impossible due to force majeure such as natural disasters, war, government orders, or flight suspension, the contract can be terminated. In this case, the Company refunds the amount excluding actual costs incurred.</p>
          </PageSection>

           <PageSection title="Article 6 (Responsibility of the Company)">
            <p>The Company is responsible for compensation for damages if it causes damage to travelers due to the Company's intention or negligence. However, the Company is not responsible for damages caused by the traveler's negligence, accidents occurring during free time, or force majeure such as natural disasters.</p>
          </PageSection>

          <PageSection title="Article 7 (Responsibility of the Traveler)">
             <p>Travelers are responsible for compensation for damages if they cause damage to the Company or others due to their intention or negligence. Travelers must have personal documents (passport, visa, etc.) necessary for travel, and all responsibilities for problems caused by their absence lie with the traveler.</p>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
