import type { Language } from '@/i18n';

interface RecordedAiUsageCopy {
  locale: string;
  title: string;
  basis: string;
  today: string;
  month: string;
  recorded: string;
  partial: string;
  empty: string;
  unknown: string;
  missing: string;
  failed: string;
  emptyDetail: string;
  partialDetail: string;
  records: (count: number) => string;
  details: string;
  coverage: string;
  todayWindow: string;
  monthWindow: string;
  refreshed: string;
  latest: string;
  noLatest: string;
  limit: (count: number) => string;
  limitReached: string;
  excluded: (count: number) => string;
  timeZone: string;
}

export const adminRecordedAiUsageCopy: Record<Language, RecordedAiUsageCopy> = {
  ko: {
    locale: 'ko-KR', title: '기록된 AI 예상비용',
    basis: 'Gemini 저장 기록 기준 · 실제 청구액 아님',
    today: '오늘', month: '이번 달', recorded: '저장 기록', partial: '일부 기록',
    empty: '조회된 기록 없음', unknown: '확인 불가',
    missing: '이 응답에는 사용 기록 요약이 없습니다.',
    failed: '저장된 사용 기록을 불러오지 못했습니다.',
    emptyDetail: '조회된 기록이 없으며, 사용량이나 비용이 0이라는 뜻은 아닙니다.',
    partialDetail: '조회된 유효 기록만 표시합니다. 전체 사용 비용이 아닙니다.',
    records: (count) => `기록 ${count}건`, details: '기록 범위와 한계',
    coverage: '저장된 예상치만 합산합니다. 누락된 호출과 다른 서비스 비용은 포함되지 않으며, 실제 청구서는 연결되지 않았습니다.',
    todayWindow: '오늘 조회 기간', monthWindow: '이번 달 조회 기간',
    refreshed: '조회 시각', latest: '최근 유효 기록', noLatest: '확인된 기록 없음',
    limit: (count) => `이번 달 API 사용 기록 중 최신 ${count}개까지 확인합니다.`,
    limitReached: '조회 상한에 도달하여 더 오래된 기록이 제외됐습니다.',
    excluded: (count) => `합산 대상이 아니거나 유효하지 않은 기록 ${count}개 제외`,
    timeZone: '모든 시각은 한국 시간(KST)입니다.',
  },
  en: {
    locale: 'en-US', title: 'Recorded AI cost estimates',
    basis: 'Stored Gemini records · Not an actual bill',
    today: 'Today', month: 'This month', recorded: 'Stored records', partial: 'Partial records',
    empty: 'No records found', unknown: 'Unavailable',
    missing: 'This response does not include a usage summary.',
    failed: 'Stored usage records could not be loaded.',
    emptyDetail: 'No records were found. This does not mean zero usage or cost.',
    partialDetail: 'Only valid records retrieved are shown, not the full usage cost.',
    records: (count) => `${count} record${count === 1 ? '' : 's'}`, details: 'Record coverage and limits',
    coverage: 'Only stored estimates are added up. Missing calls and other services are not included. Actual billing is not connected.',
    todayWindow: 'Today’s query period', monthWindow: 'This month’s query period',
    refreshed: 'Checked at', latest: 'Latest valid record', noLatest: 'No confirmed record',
    limit: (count) => `Checks up to the latest ${count} API usage records from this month.`,
    limitReached: 'The query limit was reached; older records were excluded.',
    excluded: (count) => `${count} ineligible or invalid records excluded`,
    timeZone: 'All times are Korea Standard Time (KST).',
  },
  ja: {
    locale: 'ja-JP', title: '記録済みAI利用費用の推定',
    basis: 'Geminiの保存記録に基づく推定 · 実際の請求額ではありません',
    today: '今日', month: '今月', recorded: '保存記録', partial: '一部の記録',
    empty: '取得した記録なし', unknown: '確認できません',
    missing: 'この応答には利用記録の集計がありません。',
    failed: '保存された利用記録を読み込めませんでした。',
    emptyDetail: '取得した記録がない状態です。利用量や費用がゼロという意味ではありません。',
    partialDetail: '取得した有効な記録のみを表示しています。利用費用の全額ではありません。',
    records: (count) => `記録${count}件`, details: '記録の範囲と制限',
    coverage: '保存された推定額のみを合計します。記録漏れや他サービスの費用は含まれず、実際の請求書は未連携です。',
    todayWindow: '今日の照会期間', monthWindow: '今月の照会期間',
    refreshed: '確認時刻', latest: '最新の有効な記録', noLatest: '確認済みの記録なし',
    limit: (count) => `今月のAPI利用記録のうち、最新${count}件まで確認します。`,
    limitReached: '取得上限に達したため、古い記録は除外されています。',
    excluded: (count) => `集計対象外または無効な記録${count}件を除外`,
    timeZone: '時刻はすべて韓国時間（KST）です。',
  },
  zh: {
    locale: 'zh-CN', title: '已记录的AI费用估算',
    basis: '依据Gemini存储记录 · 并非实际账单',
    today: '今天', month: '本月', recorded: '存储记录', partial: '部分记录',
    empty: '未查到记录', unknown: '无法确认',
    missing: '此响应未包含使用记录汇总。',
    failed: '无法加载已存储的使用记录。',
    emptyDetail: '未查到记录，并不代表使用量或费用为零。',
    partialDetail: '仅显示查到的有效记录，并非全部使用费用。',
    records: (count) => `${count}条记录`, details: '记录范围与限制',
    coverage: '仅汇总已存储的估算值，不包含遗漏的调用或其他服务费用。实际账单尚未连接。',
    todayWindow: '今天的查询时段', monthWindow: '本月的查询时段',
    refreshed: '查询时间', latest: '最新有效记录', noLatest: '无已确认记录',
    limit: (count) => `最多查看本月最新${count}条API使用记录。`,
    limitReached: '已达到查询上限，较早的记录未计入。',
    excluded: (count) => `已排除${count}条非汇总对象或无效记录`,
    timeZone: '所有时间均为韩国标准时间（KST）。',
  },
};
