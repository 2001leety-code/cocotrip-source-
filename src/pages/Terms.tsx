import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';

const PageSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2 className="text-2xl font-semibold text-[#1a1a2e] border-b-2 border-[#c0b283] pb-2 mb-4">{title}</h2>
    <div className="space-y-4 text-gray-700">{children}</div>
  </section>
);

export default function Terms() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">이용약관</h1>
          
          <PageSection title="제1조 (목적)">
            <p>본 약관은 코코트립 (이하 '회사')이 제공하는 모든 여행 관련 서비스의 이용 조건 및 절차에 관한 사항을 규정함을 목적으로 합니다.</p>
          </PageSection>

          <PageSection title="제2조 (예약 방법)">
            <p>1. 고객은 '회사'의 웹사이트, 전화, 또는 이메일을 통해 여행 서비스를 예약할 수 있습니다.</p>
            <p>2. 예약 시, 고객은 정확한 여행자 정보(성명, 연락처, 이메일 등)를 제공해야 합니다.</p>
            <p>3. 예약 요청 후 '회사'의 담당자가 가능 여부를 확인하고 안내를 드리며, 결제가 완료되어야 예약이 확정됩니다.</p>
          </PageSection>

          <PageSection title="제3조 (요금 결제)">
            <p>1. 모든 여행 상품의 요금은 웹사이트에 명시된 바를 따르며, 지정된 결제 수단(페이팔, 계좌이체 등)을 통해 결제해야 합니다.</p>
            <p>2. 요금에는 상품별로 포함된 내역(차량, 가이드, 입장료 등)과 불포함 내역이 명시되어 있으니 예약 시 확인하시기 바랍니다.</p>
            <p>3. 모든 결제는 예약 확정 전 완료되어야 하며, 미결제 시 예약은 자동으로 취소될 수 있습니다.</p>
          </PageSection>

          <PageSection title="제4조 (취소 및 환불 규정)">
            <p>여행 서비스의 취소 및 환불은 다음 규정에 따라 처리됩니다.</p>
            <ul className="list-disc list-inside space-y-2">
              <li>여행일 15일 전 취소 시: 전액 환불</li>
              <li>여행일 8일 ~ 14일 전 취소 시: 총 요금의 10% 수수료 부과 후 환불</li>
              <li>여행일 2일 ~ 7일 전 취소 시: 총 요금의 50% 수수료 부과 후 환불</li>
              <li>여행일 1일 전 또는 당일 취소 시: 환불 불가</li>
              <li>천재지변 등 불가항력적인 사유로 인한 취소의 경우, 상호 협의하여 처리합니다.</li>
            </ul>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
