import { useState, useRef, useEffect } from 'react';
import { Send, MapPin, Users, Calendar, Sparkles, Wand2 } from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';

export function WizardForm({ onSubmit, isLoading }: any) {
  const [messages, setMessages] = useState<{role: 'ai'|'user', text: string}[]>([
    { role: 'ai', text: '안녕하세요! 코코트립의 수석 플래너 AI 입니다.\n어디로 떠나시나요? 인원수, 원하시는 여행 테마나 구체적인 날짜 등 아시는 만큼 모두 편하게 구어체로 적어주세요!' }
  ]);
  const [input, setInput] = useState('');
  const [loadingReply, setLoadingReply] = useState(false);
  
  const [extracted, setExtracted] = useState<any>({
    destination: null,
    durationDays: null,
    pax: null,
    preferences: []
  });
  
  const [isComplete, setIsComplete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingReply]);

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loadingReply) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoadingReply(true);

    try {
      const history = messages.slice(1).map(m => m.text).join('\n---\n');
      const res = await fetch('/.netlify/functions/ai-chat-extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history, currentExtracted: extracted })
      });
      const data = await res.json();
      
      if (data.extracted) {
        setExtracted(data.extracted);
        if (data.isComplete) {
           setIsComplete(true);
        }
      }
      
      setMessages(prev => [...prev, { role: 'ai', text: data.reply || "이해했습니다! 계속해서 대화를 이어나갈까요?" }]);
      
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: "네트워크 오류가 발생했습니다. 다시 말씀해 주시겠어요?" }]);
    }
    setLoadingReply(false);
  }

  function handleFinalSubmit() {
    // Generate dates based on durationDays (placeholder logic as we don't naturally fetch exact Date strings in this simple mock)
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + (extracted.durationDays || 3));

    const formValues: PlannerFormValues = {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      regions: [extracted.destination || 'Seoul'],
      categories: extracted.preferences || [],
      transport: 'staria',
      pax: extracted.pax || 2,
      durationDays: extracted.durationDays || 3,
      freeText: messages.map(m => m.text).join('\n')
    };
    onSubmit(formValues);
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* 왼쪽: 대화창 */}
      <div className="flex-1 flex flex-col bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] rounded-2xl overflow-hidden h-[500px]">
        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((m, i) => (
             <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-4 text-sm leading-relaxed ${
                  m.role === 'user' 
                    ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] rounded-[18px_18px_4px_18px] text-white shadow-lg' 
                    : 'bg-[#1a1a2e] border border-white/10 rounded-[18px_18px_18px_4px] text-white/90'
                }`}>
                  {m.text.split('\n').map((line, l) => <p key={l}>{line}</p>)}
                </div>
             </div>
          ))}
          {loadingReply && (
            <div className="flex justify-start">
               <div className="bg-[#1a1a2e] border border-white/10 rounded-[18px_18px_18px_4px] p-4 flex gap-1.5">
                  <div className="w-1.5 h-1.5 bg-[#7C5CFC] rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-[#EA537E] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                  <div className="w-1.5 h-1.5 bg-[#7C5CFC] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
               </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-black/40 border-t border-[rgba(255,255,255,0.05)]">
          <form onSubmit={handleSend} className="flex gap-2 relative">
            <input 
              type="text" 
              value={input} 
              onChange={e => setInput(e.target.value)}
              placeholder="제주도로 4명이서 며칠 쉬다 올래!"
              disabled={isLoading || loadingReply}
              className="flex-1 bg-white/5 border border-white/10 text-white placeholder-white/40 rounded-full px-5 py-3 focus:outline-none focus:border-[#7C5CFC]"
            />
            <button 
              type="submit"
              disabled={!input.trim() || isLoading || loadingReply}
              className="absolute right-1 top-1 w-[40px] h-[40px] rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] flex items-center justify-center text-white disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* 오른쪽: 상태 보드 및 제출 패널 */}
      <div className="w-full md:w-[280px] flex flex-col gap-4">
        <div className="bg-[#0f111a] border border-[#7C5CFC]/30 rounded-2xl p-5 shadow-[0_0_20px_rgba(124,92,252,0.15)] flex-1">
           <h3 className="text-white/80 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
             <Wand2 className="w-4 h-4 text-[#EA537E]" /> 판별된 정보
           </h3>
           
           <div className="space-y-4">
             <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <span className="flex items-center gap-1.5 text-[11px] text-white/40 mb-1"><MapPin className="w-3 h-3"/> 목적지</span>
                <span className="text-sm text-white font-bold">{extracted.destination || '-'}</span>
             </div>
             <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <span className="flex items-center gap-1.5 text-[11px] text-white/40 mb-1"><Calendar className="w-3 h-3"/> 여행일수</span>
                <span className="text-sm text-white font-bold">{extracted.durationDays ? `${extracted.durationDays}일` : '-'}</span>
             </div>
             <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <span className="flex items-center gap-1.5 text-[11px] text-white/40 mb-1"><Users className="w-3 h-3"/> 인원</span>
                <span className="text-sm text-white font-bold">{extracted.pax ? `${extracted.pax}명` : '-'}</span>
             </div>
             <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <span className="flex items-center gap-1.5 text-[11px] text-white/40 mb-1"><Sparkles className="w-3 h-3"/> 선호 테마</span>
                <span className="text-sm text-[#EA537E] font-bold">
                  {extracted.preferences?.length > 0 ? extracted.preferences.join(', ') : '-'}
                </span>
             </div>
           </div>
        </div>
        
        {isComplete && (
          <button 
            onClick={handleFinalSubmit}
            disabled={isLoading}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold tracking-wide shadow-[0_0_15px_rgba(234,83,126,0.3)] hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
          >
             {isLoading ? "일정 생성 중..." : "매직 플랜 생성하기"}
          </button>
        )}
      </div>
    </div>
  );
}
