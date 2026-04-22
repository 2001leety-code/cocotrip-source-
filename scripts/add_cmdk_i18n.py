"""
Add `commandPalette` namespace to ko/en/ja/zh locale JSON files.
"""
import json
import os

LOCALES_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'i18n', 'locales')

PALETTE = {
    "ko": {
        "triggerLabel": "검색",
        "placeholder": "여행지, 페이지 검색...",
        "empty": "결과가 없습니다",
        "groups": {
            "pages": "페이지",
            "regions": "여행지",
            "account": "내 계정",
            "legal": "약관"
        },
        "items": {
            "home": "홈",
            "tours": "투어",
            "charter": "전세차량",
            "planner": "AI 플래너",
            "about": "소개",
            "myPage": "마이페이지",
            "myPlans": "내 여행",
            "terms": "이용약관",
            "privacy": "개인정보",
            "travelTerms": "여행약관"
        }
    },
    "en": {
        "triggerLabel": "Search",
        "placeholder": "Search destinations, pages...",
        "empty": "No results found",
        "groups": {
            "pages": "Pages",
            "regions": "Destinations",
            "account": "My Account",
            "legal": "Legal"
        },
        "items": {
            "home": "Home",
            "tours": "Tours",
            "charter": "Charter",
            "planner": "AI Planner",
            "about": "About",
            "myPage": "My Page",
            "myPlans": "My Plans",
            "terms": "Terms",
            "privacy": "Privacy",
            "travelTerms": "Travel Terms"
        }
    },
    "ja": {
        "triggerLabel": "検索",
        "placeholder": "目的地・ページを検索...",
        "empty": "結果が見つかりません",
        "groups": {
            "pages": "ページ",
            "regions": "目的地",
            "account": "マイアカウント",
            "legal": "規約"
        },
        "items": {
            "home": "ホーム",
            "tours": "ツアー",
            "charter": "チャーター車両",
            "planner": "AIプランナー",
            "about": "紹介",
            "myPage": "マイページ",
            "myPlans": "マイ旅行",
            "terms": "利用規約",
            "privacy": "プライバシー",
            "travelTerms": "旅行規約"
        }
    },
    "zh": {
        "triggerLabel": "搜索",
        "placeholder": "搜索目的地、页面...",
        "empty": "未找到结果",
        "groups": {
            "pages": "页面",
            "regions": "目的地",
            "account": "我的账户",
            "legal": "条款"
        },
        "items": {
            "home": "首页",
            "tours": "旅游",
            "charter": "包车",
            "planner": "AI 规划师",
            "about": "关于",
            "myPage": "我的页面",
            "myPlans": "我的行程",
            "terms": "使用条款",
            "privacy": "隐私",
            "travelTerms": "旅行条款"
        }
    }
}


def main():
    for lang, payload in PALETTE.items():
        path = os.path.join(LOCALES_DIR, f"{lang}.json")
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'commandPalette' in data:
            print(f"[{lang}] 'commandPalette' already exists — overwriting")
        data['commandPalette'] = payload
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[{lang}] wrote commandPalette -> {path}")


if __name__ == '__main__':
    main()
