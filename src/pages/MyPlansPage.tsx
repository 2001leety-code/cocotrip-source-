import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Calendar, ChevronRight, Sparkles, Plane } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';

interface PlanRef {
  id: string;
  planId: string;
  createdAt: string;
  status: 'ready' | 'generating';
  tourTitle?: string;
  startDate?: string;
  area?: string;
  pax?: number;
}

export default function MyPlansPage() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const p = t.planner as unknown as Record<string, string>;
  const [plans, setPlans] = useState<PlanRef[]>([]);
  const [loading, setLoading] = useState(true);

  usePageMeta({
    title: 'My Plans — AI Travel Itineraries',
    description: 'View and manage your AI-generated Korea travel itineraries.',
  });

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'users', user.uid, 'plans'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlanRef)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user?.uid]);

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="max-w-3xl mx-auto px-4 py-12 pt-24">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{p.my_plans || 'My Plans'}</h1>
            <p className="text-sm text-white/40">{user?.displayName || user?.email || ''}</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 animate-pulse">
                <div className="h-5 bg-white/10 rounded w-48 mb-3" />
                <div className="h-3 bg-white/6 rounded w-32" />
              </div>
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-20">
            <Sparkles className="w-12 h-12 text-[#7C5CFC]/40 mx-auto mb-4" />
            <p className="text-lg font-semibold text-white/60 mb-2">No plans yet</p>
            <p className="text-sm text-white/30 mb-6">Create your first AI-powered Korea itinerary</p>
            <Link to="/planner"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
              <Sparkles className="w-4 h-4" /> Start Planning
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map(plan => (
              <Link key={plan.id} to={`/my-plans/${plan.planId}`}
                className="block bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 hover:border-[#7C5CFC]/30 transition-all group">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        plan.status === 'ready' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {plan.status === 'ready' ? '✓ Ready' : '⏳ Generating'}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">
                      {plan.tourTitle || `Plan #${plan.planId.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-white/30 mt-1 flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      {plan.startDate || new Date(plan.createdAt).toLocaleDateString()}
                      {plan.area && <span>· {plan.area}</span>}
                      {plan.pax && <span>· {plan.pax} pax</span>}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-[#7C5CFC] transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
