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

export default function Privacy() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#1a1a2e] mb-8 sm:mb-12">개인정보처리방침</h1>
          
          <PageSection title="제1조 (수집하는 개인정보의 항목)">
            <p>'코코트립'은(는) 원활한 고객 상담 및 서비스 제공을 위해 아래와 같은 개인정보를 수집하고 있습니다.</p>
            <ul className="list-disc list-inside space-y-2">
              <li>필수항목: 성명, 연락처(전화번호), 이메일 주소</li>
              <li>선택항목: (공항 픽업 시) 항공편명, 기타 요청사항</li>
              <li>자동수집: 서비스 이용 기록, 접속 로그, 쿠키, 접속 IP 정보</li>
            </ul>
          </PageSection>

          <PageSection title="제2조 (개인정보의 처리 목적)">
            <p>'회사'는 수집한 개인정보를 다음의 목적을 위해 활용합니다.</p>
            <ul className="list-disc list-inside space-y-2">
              <li>여행 서비스 제공에 관한 계약 이행 및 요금 정산</li>
              <li>고객 상담, 불만 처리 등 원활한 의사소통 경로 확보</li>
              <li>신규 서비스 개발 및 맞춤 서비스 제공, 이벤트 정보 안내</li>
            </ul>
          </PageSection>

          <PageSection title="제3조 (개인정보의 보유 및 이용 기간)">
            <p>원칙적으로, 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 관계법령의 규정에 의하여 보존할 필요가 있는 경우 '회사'는 아래와 같이 관계법령에서 정한 일정한 기간 동안 회원정보를 보관합니다.</p>
             <ul className="list-disc list-inside space-y-2">
              <li>계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)</li>
              <li>대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)</li>
              <li>소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래 등에서의 소비자보호에 관한 법률)</li>
            </ul>
          </PageSection>

          <PageSection title="제4조 (개인정보 보호책임자)">
            <p>'회사'는 고객의 개인정보를 보호하고 개인정보와 관련한 불만을 처리하기 위하여 아래와 같이 관련 부서 및 개인정보 보호책임자를 지정하고 있습니다.</p>
            <ul className="list-none space-y-2">
              <li><strong>보호책임자:</strong> Kim Hyemi</li>
              <li><strong>이메일:</strong> cocotripkr@gmail.com</li>
            </ul>
            <p>기타 개인정보침해에 대한 신고나 상담이 필요하신 경우에는 아래 기관에 문의하시기 바랍니다.</p>
            <ul className="list-disc list-inside space-y-2">
                <li>개인정보침해신고센터 (privacy.kisa.or.kr / 국번없이 118)</li>
                <li>대검찰청 사이버수사과 (www.spo.go.kr / 국번없이 1301)</li>
                <li>경찰청 사이버안전국 (cyberbureau.police.go.kr / 국번없이 182)</li>
            </ul>
          </PageSection>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
