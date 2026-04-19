// Style constants and icon maps for PlannerPage -- extracted from legacy PlannerPage.tsx.
import type { ReactNode } from 'react';
import {
  Music, UtensilsCrossed, Landmark, Leaf, Snowflake, ShoppingBag, Palette,
  Car, Bus as BusIcon, TrainFront, Footprints,
  Sunrise, Sun, Moon,
} from 'lucide-react';
import { createElement } from 'react';

// Category badge classes
export const CAT_BADGE: Record<string, string> = {
  'K-pop':     'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'K-food':    'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'K-culture': 'bg-blue-500/20   text-blue-300   border-blue-500/40',
  'K-beauty':  'bg-pink-500/20   text-pink-300   border-pink-500/40',
  'nature':    'bg-green-500/20  text-green-300  border-green-500/40',
  'skiing':    'bg-cyan-500/20   text-cyan-300   border-cyan-500/40',
  'shopping':  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  'heritage':  'bg-amber-500/20  text-amber-300  border-amber-500/40',
};

// Category icons
export const CAT_ICON: Record<string, ReactNode> = {
  'K-pop': createElement(Music, { className: 'w-3.5 h-3.5' }),
  'K-food': createElement(UtensilsCrossed, { className: 'w-3.5 h-3.5' }),
  'K-culture': createElement(Landmark, { className: 'w-3.5 h-3.5' }),
  'K-beauty': createElement(Palette, { className: 'w-3.5 h-3.5' }),
  'nature': createElement(Leaf, { className: 'w-3.5 h-3.5' }),
  'skiing': createElement(Snowflake, { className: 'w-3.5 h-3.5' }),
  'shopping': createElement(ShoppingBag, { className: 'w-3.5 h-3.5' }),
  'heritage': createElement(Landmark, { className: 'w-3.5 h-3.5' }),
};

// Date formatting locales
export const DATE_LOCALE: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
};

// Transport method icons
export const TRANSPORT_ICON_MAP: Record<string, ReactNode> = {
  bus: createElement(BusIcon, { className: 'w-3.5 h-3.5' }),
  subway: createElement(TrainFront, { className: 'w-3.5 h-3.5' }),
  taxi: createElement(Car, { className: 'w-3.5 h-3.5' }),
  walk: createElement(Footprints, { className: 'w-3.5 h-3.5' }),
  charter: createElement(Car, { className: 'w-3.5 h-3.5' }),
  default: createElement(Car, { className: 'w-3.5 h-3.5' }),
};

// Meal type icons
export const MEAL_ICON_MAP: Record<string, ReactNode> = {
  breakfast: createElement(Sunrise, { className: 'w-5 h-5' }),
  lunch: createElement(Sun, { className: 'w-5 h-5' }),
  dinner: createElement(Moon, { className: 'w-5 h-5' }),
};

// Region keywords for seasonal spot filtering
export const REGION_KEYWORDS: Record<string, string[]> = {
  '\uC11C\uC6B8': ['\uC11C\uC6B8'],
  '\uACBD\uAE30': ['\uACBD\uAE30', '\uAC00\uD3C9', '\uC218\uC6D0', '\uC778\uCC9C'],
  '\uC778\uCC9C': ['\uC778\uCC9C', '\uC601\uC885'],
  '\uAC15\uC6D0': ['\uAC15\uC6D0', '\uC18D\uCD08', '\uAC15\uB989', '\uD3C9\uCC3D', '\uCD98\uCC9C', '\uD0DC\uBC31', '\uCCA0\uC6D0'],
  '\uBD80\uC0B0': ['\uBD80\uC0B0'],
  '\uACBD\uC8FC': ['\uACBD\uC8FC', '\uACBD\uBD81'],
  '\uC804\uC8FC': ['\uC804\uC8FC', '\uC804\uBD81', '\uC815\uC74D'],
  '\uC81C\uC8FC': ['\uC81C\uC8FC'],
  '\uACBD\uB0A8': ['\uACBD\uB0A8', '\uCC3D\uC6D0', '\uC9C4\uD574', '\uD558\uB3D9', '\uB0A8\uD574', '\uD568\uC591'],
  '\uCDA9\uB0A8': ['\uCDA9\uB0A8', '\uBCF4\uB839'],
  '\uB300\uAD6C': ['\uB300\uAD6C'],
  '\uAD11\uC8FC': ['\uAD11\uC8FC', '\uC804\uB0A8', '\uAD6C\uB840'],
};

// CSS keyframes for page animations
export const PAGE_STYLE = `
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.9); opacity: 0; }
}
@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slide-in-left {
  from { opacity: 0; transform: translateX(-14px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes progress-ai {
  0%  { width: 0%; }
  25% { width: 30%; }
  55% { width: 62%; }
  80% { width: 84%; }
  100%{ width: 93%; }
}
@keyframes trivia-fade {
  0%   { opacity: 0; transform: translateY(8px); }
  15%  { opacity: 1; transform: translateY(0); }
  80%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-6px); }
}
@keyframes indeterminate {
  0%   { left: -35%; right: 100%; }
  60%  { left: 100%; right: -90%; }
  100% { left: 100%; right: -90%; }
}
@keyframes indeterminate2 {
  0%   { left: -200%; right: 100%; }
  60%  { left: 107%; right: -8%; }
  100% { left: 107%; right: -8%; }
}
@keyframes day-fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

// Tour category set for filtering
export const TOUR_CATS = new Set(['\uAD00\uAD11', '\uBB38\uD654', '\uCCB4\uD5D8', '\uC790\uC5F0', '\uBB38\uD654/\uC5ED\uC0AC', '\uC561\uD2F0\uBE44\uD2F0']);
