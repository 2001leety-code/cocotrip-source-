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

export default function Privacy() {
  const language = 'en';
  const t = translations.en;
  const noop = () => {};

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={noop} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">Privacy Policy</h1>
          
          <PageSection title="Article 1 (Collected Personal Information)">
            <p>'COCOTRIP' is collecting the following personal information to provide smooth customer consultation and services.</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Required Items: Full name, contact number (phone number), email address</li>
              <li>Optional Items: (For airport pickup) Flight number, other additional requests</li>
              <li>Automatically Collected: Service use record, access log, cookie, access IP information</li>
            </ul>
          </PageSection>

          <PageSection title="Article 2 (Purpose of Processing Personal Information)">
            <p>'The Company' uses the collected personal information for the following purposes:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Implementation of contracts related to providing travel services and payment settlement</li>
              <li>Securing smooth communication channels such as customer consultation and complaint handling</li>
              <li>Developing new services, providing customized services, and guidance on event information</li>
            </ul>
          </PageSection>

          <PageSection title="Article 3 (Retention and Use Period of Personal Information)">
            <p>In principle, after the purpose of collecting and using personal information is achieved, the information is destroyed without delay. However, if it is necessary to preserve it according to the provisions of relevant laws, 'the Company' keeps member information for a certain period set by the relevant laws as follows:</p>
             <ul className="list-disc list-inside space-y-2">
              <li>Records on contracts or withdrawal of subscription: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)</li>
              <li>Records on payment and supply of goods: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)</li>
              <li>Records on consumer complaints or dispute handling: 3 years (Act on Consumer Protection in Electronic Commerce, etc.)</li>
            </ul>
          </PageSection>

          <PageSection title="Article 4 (Personal Information Protection Officer)">
            <p>'The Company' has designated relevant departments and personal information protection officers as follows to protect customers' personal information and handle complaints related to personal information.</p>
            <ul className="list-none space-y-2">
              <li><strong>Protection Officer:</strong> Kim Hyemi</li>
              <li><strong>Email:</strong> cocotripkr@gmail.com</li>
            </ul>
            <p>If you need advice or report other privacy infringements, please contact the following organizations:</p>
            <ul className="list-disc list-inside space-y-2">
                <li>Privacy Infringement Reporting Center (privacy.kisa.or.kr / 118)</li>
                <li>Cyber Investigation Department of the Supreme Prosecutor's Office (www.spo.go.kr / 1301)</li>
                <li>Cyber Safety Bureau of the National Police Agency (cyberbureau.police.go.kr / 182)</li>
            </ul>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
