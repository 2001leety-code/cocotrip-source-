"""
Add `admin` namespace to ko/en/ja/zh locale JSON files.

One-off migration helper for the Admin/AdminReviews i18n conversion.
Keeps existing keys intact and appends `admin` at the end of the root object.
"""
import json
import os
import sys

LOCALES_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'i18n', 'locales')

ADMIN = {
    "ko": {
        "title": "관리자 대시보드",
        "subtitle": "투어 상품 관리 · 예약 목록 조회",
        "loading": "불러오는 중...",
        "toasts": {
            "loginFirst": "먼저 로그인을 해주세요.",
            "emptyFields": "제목과 설명을 입력해주세요.",
            "invalidPrice": "가격은 0 이상의 숫자여야 합니다.",
            "invalidSeats": "총 정원은 1 이상의 숫자여야 합니다.",
            "tourCreated": "상품이 등록되었습니다.",
            "tourCreateFailed": "상품 등록에 실패했습니다.",
            "bookingsLoadFailed": "예약 목록 로딩에 실패했습니다.",
            "actionFailed": "작업에 실패했습니다.",
            "reviewAction": "리뷰 {status}: {id}..."
        },
        "statusLabels": {
            "kept": "유지됨",
            "hidden": "숨김 처리됨",
            "deleted": "삭제됨"
        },
        "quickLinks": {
            "moderationTitle": "리뷰 모더레이션",
            "moderationDesc": "신고된 리뷰 관리 · 유지 / 숨김 / 삭제"
        },
        "bookings": {
            "title": "예약 목록",
            "count": "{n}건",
            "source": "(Google Sheets)",
            "refresh": "새로고침",
            "empty": "등록된 예약이 없습니다"
        },
        "tourForm": {
            "header": "상품 등록",
            "titleLabel": "제목",
            "titlePlaceholder": "예: Seoul Private Tour",
            "descriptionLabel": "설명",
            "descriptionPlaceholder": "상품 상세 설명",
            "priceLabel": "가격 ($)",
            "seatsLabel": "총 정원",
            "submit": "상품 등록",
            "submitting": "등록 중..."
        },
        "reviews": {
            "title": "리뷰 모더레이션",
            "refresh": "새로고침",
            "itemCount": "{n}건",
            "filters": {
                "reported": "🚩 신고됨",
                "hidden": "👁️ 숨김",
                "all": "📋 전체"
            },
            "emptyReported": "신고된 리뷰가 없습니다",
            "emptyHidden": "숨김 처리된 리뷰가 없습니다",
            "emptyAll": "리뷰가 없습니다",
            "reportDetails": "신고 상세",
            "noReasonGiven": "사유 없음",
            "noReason": "사유 없음",
            "unknown": "알 수 없음",
            "byReporter": "신고자: {name}",
            "metaType": "유형: {type}",
            "metaTarget": "대상: {id}...",
            "metaAuthor": "작성자 UID: {id}...",
            "viewPlan": "플랜 보기",
            "actions": {
                "keep": "유지",
                "hide": "숨김",
                "delete": "삭제"
            },
            "statusBadge": {
                "reported": "신고됨",
                "hidden": "숨김",
                "published": "게시됨"
            }
        }
    },
    "en": {
        "title": "Admin Dashboard",
        "subtitle": "Manage tour products · View bookings",
        "loading": "Loading...",
        "toasts": {
            "loginFirst": "Please log in first.",
            "emptyFields": "Please enter a title and description.",
            "invalidPrice": "Price must be a non-negative number.",
            "invalidSeats": "Total seats must be at least 1.",
            "tourCreated": "Tour created successfully.",
            "tourCreateFailed": "Failed to create tour.",
            "bookingsLoadFailed": "Failed to load bookings.",
            "actionFailed": "Action failed.",
            "reviewAction": "Review {status}: {id}..."
        },
        "statusLabels": {
            "kept": "Kept",
            "hidden": "Hidden",
            "deleted": "Deleted"
        },
        "quickLinks": {
            "moderationTitle": "Review Moderation",
            "moderationDesc": "Manage reported reviews · Keep / Hide / Delete"
        },
        "bookings": {
            "title": "Bookings",
            "count": "{n}",
            "source": "(Google Sheets)",
            "refresh": "Refresh",
            "empty": "No bookings yet"
        },
        "tourForm": {
            "header": "Create Tour",
            "titleLabel": "Title",
            "titlePlaceholder": "e.g. Seoul Private Tour",
            "descriptionLabel": "Description",
            "descriptionPlaceholder": "Tour details",
            "priceLabel": "Price ($)",
            "seatsLabel": "Total Seats",
            "submit": "Create Tour",
            "submitting": "Creating..."
        },
        "reviews": {
            "title": "Review Moderation",
            "refresh": "Refresh",
            "itemCount": "{n}",
            "filters": {
                "reported": "🚩 Reported",
                "hidden": "👁️ Hidden",
                "all": "📋 All"
            },
            "emptyReported": "No reported reviews",
            "emptyHidden": "No hidden reviews",
            "emptyAll": "No reviews",
            "reportDetails": "Report Details",
            "noReasonGiven": "No reason given",
            "noReason": "No reason",
            "unknown": "unknown",
            "byReporter": "by {name}",
            "metaType": "Type: {type}",
            "metaTarget": "Target: {id}...",
            "metaAuthor": "Author UID: {id}...",
            "viewPlan": "View Plan",
            "actions": {
                "keep": "Keep",
                "hide": "Hide",
                "delete": "Delete"
            },
            "statusBadge": {
                "reported": "reported",
                "hidden": "hidden",
                "published": "published"
            }
        }
    },
    "ja": {
        "title": "管理ダッシュボード",
        "subtitle": "ツアー商品管理 · 予約リスト",
        "loading": "読み込み中...",
        "toasts": {
            "loginFirst": "まずログインしてください。",
            "emptyFields": "タイトルと説明を入力してください。",
            "invalidPrice": "価格は0以上の数字である必要があります。",
            "invalidSeats": "総定員は1以上の数字である必要があります。",
            "tourCreated": "商品が登録されました。",
            "tourCreateFailed": "商品の登録に失敗しました。",
            "bookingsLoadFailed": "予約リストの読み込みに失敗しました。",
            "actionFailed": "操作に失敗しました。",
            "reviewAction": "レビュー {status}: {id}..."
        },
        "statusLabels": {
            "kept": "保持",
            "hidden": "非表示",
            "deleted": "削除"
        },
        "quickLinks": {
            "moderationTitle": "レビューモデレーション",
            "moderationDesc": "報告されたレビュー管理 · 保持 / 非表示 / 削除"
        },
        "bookings": {
            "title": "予約リスト",
            "count": "{n}件",
            "source": "(Google Sheets)",
            "refresh": "更新",
            "empty": "予約がありません"
        },
        "tourForm": {
            "header": "商品登録",
            "titleLabel": "タイトル",
            "titlePlaceholder": "例: Seoul Private Tour",
            "descriptionLabel": "説明",
            "descriptionPlaceholder": "商品詳細",
            "priceLabel": "価格 ($)",
            "seatsLabel": "総定員",
            "submit": "商品登録",
            "submitting": "登録中..."
        },
        "reviews": {
            "title": "レビューモデレーション",
            "refresh": "更新",
            "itemCount": "{n}件",
            "filters": {
                "reported": "🚩 報告",
                "hidden": "👁️ 非表示",
                "all": "📋 全て"
            },
            "emptyReported": "報告されたレビューはありません",
            "emptyHidden": "非表示のレビューはありません",
            "emptyAll": "レビューはありません",
            "reportDetails": "報告詳細",
            "noReasonGiven": "理由なし",
            "noReason": "理由なし",
            "unknown": "不明",
            "byReporter": "報告者: {name}",
            "metaType": "タイプ: {type}",
            "metaTarget": "対象: {id}...",
            "metaAuthor": "作成者 UID: {id}...",
            "viewPlan": "プラン表示",
            "actions": {
                "keep": "保持",
                "hide": "非表示",
                "delete": "削除"
            },
            "statusBadge": {
                "reported": "報告",
                "hidden": "非表示",
                "published": "公開"
            }
        }
    },
    "zh": {
        "title": "管理员控制台",
        "subtitle": "套餐管理 · 预订列表",
        "loading": "加载中...",
        "toasts": {
            "loginFirst": "请先登录。",
            "emptyFields": "请输入标题和说明。",
            "invalidPrice": "价格必须是大于等于 0 的数字。",
            "invalidSeats": "总座位数必须至少为 1。",
            "tourCreated": "套餐已创建。",
            "tourCreateFailed": "套餐创建失败。",
            "bookingsLoadFailed": "加载预订列表失败。",
            "actionFailed": "操作失败。",
            "reviewAction": "评论 {status}: {id}..."
        },
        "statusLabels": {
            "kept": "保留",
            "hidden": "已隐藏",
            "deleted": "已删除"
        },
        "quickLinks": {
            "moderationTitle": "评论审核",
            "moderationDesc": "管理被举报的评论 · 保留 / 隐藏 / 删除"
        },
        "bookings": {
            "title": "预订列表",
            "count": "{n}",
            "source": "(Google Sheets)",
            "refresh": "刷新",
            "empty": "暂无预订"
        },
        "tourForm": {
            "header": "创建套餐",
            "titleLabel": "标题",
            "titlePlaceholder": "例如: Seoul Private Tour",
            "descriptionLabel": "说明",
            "descriptionPlaceholder": "套餐详情",
            "priceLabel": "价格 ($)",
            "seatsLabel": "总座位数",
            "submit": "创建套餐",
            "submitting": "创建中..."
        },
        "reviews": {
            "title": "评论审核",
            "refresh": "刷新",
            "itemCount": "{n}",
            "filters": {
                "reported": "🚩 已举报",
                "hidden": "👁️ 已隐藏",
                "all": "📋 全部"
            },
            "emptyReported": "暂无被举报的评论",
            "emptyHidden": "暂无被隐藏的评论",
            "emptyAll": "暂无评论",
            "reportDetails": "举报详情",
            "noReasonGiven": "无理由",
            "noReason": "无理由",
            "unknown": "未知",
            "byReporter": "举报人: {name}",
            "metaType": "类型: {type}",
            "metaTarget": "对象: {id}...",
            "metaAuthor": "作者 UID: {id}...",
            "viewPlan": "查看行程",
            "actions": {
                "keep": "保留",
                "hide": "隐藏",
                "delete": "删除"
            },
            "statusBadge": {
                "reported": "已举报",
                "hidden": "已隐藏",
                "published": "已发布"
            }
        }
    }
}


def main():
    for lang, payload in ADMIN.items():
        path = os.path.join(LOCALES_DIR, f"{lang}.json")
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'admin' in data:
            print(f"[{lang}] 'admin' key already exists — overwriting")
        data['admin'] = payload
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[{lang}] wrote admin namespace -> {path}")


if __name__ == '__main__':
    main()
