"""
CocoTrip PWA 아이콘 생성기 v2
- 배경색이 모서리까지 완전히 꽉 차는 maskable 아이콘 생성
- 원본 이미지의 라운드 코너를 제거하고 직각으로 처리
"""
from PIL import Image, ImageDraw
import sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else None
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "icons")
BG_COLOR = (10, 11, 20)  # #0a0b14

if not SRC or not os.path.exists(SRC):
    print(f"Usage: python make_icon.py <source_image.png>")
    sys.exit(1)

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# 원본에서 로고+텍스트만 중앙 부분 추출 (모서리 라운드 영역 제외)
# 전체의 약 85% 영역만 크롭 (모서리 라운드 부분 잘라냄)
crop_margin = int(w * 0.08)
content = img.crop((crop_margin, crop_margin, w - crop_margin, h - crop_margin))

for size, name in [(512, "icon-512.png"), (192, "icon-192.png")]:
    # 완전 직각 배경 캔버스
    canvas = Image.new("RGB", (size, size), BG_COLOR)
    
    # 컨텐츠를 maskable safe zone (80%)에 맞게 리사이즈
    safe_size = int(size * 0.78)
    content_resized = content.resize((safe_size, safe_size), Image.LANCZOS)
    
    # RGBA → RGB 합성 (배경색 위에)
    rgba_canvas = Image.new("RGBA", (size, size), BG_COLOR + (255,))
    offset = (size - safe_size) // 2
    rgba_canvas.paste(content_resized, (offset, offset), content_resized)
    
    # 최종 RGB 변환 (투명 영역 없음)
    final = Image.new("RGB", (size, size), BG_COLOR)
    final.paste(rgba_canvas, mask=rgba_canvas.split()[3])
    
    # 4개 모서리 영역을 강제로 배경색으로 펠(원본 라운드 잔해 제거)
    draw = ImageDraw.Draw(final)
    corner_size = int(size * 0.05)
    # 4개 모서리 삼각형 영역
    for x in range(corner_size):
        for y in range(corner_size):
            r, g, b = final.getpixel((x, y))
            if abs(r - BG_COLOR[0]) < 30 and abs(g - BG_COLOR[1]) < 30 and abs(b - BG_COLOR[2]) < 30:
                draw.point((x, y), fill=BG_COLOR)
            # 우상단
            r, g, b = final.getpixel((size-1-x, y))
            if abs(r - BG_COLOR[0]) < 30 and abs(g - BG_COLOR[1]) < 30 and abs(b - BG_COLOR[2]) < 30:
                draw.point((size-1-x, y), fill=BG_COLOR)
            # 좌하단
            r, g, b = final.getpixel((x, size-1-y))
            if abs(r - BG_COLOR[0]) < 30 and abs(g - BG_COLOR[1]) < 30 and abs(b - BG_COLOR[2]) < 30:
                draw.point((x, size-1-y), fill=BG_COLOR)
            # 우하단
            r, g, b = final.getpixel((size-1-x, size-1-y))
            if abs(r - BG_COLOR[0]) < 30 and abs(g - BG_COLOR[1]) < 30 and abs(b - BG_COLOR[2]) < 30:
                draw.point((size-1-x, size-1-y), fill=BG_COLOR)
    
    out_path = os.path.join(OUT_DIR, name)
    final.save(out_path, "PNG")
    print(f"✅ {name}: {size}x{size} → {out_path}")

print("\n🎉 아이콘 생성 완료! 배경이 꽉 차게 직각 모서리로 생성됨.")
print("  → 핸드폰 OS가 자동으로 라운드 마스킹 적용합니다.")
