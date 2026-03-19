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

export default function TravelTerms() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">여행약관</h1>
          
          <PageSection title="제1조 (목적)">
            <p>본 약관은 코코트립(이하 '회사')과 여행자가 체결한 국외여행계약의 세부 이행 및 준수사항을 정함을 목적으로 합니다. 이는 공정거래위원회의 국외여행 표준약관을 기반으로 합니다.</p>
          </PageSection>

          <PageSection title="제2조 (회사와 여행자의 의무)">
            <p>1. 회사: 회사는 여행자에게 안전하고 만족스러운 여행서비스를 제공하기 위하여 여행계획의 수립, 실행, 사후관리 등 제반 업무를 성실히 수행합니다.</p>
            <p className="pl-4 text-sm text-gray-600">
              - 상호: 코코트립 (COCOTRIP)<br />
              - 사업자등록번호: 423-88-03168<br />
              - 주소: 서울시 용산구 한강대로81길 30 B01호
            </p>
            <p>2. 여행자: 여행자는 여행자의 안전과 원활한 여행을 위하여 회사의 안내와 협조 요청에 성실히 응해야 합니다.</p>
          </PageSection>

          <PageSection title="제3조 (계약의 성립)">
            <p>여행계약은 회사가 여행자에게 예약 확인을 통지하고, 여행자가 예약금 또는 전체 여행 요금을 회사에 납부한 시점에 성립됩니다.</p>
          </PageSection>

          <PageSection title="제4조 (여행요금)">
            <p>여행요금에는 계약서에 명시된 항공료, 숙박비, 식사비, 교통비, 가이드 비용, 관광지 입장료 등이 포함됩니다. 개인적인 경비(음료, 팁, 선택관광 등)는 포함되지 않습니다.</p>
          </PageSection>

          <PageSection title="제5조 (계약해제 및 변경)">
            <p>1. 회사의 취소 및 환불 규정(이용약관 제4조)에 따라 계약을 해제할 수 있습니다.</p>
            <p>2. 천재지변, 전쟁, 정부의 명령, 항공사의 운항 중단 등 불가항력적인 사유로 여행이 불가능한 경우, 계약은 해제될 수 있으며, 이 경우 회사는 실제 소요된 비용을 제외한 금액을 환불합니다.</p>
          </PageSection>

           <PageSection title="제6조 (회사의 책임)">
            <p>회사는 회사의 고의 또는 과실로 여행자에게 손해를 끼친 경우, 그 손해를 배상할 책임을 집니다. 단, 여행자의 부주의로 인한 사고, 자유시간 중 발생한 사고, 천재지변 등 불가항력적인 사유로 인한 손해에 대해서는 책임을 지지 않습니다.</p>
          </PageSection>

          <PageSection title="제7조 (여행자의 책임)">
             <p>여행자는 자신의 고의 또는 과실로 회사 또는 타인에게 손해를 입힌 경우, 그 손해를 배상할 책임을 집니다. 여행자는 여행에 필요한 개인 서류(여권, 비자 등)를 구비해야 하며, 미비로 인한 문제 발생 시 모든 책임은 여행자에게 있습니다.</p>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
