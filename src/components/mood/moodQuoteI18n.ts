import type { Language } from '@/i18n';

export interface MoodQuoteText {
  title: string;
  subtitle: string;
  adminOnly: string;
  profileSection: string;
  profileSelect: string;
  loadingProfiles: string;
  editProfile: string;
  closeProfile: string;
  newProfile: string;
  saveProfile: string;
  savingProfile: string;
  companyName: string;
  documentTitle: string;
  footer: string;
  hourlyRate: string;
  minimumMinutes: string;
  maximumMinutes: string;
  billingIncrement: string;
  billingIncrementHint: string;
  distanceThreshold: string;
  distanceRate: string;
  distanceMode: string;
  vatRate: string;
  overtimeRate: string;
  overtimeIncludesVat: string;
  rateUnitHint: string;
  tollPolicy: string;
  parkingPolicy: string;
  modeAllAtThreshold: string;
  modeExcessOnly: string;
  modeAlways: string;
  modeNone: string;
  policyManual: string;
  policyRoute: string;
  policyIncluded: string;
  builtIn: string;
  profileSaved: string;
  inputSection: string;
  pasteLabel: string;
  pastePlaceholder: string;
  analyze: string;
  analyzing: string;
  analyzeHint: string;
  needsConfirm: string;
  moreWarnings: string;
  confirmParsedSchedule: string;
  confirmParsedScheduleRequired: string;
  tripFields: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  durationInputHint: string;
  departureAddress: string;
  departureAddressPlaceholder: string;
  returnAddress: string;
  returnAddressPlaceholder: string;
  stopSection: string;
  addStop: string;
  stop: string;
  pickup: string;
  waypoint: string;
  destination: string;
  placeName: string;
  purpose: string;
  arrivalTime: string;
  departureTime: string;
  roadAddress: string;
  jibunAddress: string;
  mapLink: string;
  optionalSchedule: string;
  includeInRoute: string;
  addressVerified: string;
  verificationReset: string;
  moveUp: string;
  moveDown: string;
  remove: string;
  searchPlace: string;
  searchPlaceholder: string;
  search: string;
  searching: string;
  searchNoResults: string;
  usePlace: string;
  quoteSection: string;
  routeMode: string;
  routeAutomatic: string;
  routeManual: string;
  manualDistance: string;
  manualToll: string;
  parking: string;
  incidentalAmountHint: string;
  generatePreview: string;
  generatingPreview: string;
  previewNeedsRefresh: string;
  previewSection: string;
  routeSummary: string;
  distance: string;
  drivingTime: string;
  timeFee: string;
  distanceFee: string;
  supplyAmount: string;
  vat: string;
  toll: string;
  parkingFee: string;
  total: string;
  overtime: string;
  minutes: string;
  copyDocument: string;
  copied: string;
  copyFailed: string;
  print: string;
  warningTitle: string;
  closeSearch: string;
  noProfile: string;
  invalidDuration: string;
  invalidManualDistance: string;
  invalidIncidentalAmounts: string;
  durationRange: string;
  needTwoStops: string;
  verifyIncludedStops: string;
  requestFailed: string;
  saveFailed: string;
  previewFailed: string;
  profileNameRequired: string;
  invalidProfileNumbers: string;
  chooseProfile: string;
  exactServerCopy: string;
}

const ko: MoodQuoteText = {
  title: '업체 차량 견적서',
  subtitle: '일정을 붙여넣고 주소를 확인하면 고객용 문서를 바로 복사할 수 있습니다.',
  adminOnly: '관리자 전용 · 실제 예약과 결제에는 연결되지 않습니다.',
  profileSection: '1. 업체와 요금표', profileSelect: '업체 선택', loadingProfiles: '업체 목록 불러오는 중…',
  newProfile: '새 업체', editProfile: '요금표 편집', closeProfile: '편집 닫기', saveProfile: '업체 저장', savingProfile: '저장 중…', companyName: '업체명',
  documentTitle: '문서 제목', footer: '하단 안내문', hourlyRate: '시간당 요금(원)',
  minimumMinutes: '최소 이용(시간)', maximumMinutes: '최대 이용(시간)', billingIncrement: '시간요금 올림 단위',
  billingIncrementHint: '실제 이용시간을 선택한 분 단위로 올림해 계산합니다.', distanceThreshold: '거리요금 시작(km)',
  distanceRate: 'km당 요금(원)', distanceMode: '거리 계산 방식', vatRate: '부가세(%)',
  overtimeRate: '초과 1시간 요금(원)', overtimeIncludesVat: '초과요금에 부가세 포함',
  rateUnitHint: '화면에서는 시간·km·%로 입력하며, 저장할 때 분·m·0.01% 정수로 정확히 변환합니다.', tollPolicy: '통행료', parkingPolicy: '주차비',
  modeAllAtThreshold: '기준 도달 시 전체 거리', modeExcessOnly: '기준 초과 거리만', modeAlways: '항상 전체 거리', modeNone: '거리요금 없음',
  policyManual: '직접 입력', policyRoute: '경로 예상액', policyIncluded: '요금에 포함', builtIn: '기본 프로필', profileSaved: '업체 프로필을 저장했습니다.',
  inputSection: '2. 일정 입력', pasteLabel: '받은 일정 전체 붙여넣기',
  pastePlaceholder: '카카오톡이나 메일로 받은 날짜, 시간, 장소, 주소를 그대로 붙여넣으세요.',
  analyze: '일정 분석', analyzing: '분석 중…', analyzeHint: 'AI는 일정만 분리합니다. 주소와 금액은 임의로 만들지 않습니다.',
  needsConfirm: '분석 결과입니다. 주소와 시간을 직접 확인해 주세요.', moreWarnings: '외 {count}건의 확인사항', confirmParsedSchedule: '시간·장소 확인 완료',
  confirmParsedScheduleRequired: 'AI가 분석한 시간과 장소를 확인 완료해 주세요.', tripFields: '이용 정보', serviceDate: '이용일',
  startTime: '시작 시각', endTime: '종료 시각', durationHours: '총 이용시간(시간)',
  durationInputHint: '숫자를 지운 뒤 원하는 시간을 바로 입력할 수 있습니다.', departureAddress: '차량 출발 주소', departureAddressPlaceholder: '첫 장소가 출발지면 비워 두세요.', returnAddress: '최종 복귀 주소',
  returnAddressPlaceholder: '복귀하지 않으면 비워 두세요.', stopSection: '3. 장소·시간 확인', addStop: '장소 추가',
  stop: '장소', pickup: '출발지', waypoint: '경유지', destination: '도착지', placeName: '장소명', purpose: '일정 내용',
  arrivalTime: '도착', departureTime: '출발', roadAddress: '도로명 주소', jibunAddress: '지번 주소', mapLink: '네이버 지도 링크',
  optionalSchedule: '선택 일정', includeInRoute: '운행경로에 포함', addressVerified: '주소 확인 완료',
  verificationReset: '주소를 수정하면 다시 확인해야 합니다.', moveUp: '위로', moveDown: '아래로', remove: '삭제',
  searchPlace: '장소 검색', searchPlaceholder: '장소명 또는 주소', search: '검색', searching: '검색 중…',
  searchNoResults: '검색 결과가 없습니다.', usePlace: '이 장소 사용', quoteSection: '4. 견적 조건', routeMode: '거리 입력 방식',
  routeAutomatic: '주소로 자동 계산', routeManual: '거리 직접 입력', manualDistance: '예상 거리(km)', manualToll: '예상 통행료(원)', parking: '예상 주차비(원)',
  incidentalAmountHint: '통행료·주차비가 없으면 0을 입력하세요. 원 단위 정수만 사용할 수 있습니다.',
  generatePreview: '견적서 미리보기', generatingPreview: '계산 중…', previewNeedsRefresh: '내용이 바뀌었습니다. 견적서를 다시 계산해 주세요.',
  previewSection: '5. 고객용 문서', routeSummary: '운행 예상', distance: '거리', drivingTime: '이동시간', timeFee: '시간요금',
  distanceFee: '거리요금', supplyAmount: '공급가액', vat: '부가세', toll: '통행료', parkingFee: '주차비', total: '최종 예상 금액',
  overtime: '초과 1시간', minutes: '분', copyDocument: '전체 일정·견적 복사', copied: '복사했습니다.', copyFailed: '복사하지 못했습니다.', print: '인쇄',
  warningTitle: '확인사항', closeSearch: '검색 닫기', noProfile: '등록된 업체가 없습니다. 새 업체를 만들어 주세요.',
  invalidDuration: '총 이용시간을 숫자로 입력해 주세요.', invalidManualDistance: '예상 거리를 0~3,000km 사이의 숫자로 입력해 주세요.', invalidIncidentalAmounts: '통행료와 주차비는 0~10,000,000 사이의 원 단위 정수로 입력해 주세요.', durationRange: '이 업체의 이용시간 범위를 확인해 주세요.',
  needTwoStops: '출발·경유·복귀 주소 중 운행경로 지점이 2곳 이상 필요합니다.', verifyIncludedStops: '운행경로에 포함된 모든 주소를 확인해 주세요.',
  requestFailed: '일정을 분석하지 못했습니다.', saveFailed: '업체 프로필을 저장하지 못했습니다.', previewFailed: '견적서를 만들지 못했습니다.',
  profileNameRequired: '업체명을 입력해 주세요.', invalidProfileNumbers: '필수 요금 숫자와 범위를 확인해 주세요. 빈칸이나 저장 단위에 맞지 않는 값은 저장할 수 없습니다.',
  chooseProfile: '업체를 먼저 선택해 주세요.', exactServerCopy: '아래 미리보기와 복사 내용은 서버가 계산한 동일한 문서입니다.',
};

const en: MoodQuoteText = {
  title: 'Company Vehicle Quote', subtitle: 'Paste an itinerary, verify each address, and copy a client-ready document.',
  adminOnly: 'Admin only · This tool does not create bookings or payments.', profileSection: '1. Company and rates', profileSelect: 'Company',
  loadingProfiles: 'Loading companies…', newProfile: 'New company', editProfile: 'Edit rates', closeProfile: 'Close editor', saveProfile: 'Save company', savingProfile: 'Saving…', companyName: 'Company name',
  documentTitle: 'Document title', footer: 'Footer note', hourlyRate: 'Hourly rate (KRW)', minimumMinutes: 'Minimum use (hours)', maximumMinutes: 'Maximum use (hours)',
  billingIncrement: 'Time billing increment', billingIncrementHint: 'Billable time is rounded up to the selected number of minutes.',
  distanceThreshold: 'Distance threshold (km)', distanceRate: 'Rate per km (KRW)', distanceMode: 'Distance billing', vatRate: 'VAT (%)',
  overtimeRate: 'Overtime per hour (KRW)', overtimeIncludesVat: 'Overtime rate includes VAT',
  rateUnitHint: 'Enter hours, km, and %. Values are saved exactly as whole minutes, metres, and hundredths of a percent.', tollPolicy: 'Tolls', parkingPolicy: 'Parking', modeAllAtThreshold: 'All distance once threshold is met',
  modeExcessOnly: 'Distance over threshold only', modeAlways: 'Always bill all distance', modeNone: 'No distance fee', policyManual: 'Manual',
  policyRoute: 'Route estimate', policyIncluded: 'Included', builtIn: 'Default profile', profileSaved: 'Company profile saved.',
  inputSection: '2. Itinerary input', pasteLabel: 'Paste the full received itinerary', pastePlaceholder: 'Paste the date, times, places, and addresses from chat or email.',
  analyze: 'Analyze itinerary', analyzing: 'Analyzing…', analyzeHint: 'AI only extracts the itinerary. It never invents addresses or prices.',
  needsConfirm: 'Review the extracted result and verify every address and time.', moreWarnings: '{count} more items to review', confirmParsedSchedule: 'Times and places confirmed',
  confirmParsedScheduleRequired: 'Confirm the AI-extracted times and places.', tripFields: 'Service details', serviceDate: 'Service date', startTime: 'Start time',
  endTime: 'End time', durationHours: 'Total hours', durationInputHint: 'You can clear the field and type the intended number directly.', departureAddress: 'Vehicle departure address', departureAddressPlaceholder: 'Leave blank when the first stop is the origin.', returnAddress: 'Final return address',
  returnAddressPlaceholder: 'Leave blank when there is no return.', stopSection: '3. Verify stops and times', addStop: 'Add stop', stop: 'Stop', pickup: 'Origin',
  waypoint: 'Waypoint', destination: 'Destination', placeName: 'Place name', purpose: 'Schedule details', arrivalTime: 'Arrival', departureTime: 'Departure',
  roadAddress: 'Road address', jibunAddress: 'Lot-number address', mapLink: 'Naver Map link', optionalSchedule: 'Optional schedule', includeInRoute: 'Include in route',
  addressVerified: 'Address verified', verificationReset: 'Editing an address requires verification again.', moveUp: 'Move up', moveDown: 'Move down', remove: 'Delete',
  searchPlace: 'Search place', searchPlaceholder: 'Place name or address', search: 'Search', searching: 'Searching…', searchNoResults: 'No results found.',
  usePlace: 'Use this place', quoteSection: '4. Quote inputs', routeMode: 'Distance source', routeAutomatic: 'Calculate from addresses', routeManual: 'Enter distance manually',
  manualDistance: 'Estimated distance (km)', manualToll: 'Estimated tolls (KRW)', parking: 'Estimated parking (KRW)',
  incidentalAmountHint: 'Enter 0 when there is no toll or parking cost. Use whole KRW amounts only.', generatePreview: 'Preview quote',
  generatingPreview: 'Calculating…', previewNeedsRefresh: 'Details changed. Recalculate the quote.', previewSection: '5. Client document', routeSummary: 'Route estimate',
  distance: 'Distance', drivingTime: 'Driving time', timeFee: 'Time fee', distanceFee: 'Distance fee', supplyAmount: 'Taxable supply', vat: 'VAT', toll: 'Tolls',
  parkingFee: 'Parking', total: 'Estimated total', overtime: 'One overtime hour', minutes: 'min', copyDocument: 'Copy full itinerary and quote', copied: 'Copied.',
  copyFailed: 'Could not copy.', print: 'Print', warningTitle: 'Items to confirm', closeSearch: 'Close search', noProfile: 'No company profile. Create one first.',
  invalidDuration: 'Enter total hours as a number.', invalidManualDistance: 'Enter an estimated distance from 0 to 3,000 km.', invalidIncidentalAmounts: 'Enter tolls and parking as whole KRW amounts from 0 to 10,000,000.', durationRange: 'Check this company’s allowed service hours.', needTwoStops: 'At least two usable route points are required across departure, stops, and return.',
  verifyIncludedStops: 'Verify every address included in the route.', requestFailed: 'Could not analyze the itinerary.', saveFailed: 'Could not save the company profile.',
  previewFailed: 'Could not create the quote.', profileNameRequired: 'Enter a company name.', invalidProfileNumbers: 'Check every required rate number and range. Blank values or values that do not convert to whole storage units cannot be saved.', chooseProfile: 'Choose a company first.',
  exactServerCopy: 'The preview and copied text below are the same server-calculated document.',
};

const ja: MoodQuoteText = {
  title: '会社別車両見積書', subtitle: '日程を貼り付け、住所を確認すると、お客様用文書をすぐコピーできます。',
  adminOnly: '管理者専用・予約や決済は作成されません。', profileSection: '1. 会社と料金表', profileSelect: '会社選択', loadingProfiles: '会社一覧を読み込み中…',
  newProfile: '新しい会社', editProfile: '料金表を編集', closeProfile: '編集を閉じる', saveProfile: '会社を保存', savingProfile: '保存中…', companyName: '会社名', documentTitle: '文書タイトル', footer: '下部案内文',
  hourlyRate: '1時間料金（ウォン）', minimumMinutes: '最低利用（時間）', maximumMinutes: '最大利用（時間）', billingIncrement: '時間料金の切り上げ単位',
  billingIncrementHint: '実際の利用時間を選択した分単位で切り上げて計算します。', distanceThreshold: '距離料金開始（km）',
  distanceRate: '1km料金（ウォン）', distanceMode: '距離計算方式', vatRate: '付加価値税（%）', overtimeRate: '超過1時間料金（ウォン）',
  overtimeIncludesVat: '超過料金は付加価値税込み', rateUnitHint: '画面では時間・km・%で入力し、保存時に分・m・0.01%の整数へ正確に変換します。',
  tollPolicy: '通行料', parkingPolicy: '駐車料', modeAllAtThreshold: '基準到達時は全距離', modeExcessOnly: '基準超過分のみ', modeAlways: '常に全距離', modeNone: '距離料金なし',
  policyManual: '直接入力', policyRoute: 'ルート予想額', policyIncluded: '料金に含む', builtIn: '基本プロフィール', profileSaved: '会社プロフィールを保存しました。',
  inputSection: '2. 日程入力', pasteLabel: '受け取った日程をすべて貼り付け', pastePlaceholder: 'チャットやメールの日付、時刻、場所、住所をそのまま貼り付けてください。',
  analyze: '日程を分析', analyzing: '分析中…', analyzeHint: 'AIは日程だけを分離し、住所や金額を作りません。', needsConfirm: '分析結果です。住所と時刻を確認してください。', moreWarnings: 'ほか{count}件の確認事項',
  confirmParsedSchedule: '時刻・場所の確認完了', confirmParsedScheduleRequired: 'AIが抽出した時刻と場所の確認を完了してください。',
  tripFields: '利用情報', serviceDate: '利用日', startTime: '開始時刻', endTime: '終了時刻', durationHours: '総利用時間（時間）',
  durationInputHint: '数字を消してから希望時間を直接入力できます。', departureAddress: '車両出発住所', departureAddressPlaceholder: '最初の場所が出発地なら空欄にします。', returnAddress: '最終帰着住所', returnAddressPlaceholder: '帰着しない場合は空欄にします。',
  stopSection: '3. 場所・時刻の確認', addStop: '場所追加', stop: '場所', pickup: '出発地', waypoint: '経由地', destination: '到着地', placeName: '場所名',
  purpose: '日程内容', arrivalTime: '到着', departureTime: '出発', roadAddress: '道路名住所', jibunAddress: '地番住所', mapLink: 'NAVERマップリンク',
  optionalSchedule: '選択日程', includeInRoute: '走行ルートに含む', addressVerified: '住所確認済み', verificationReset: '住所を編集すると再確認が必要です。',
  moveUp: '上へ', moveDown: '下へ', remove: '削除', searchPlace: '場所検索', searchPlaceholder: '場所名または住所', search: '検索', searching: '検索中…',
  searchNoResults: '検索結果がありません。', usePlace: 'この場所を使用', quoteSection: '4. 見積条件', routeMode: '距離入力方式', routeAutomatic: '住所から自動計算',
  routeManual: '距離を直接入力', manualDistance: '予想距離（km）', manualToll: '予想通行料（ウォン）', parking: '予想駐車料（ウォン）',
  incidentalAmountHint: '通行料・駐車料がない場合は0を入力してください。ウォン単位の整数のみ使用できます。',
  generatePreview: '見積書プレビュー', generatingPreview: '計算中…', previewNeedsRefresh: '内容が変更されました。再計算してください。', previewSection: '5. お客様用文書',
  routeSummary: '走行予想', distance: '距離', drivingTime: '移動時間', timeFee: '時間料金', distanceFee: '距離料金', supplyAmount: '供給価額', vat: '付加価値税',
  toll: '通行料', parkingFee: '駐車料', total: '最終予想金額', overtime: '超過1時間', minutes: '分', copyDocument: '全日程・見積をコピー', copied: 'コピーしました。',
  copyFailed: 'コピーできませんでした。', print: '印刷', warningTitle: '確認事項', closeSearch: '検索を閉じる', noProfile: '会社がありません。新しく作成してください。',
  invalidDuration: '総利用時間を数字で入力してください。', invalidManualDistance: '予想距離を0～3,000kmの数値で入力してください。', invalidIncidentalAmounts: '通行料と駐車料は0～10,000,000のウォン単位の整数で入力してください。', durationRange: 'この会社の利用可能時間を確認してください。', needTwoStops: '出発・経由・帰着住所のうち、利用可能なルート地点が2か所以上必要です。',
  verifyIncludedStops: 'ルートに含まれるすべての住所を確認してください。', requestFailed: '日程を分析できませんでした。', saveFailed: '会社プロフィールを保存できませんでした。',
  previewFailed: '見積書を作成できませんでした。', profileNameRequired: '会社名を入力してください。', invalidProfileNumbers: '必須料金の数値と範囲を確認してください。空欄や保存単位に変換できない値は保存できません。', chooseProfile: '先に会社を選択してください。',
  exactServerCopy: '下のプレビューとコピー内容は、サーバーが計算した同じ文書です。',
};

const zh: MoodQuoteText = {
  title: '企业车辆报价单', subtitle: '粘贴行程并确认地址后，即可复制可直接发送给客户的文件。', adminOnly: '仅限管理员・不会创建预订或付款。',
  profileSection: '1. 企业与价目表', profileSelect: '选择企业', loadingProfiles: '正在加载企业…', newProfile: '新企业', editProfile: '编辑价目表', closeProfile: '关闭编辑', saveProfile: '保存企业', savingProfile: '保存中…',
  companyName: '企业名称', documentTitle: '文件标题', footer: '底部说明', hourlyRate: '每小时费用（韩元）', minimumMinutes: '最短使用（小时）', maximumMinutes: '最长使用（小时）',
  billingIncrement: '时间费进位单位', billingIncrementHint: '实际用车时间按所选分钟数向上取整计算。',
  distanceThreshold: '里程费起算（km）', distanceRate: '每公里费用（韩元）', distanceMode: '里程计费方式', vatRate: '增值税（%）', overtimeRate: '超时每小时（韩元）',
  overtimeIncludesVat: '超时费用含增值税', rateUnitHint: '页面按小时、km、%输入，保存时会准确转换为整数分钟、米和0.01%。',
  tollPolicy: '过路费', parkingPolicy: '停车费', modeAllAtThreshold: '达到标准后按全部里程', modeExcessOnly: '仅计算超出里程', modeAlways: '始终按全部里程', modeNone: '不收里程费',
  policyManual: '手动输入', policyRoute: '路线预估', policyIncluded: '已包含', builtIn: '默认配置', profileSaved: '企业配置已保存。',
  inputSection: '2. 输入行程', pasteLabel: '粘贴收到的完整行程', pastePlaceholder: '请粘贴聊天或邮件中的日期、时间、地点和地址。', analyze: '分析行程', analyzing: '分析中…',
  analyzeHint: 'AI仅提取行程，不会编造地址或金额。', needsConfirm: '这是分析结果，请亲自确认地址和时间。', moreWarnings: '另有{count}项待确认', confirmParsedSchedule: '时间与地点已确认',
  confirmParsedScheduleRequired: '请确认AI提取的时间与地点。', tripFields: '用车信息', serviceDate: '用车日期',
  startTime: '开始时间', endTime: '结束时间', durationHours: '总使用时间（小时）', durationInputHint: '可先清空数字，再直接输入所需时长。', departureAddress: '车辆出发地址', departureAddressPlaceholder: '第一站即出发地时可留空。', returnAddress: '最终返回地址',
  returnAddressPlaceholder: '无需返回时可留空。', stopSection: '3. 确认地点与时间', addStop: '添加地点', stop: '地点', pickup: '出发地', waypoint: '经停地', destination: '目的地',
  placeName: '地点名称', purpose: '行程内容', arrivalTime: '到达', departureTime: '出发', roadAddress: '道路名地址', jibunAddress: '地号地址', mapLink: 'NAVER地图链接',
  optionalSchedule: '可选行程', includeInRoute: '计入行驶路线', addressVerified: '地址已确认', verificationReset: '修改地址后需要重新确认。', moveUp: '上移', moveDown: '下移',
  remove: '删除', searchPlace: '搜索地点', searchPlaceholder: '地点名称或地址', search: '搜索', searching: '搜索中…', searchNoResults: '没有搜索结果。',
  usePlace: '使用此地点', quoteSection: '4. 报价条件', routeMode: '里程输入方式', routeAutomatic: '按地址自动计算', routeManual: '手动输入里程',
  manualDistance: '预计里程（km）', manualToll: '预计过路费（韩元）', parking: '预计停车费（韩元）',
  incidentalAmountHint: '没有过路费或停车费时请输入0，仅可输入以韩元为单位的整数。', generatePreview: '预览报价单', generatingPreview: '计算中…',
  previewNeedsRefresh: '内容已更改，请重新计算报价。', previewSection: '5. 客户文件', routeSummary: '行驶预估', distance: '里程', drivingTime: '行驶时间',
  timeFee: '时间费', distanceFee: '里程费', supplyAmount: '供应价', vat: '增值税', toll: '过路费', parkingFee: '停车费', total: '最终预估金额',
  overtime: '超时1小时', minutes: '分钟', copyDocument: '复制完整行程与报价', copied: '已复制。', copyFailed: '复制失败。', print: '打印', warningTitle: '待确认事项',
  closeSearch: '关闭搜索', noProfile: '尚无企业配置，请新建。', invalidDuration: '请用数字输入总使用时间。', invalidManualDistance: '预计里程请输入0至3,000km之间的数字。', invalidIncidentalAmounts: '过路费和停车费请输入0至10,000,000之间的韩元整数。', durationRange: '请确认该企业允许的用车时长。',
  needTwoStops: '出发、经停和返回地址中至少需要两个可用路线点。', verifyIncludedStops: '请确认路线中所有地点的地址。', requestFailed: '无法分析行程。', saveFailed: '无法保存企业配置。',
  previewFailed: '无法生成报价单。', profileNameRequired: '请输入企业名称。', invalidProfileNumbers: '请检查所有必填费用数字和范围。空值或无法转换为整数存储单位的值不能保存。', chooseProfile: '请先选择企业。', exactServerCopy: '以下预览与复制内容均为服务器计算的同一份文件。',
};

const translations: Record<Language, MoodQuoteText> = { ko, en, ja, zh };

export function getMoodQuoteText(language: Language): MoodQuoteText {
  return translations[language] || en;
}
