/**
 * 문의 메일 수신자는 SMTP에 넘길 단일 ASCII mailbox만 허용한다.
 * 표시 이름, 여러 주소, 헤더 개행, 국제화 도메인은 자동 발송 대상이 아니다.
 */
export function validInquiryResponseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 200 || /[\s,;<>"\\]/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+$/i.test(local)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return email;
}
