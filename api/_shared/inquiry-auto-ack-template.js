/**
 * 자동 접수 확인 전용 결정론 템플릿.
 * 운영자가 검토해 보내는 최종 responseWorkflow 문구와 버전을 공유하지 않는다.
 */
const COPY = {
  ko: {
    subject: 'CocoTrip 문의가 접수되었습니다',
    charter: '전세 차량 문의와 여행 정보를 확인했습니다. 담당자가 차량 가능 여부와 최종 견적을 확인한 뒤 안내드리겠습니다.',
    referenceEstimate: '입력 화면의 참고 견적은 확정 금액이나 예약 확정이 아닙니다.',
    tour_custom: '맞춤 여행 문의를 확인했습니다. 담당자가 일정과 요청사항을 검토한 뒤 가능한 구성과 다음 단계를 안내드리겠습니다.',
    bus: '버스 상담 문의를 확인했습니다. 담당자가 일정, 인원, 차량 가능 여부를 검토한 뒤 안내드리겠습니다.',
    price: '가격 문의도 정상 접수됐으며, 담당자가 최종 견적을 검증한 뒤 별도 답변에 포함하겠습니다.',
    closing: '이 메일은 문의가 정상 접수됐다는 자동 확인입니다. 담당자가 내용을 검토한 뒤 별도로 답변드리겠습니다. 감사합니다.\n\nCocoTrip 팀',
  },
  en: {
    subject: 'We received your CocoTrip inquiry',
    charter: 'We received your private vehicle inquiry and trip details. A CocoTrip coordinator will verify vehicle availability and the final quote before replying.',
    referenceEstimate: 'Any reference estimate shown in the inquiry form is not a confirmed price or booking.',
    tour_custom: 'We received your custom tour inquiry. A CocoTrip coordinator will review your schedule and requests, then reply with the available options and next steps.',
    bus: 'We received your bus inquiry. A CocoTrip coordinator will review the date, group size, and vehicle availability before replying.',
    price: 'Your pricing question was also received. A coordinator will verify the final quote and include it in a separate reply.',
    closing: 'This is an automatic confirmation that your inquiry was received. A coordinator will review the details and reply separately.\n\nThank you,\nCocoTrip Team',
  },
  ja: {
    subject: 'CocoTripへのお問い合わせを受け付けました',
    charter: '専用車のお問い合わせと旅行情報を確認しました。担当者が車両の空き状況と最終見積もりを確認してからご案内します。',
    referenceEstimate: '入力画面の参考見積もりは、確定料金または予約確定ではありません。',
    tour_custom: 'オーダーメイド旅行のお問い合わせを確認しました。担当者が日程とご要望を確認し、可能なプランと次の手順をご案内します。',
    bus: 'バスのお問い合わせを確認しました。担当者が日程、人数、車両の空き状況を確認してからご案内します。',
    price: '料金についてのご質問も受け付けました。担当者が最終見積もりを確認し、別途の返信でご案内します。',
    closing: 'このメールは、お問い合わせを正常に受け付けたことをお知らせする自動確認です。担当者が内容を確認し、別途返信します。\n\nありがとうございます。\nCocoTripチーム',
  },
  zh: {
    subject: '我们已收到您的 CocoTrip 咨询',
    charter: '我们已收到您的包车咨询和行程信息。工作人员会确认车辆情况和最终报价后回复您。',
    referenceEstimate: '咨询页面显示的参考估价不代表最终价格或预订确认。',
    tour_custom: '我们已收到您的定制旅行咨询。工作人员会查看行程和需求，并回复可行方案及下一步安排。',
    bus: '我们已收到您的巴士咨询。工作人员会确认日期、人数和车辆情况后回复您。',
    price: '您的价格问题也已收到。工作人员会核实最终报价，并在后续回复中另行说明。',
    closing: '此邮件为咨询已成功提交的自动确认。工作人员审核详情后会另行回复。\n\n谢谢！\nCocoTrip 团队',
  },
};

export function buildAutomaticInquiryAckTemplate(inquiry = {}) {
  const language = String(inquiry.language || '').trim().toLowerCase();
  const inquiryType = String(inquiry.vehicle || '').trim();
  const copy = COPY[language];
  if (!copy || !['charter', 'bus', 'tour_custom'].includes(inquiryType)) return null;
  const referenceEstimate = inquiryType === 'charter' && inquiry.contractVersion === 'inquiry.v2'
    ? ` ${copy.referenceEstimate}`
    : '';
  return {
    subject: copy.subject,
    body: `${copy[inquiryType]}${referenceEstimate} ${copy.price}\n\n${copy.closing}`,
    language,
  };
}
