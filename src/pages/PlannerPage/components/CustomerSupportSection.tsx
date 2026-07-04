import type { PlannerDict } from '../types';
// Customer support section -- extracted verbatim from legacy PlannerPage.tsx L997-1047.
import { MessageSquare, CreditCard, Ban, Phone } from 'lucide-react';
import type { CustomerSupport } from '../types';

export function CustomerSupportSection({ cs, p }: { cs?: CustomerSupport; p: PlannerDict }) {
  if (!cs) return null;
  return (
    <div className="bg-[#1A233A]/80 border border-[#C4956A]/30 rounded-xl p-3.5 mt-3 sm:rounded-2xl sm:p-6 sm:mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-white text-lg flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#C4956A]" /> {p.csSectionTitle}
        </h3>
      </div>
      
      <p className="text-sm text-white/80 leading-relaxed mb-6 italic border-l-2 border-[#C4956A] pl-3">"{cs.greetingMessage}"</p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/5">
          <p className="text-xs text-[#C4956A] uppercase tracking-wider font-bold mb-2 flex items-center gap-1"><CreditCard className="w-4 h-4"/> {p.csPaymentPolicy}</p>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{cs.paymentPolicy}</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/5">
          <p className="text-xs text-[#C4956A] uppercase tracking-wider font-bold mb-2 flex items-center gap-1"><Ban className="w-4 h-4"/> {p.csCancelPolicy}</p>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{cs.cancellationPolicy}</p>
        </div>
      </div>

      <div className="bg-[rgba(3,199,90,0.05)] border border-[#03C75A]/20 rounded-xl p-4 mb-6">
        <p className="text-xs text-[#03C75A] font-bold mb-2 flex items-center gap-1"><MessageSquare className="w-4 h-4" /> {p.csBotTitle}</p>
        <p className="text-[11px] text-white/60 mb-3 block">{p.csBotDesc}</p>
        
        {cs.chatbotResponses && (
          <div className="mb-3 p-3 bg-white/5 rounded-lg border border-white/10">
            <p className="text-xs text-white/55 mb-1">{p.csBotWelcome}</p>
            <p className="text-sm text-[#03C75A]/90">{cs.chatbotResponses.welcome}</p>
          </div>
        )}

        <div className="space-y-2">
          {cs.chatbotResponses?.faqs?.map((faq, i) => (
            <div key={i} className="pl-3 border-l text-sm">
              <p className="font-semibold text-white/80">Q: {faq.q}</p>
              <p className="text-white/60 mt-1">A: {faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-white/55 p-3 bg-black/20 rounded-xl">
        <p className="flex items-center gap-1 font-semibold text-white/50"><Phone className="w-3.5 h-3.5" /> {p.csEmergencyContact}</p>
        <p>{cs.contactInfo}</p>
      </div>
    </div>
  );
}
