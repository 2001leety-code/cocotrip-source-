import { describe, expect, it } from 'vitest';
import {
  isAdminEmail,
  isSettlementApproverEmail,
  PRIMARY_MOOD_ADMIN_EMAIL,
} from '../../api/_shared/mood-allowlist.js';

describe('MOOD 단일 관리자 권한 helper', () => {
  it('고정 이메일이 admins 배열에도 남아 있을 때만 관리자다', () => {
    expect(isAdminEmail({ admins: [PRIMARY_MOOD_ADMIN_EMAIL] }, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(true);
    expect(isAdminEmail({ admins: ['  2001LEETY@GMAIL.COM  '] }, ' 2001LEETY@GMAIL.COM ')).toBe(true);
    expect(isAdminEmail({ admins: [] }, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
  });

  it('admins 배열에 남은 다른 이메일과 잘못된 allowlist는 관리자 권한을 얻지 못한다', () => {
    expect(isAdminEmail({ admins: [PRIMARY_MOOD_ADMIN_EMAIL, 'legacy@x.com'] }, 'legacy@x.com')).toBe(false);
    expect(isAdminEmail({ admins: 'legacy@x.com' }, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
    expect(isAdminEmail(null, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
  });

  it('비고정 계정은 별도 확인 목록에 있을 때만 확인 전용 권한을 가진다', () => {
    const allowlist = {
      admins: [PRIMARY_MOOD_ADMIN_EMAIL, 'employee@x.com'],
      settlementApproverEmails: ['employee@x.com', PRIMARY_MOOD_ADMIN_EMAIL],
    };

    expect(isAdminEmail(allowlist, 'employee@x.com')).toBe(false);
    expect(isSettlementApproverEmail(allowlist, 'employee@x.com')).toBe(true);
    expect(isSettlementApproverEmail(allowlist, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
  });

  it('고정 관리자는 admins 설정이 사라져도 확인 전용 권한으로 우회하지 못한다', () => {
    const misconfigured = {
      admins: [],
      settlementApproverEmails: [`  ${PRIMARY_MOOD_ADMIN_EMAIL.toUpperCase()}  `],
    };

    expect(isAdminEmail(misconfigured, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
    expect(isSettlementApproverEmail(misconfigured, PRIMARY_MOOD_ADMIN_EMAIL)).toBe(false);
  });
});
