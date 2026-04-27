// 플랜 생성 완료 후 사이드 이펙트 — Telegram 운영 알림 + Web Push.
// ai-planner-full.js에서 호출. 모두 non-blocking.
import { sendPushToUser } from './_send-push.js';
import { sendMessage } from './_telegram.js';

const TITLES = {
  ko: '✈️ 여행 일정 준비 완료!',
  en: '✈️ Your itinerary is ready!',
  ja: '✈️ 旅程が完成しました！',
  zh: '✈️ 您的行程已准备好！',
};
const BODIES = {
  ko: '맞춤 일정 — 지금 바로 확인하세요',
  en: 'Your custom itinerary — open to view',
  ja: 'カスタム旅程 — 今すぐご確認ください',
  zh: '专属行程 — 立即查看',
};

/** 사용자에게 plan-ready 푸시 알림 1회 발송. */
export async function sendPlanReadyPush(adminDb, uid, ctx) {
  if (!uid) return { skipped: 'no-uid' };
  const lng = TITLES[(ctx.language || 'ko').slice(0, 2)] ? (ctx.language || 'ko').slice(0, 2) : 'ko';
  const body = ctx.tourTitle ? `${ctx.tourTitle} — ${BODIES[lng].split(' — ')[1] || ''}` : BODIES[lng];
  try {
    return await sendPushToUser(adminDb, uid, {
      title: TITLES[lng], body,
      url: ctx.planUrl || `/plans/${ctx.planId}`,
      tag: `plan-ready-${ctx.planId}`,
    });
  } catch (e) { console.warn('[plan-ready-push] error:', e.message); return { error: e.message }; }
}

/** Telegram 운영 채널에 plan 생성 알림. */
export async function sendPlanCreatedTelegram(ctx) {
  try {
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    await sendMessage(
      `🎯 <b>AI 플랜 생성 완료</b>\n\n고객: ${ctx.guestName || '미입력'}\n이메일: ${ctx.email || '-'}\n` +
      `지역: ${ctx.area}\n일수: ${ctx.durationDays}일\n인원: ${ctx.pax}명\nPlan ID: <code>${ctx.planId}</code>\n\n⏰ ${kst}`
    );
  } catch (e) { console.warn('[plan-telegram] error:', e.message); }
}

export default { sendPlanReadyPush, sendPlanCreatedTelegram };
