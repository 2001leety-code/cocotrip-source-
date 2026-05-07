import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Calendar, BarChart3, Truck, MessageSquare, DollarSign, Filter, Star, Wallet, ArrowLeft } from 'lucide-react';
import DispatchTimeline from '@/components/admin/DispatchTimeline';
import TelegramLogs from '@/components/admin/TelegramLogs';
import ProfitSettlement from '@/components/admin/ProfitSettlement';
import ConversionFunnel from '@/components/admin/ConversionFunnel';
import ReviewManagement from '@/components/admin/ReviewManagement';

const TABS = [
  { id: 'dispatch', label: '배차 타임라인', icon: Truck },
  { id: 'telegram', label: '텔레그램 로그', icon: MessageSquare },
  { id: 'profit', label: '순수익 정산', icon: DollarSign },
  { id: 'funnel', label: '전환 퍼널', icon: Filter },
  { id: 'review', label: '리뷰 / CS', icon: Star },
] as const;

type TabId = typeof TABS[number]['id'];

export default function AdminOpsHub() {
  const [activeTab, setActiveTab] = useState<TabId>('dispatch');

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-20 px-4 pb-12 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* 어드민 홈 링크 */}
        <div className="mb-4">
          <Link to="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]">
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>어드민 홈으로</span>
          </Link>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Truck className="w-6 h-6 text-[#FBBF24]" />
              운영 관리 허브
            </h1>
            <p className="text-gray-400 text-sm mt-1">배차, 정산, 리뷰, CS를 한곳에서 관리하세요.</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link to="/admin/payments" className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-lg text-sm font-medium transition-colors text-amber-200 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> PayPal 결제
            </Link>
            <Link to="/admin/calendar" className="px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> 캘린더
            </Link>
            <Link to="/admin/analytics" className="px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> 통계
            </Link>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1 scrollbar-none">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-[#FBBF24] text-black shadow-lg shadow-[#FBBF24]/20'
                  : 'bg-[#12131C] text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'dispatch' && <DispatchTimeline />}
          {activeTab === 'telegram' && <TelegramLogs />}
          {activeTab === 'profit' && <ProfitSettlement />}
          {activeTab === 'funnel' && <ConversionFunnel />}
          {activeTab === 'review' && <ReviewManagement />}
        </motion.div>
      </div>
    </div>
  );
}
