// @vitest-environment jsdom
//
// 회귀 잠금 (2026-07-28) — /admin/reviews 가 관리자를 홈으로 튕기던 문제 + 응답 규격 불일치.
//
// 원인: useAuth 는 공유 컨텍스트가 아니라 컴포넌트마다 새 인스턴스라 첫 렌더에서 항상
//   user=null 이다. AdminReviews 가 중앙 AdminRoute 와 별개로 자체 ADMIN_EMAILS 검사를
//   하면서 loading 을 안 보고 navigate('/') 를 즉시 실행 → 관리자도 홈으로 이동.
// 두 번째 원인: 서버는 { ok, data:{ reviews } } 인데 화면이 최상위 body.reviews 를 읽어
//   항상 undefined → "Unexpected response shape".
//
// ⚠️ authFetch·useLanguage 를 mock 하는 이유: `@/lib/firebase` 를 끌어와 CI(env 없음)에서
//    수집 단계가 통째로 죽는다(선례 PR #1172).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

void React;

const authFetchMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../../src/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));
vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: 'ko',
    t: {
      admin: {
        success: '완료',
        statusLabels: { kept: '유지', hidden: '숨김', deleted: '삭제' },
        toasts: { reviewAction: '{status} {id}', actionFailed: '실패' },
        reviews: {
          title: '리뷰 관리', refresh: '새로고침', itemCount: '{n}건',
          filters: { reported: '신고', hidden: '숨김', all: '전체' },
          emptyReported: '신고된 리뷰가 없습니다',
          emptyHidden: '숨긴 리뷰가 없습니다',
          emptyAll: '리뷰가 없습니다',
          statusBadge: { reported: '신고', hidden: '숨김', published: '공개' },
          actions: { keep: '유지', hide: '숨기기', delete: '삭제' },
          reportDetails: '신고 내역',
          noReason: '사유 없음',
          noReasonGiven: '사유 미기재',
          byReporter: '신고자 {id}',
          metaAuthor: '작성자 {name}',
          metaTarget: '대상 {id}',
          metaType: '유형 {type}',
          unknown: '알 수 없음',
          viewPlan: '플랜 보기',
        },
      },
    },
    changeLanguage: () => {},
  }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const { default: AdminReviews } = await import('../../src/pages/AdminReviews');

function renderPage() {
  return render(<MemoryRouter><AdminReviews /></MemoryRouter>);
}

beforeEach(() => {
  cleanup();
  authFetchMock.mockReset();
  navigateMock.mockReset();
});

describe('/admin/reviews — 인증 경합', () => {
  it('마운트 직후 홈으로 리다이렉트하지 않는다', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { reviews: [], count: 0 } }),
    });
    renderPage();
    // 첫 렌더에서 user=null 이어도 화면을 떠나면 안 된다.
    expect(navigateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('권한 판단을 화면에서 다시 하지 않는다 (중앙 AdminRoute + 서버 토큰으로 통일)', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync('src/pages/AdminReviews.tsx', 'utf8'));
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('ADMIN_EMAILS');
    expect(code).not.toContain("navigate('/')");
  });
});

describe('/admin/reviews — 응답 규격', () => {
  it('{ ok, data:{ reviews } } 를 정상 파싱한다', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          reviews: [{
            id: 'r1', authorUid: 'u1', authorName: '홍길동', targetType: 'tour',
            targetId: 't1', rating: 2, text: '별로였어요', status: 'reported', createdAt: 1,
          }],
          count: 1,
        },
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('별로였어요')).toBeTruthy());
    // 규격 오류 문구가 뜨면 안 된다.
    expect(screen.queryByText(/Unexpected response shape/)).toBeNull();
  });

  it('0건과 API 실패를 서로 다른 화면으로 보여준다', async () => {
    // (1) 0건 = 정상 빈 상태
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { reviews: [], count: 0 } }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('신고된 리뷰가 없습니다')).toBeTruthy());

    // (2) 실패 = 오류 표시, "없음"으로 위장되지 않음
    cleanup();
    authFetchMock.mockResolvedValue({
      ok: false, status: 500, statusText: 'Server Error',
      json: async () => ({ ok: false, error: 'boom' }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeTruthy());
    expect(screen.queryByText('신고된 리뷰가 없습니다')).toBeNull();
  });
});
