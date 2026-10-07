# OpenMontage 투어 홍보 영상 런북 (레포 밖 별도 워크스페이스)

> 작성 2026-10-07. OpenMontage 기준 커밋 **`9327439`** (`9327439db69021ab4b0e2776729bf3b58fdb5a87`, 2026-10-03) 고정.
> CocoTrip 레포에 들어간 것은 **데이터 → 입력 파일 변환기**뿐이다:
> `scripts/export-openmontage-brief.mjs` (CLI) + `scripts/lib/openmontage-brief.mjs` (순수 함수) + `tests/unit/openmontage-brief.test.ts`.
> OpenMontage 자체는 이 레포에 넣지 않는다(2절). 이 작업에서 OpenMontage 를 실제로 설치·실행·렌더한 적은 **없다** — 11절 미검증 목록 참고.

---

## 1. 무엇인가

OpenMontage(github.com/calesthio/OpenMontage, AGPL-3.0)는 "에이전트형 영상 제작" 워크스페이스다.
Python 오케스트레이터가 따로 있는 게 아니라, **OpenMontage 폴더에서 연 코딩 에이전트(Claude Code 등)가** `pipeline_defs/*.yaml`
파이프라인과 `skills/` 지시문을 읽고, `tools/` 아래 Python 도구(TTS·이미지/영상 생성·자막·FFmpeg)를 호출해 Remotion/HyperFrames/FFmpeg 로 렌더한다.

- 모든 파이프라인은 idea → script → scene_plan → assets → edit → compose (→ publish) 순서이고, 단계마다 **사람 승인 게이트**가 있다.
- 결과물은 OpenMontage 안의 `projects/<project-id>/renders/final.mp4`.
- 업로더는 없다. 게시(인스타·유튜브)는 사람이 직접 한다.

CocoTrip 이 쓰는 방식: `hybrid` 파이프라인 + anchor medium `still_sequence` = **우리 실사 사진**을 슬로 줌·팬으로 엮고,
`src/data/tours.ts` 의 사람 번역 문구(ko/en/ja/zh)를 자막·카드로 얹는다. 기계 번역(localization-dub, beta)은 쓰지 않는다.

`docs/DESIGN-EDITORIAL-CONCIERGE.md` §4·§5 와 같은 원칙이다 — 실사 사진과 실제 일정이 장식이고, "AI" 는 헤드라인이 아니다.

---

## 2. 왜 레포에 넣지 않나

| 이유 | 내용 |
|---|---|
| **AGPL-3.0** | 공개 서비스(Vercel) 코드베이스에 섞이면 §13 네트워크 소스 공개 의무 위험. 별도 체크아웃으로 "도구로 실행"만 한다. vendoring·submodule·`api/`·`src/` import 금지. |
| **크기** | 작업 트리 약 92MB + `.git` 약 72MB (커밋 9327439 실측). Python 도구 188개, `.claude/skills` 49개, `.agents/` 하위 서드파티 skill 다수. |
| **Python** | Python 3.10+ venv, pip 의존성(대부분 `>=` 미고정), FFmpeg, Remotion(Node). 우리 빌드(`tsc -b && vite build`)와 무관하다. |
| **에이전트 지시 충돌** | OpenMontage 의 `CLAUDE.md`("MANDATORY: Read AGENT_GUIDE.md before responding to ANY user message"), `.claude/skills`, `.claude/launch.json` 이 CocoTrip 세션에 섞이면 우리 규칙(`cocotrip-money-safety` 등)과 경쟁한다. CocoTrip 의 `.claude/` 에 복사 금지. |
| **배포 무관** | 영상은 운영 작업물이지 웹앱 기능이 아니다. 출력도 gitignore 된 `outputs/` 에만 쓴다. |

---

## 3. 라이선스 메모 (법률 자문 아님 — 최종 판단은 운영자)

- **OpenMontage = AGPL-3.0** (LICENSE 1행). 상업적 사용 제한 조항은 없다. 수정본을 네트워크로 제공할 때 소스 공개 의무가 생긴다.
  별도 도구로 실행만 하면 CocoTrip 코드에 의무가 생기지 않는다고 본다. 렌더된 MP4 에 OpenMontage 자체 에셋(마스코트 등)을 넣지 않는다.
- **Remotion = 별도 라이선스.** OpenMontage 의 `.claude/skills/remotion/SKILL.md` 가 직접 경고한다:
  "Remotion has a special license. Companies may need to obtain a license for commercial use."
  → **회사 라이선스 필요 여부를 https://remotion.dev/license 에서 운영자가 확인**한 뒤 상업 영상에 쓴다(미검증).
  Remotion 대신 FFmpeg/HyperFrames 경로도 있으나 HyperFrames npm 패키지 라이선스는 레포에 명시가 없다(미검증).
- **음악**: `music_library/` 에 직접 넣은 곡만 쓴다. 출처·상업 이용 가능 여부 증빙을 보관한다. 유료 생성 음악은 요금제별 약관 확인.
- **TTS·생성 제공자 약관**: 무료 티어는 상업 이용 제한이 있을 수 있다. 예: OpenMontage `docs/PROVIDERS.md` 의 fish.audio
  `s2.1-pro-free` 는 "commercial use is restricted" 로 적혀 있다(같은 문서 기준 이 무료 프로모션은 2026-08-31 종료). 쓰기 전에 그 제공자 약관을 확인한다.
- **사진 (KTO 공공누리)**: `public/Type1_<제목>_<촬영/제공>_<id>.jpg` 는 한국관광공사 공공누리 **제1유형(출처표시)** 으로 보인다(파일명 기준 추정, 미검증).
  - 제1유형만 상업 영상 + 크롭/모션에 문제가 없다. 제2유형(상업 금지)·제3유형(변경 금지)·제4유형은 생성기가 **NEEDS REVIEW** 로 분류한다.
  - 출처표기는 생성기가 만든 `CREDITS.txt` 의 END CARD 줄을 그대로 쓴다. 기관명 표기는 사이트가 이미 쓰는 것과 같다
    (`src/sections/home/homeCopy.ts` photoCredit: 사진: 한국관광공사 / Korea Tourism Organization / 韓国観光公社 / 韩国观光公社).
  - `/tourists/people-*.webp`, `/<지역>/<지역> (n).jpg`, `region-*`/`hero-*` 는 **출처 불명** → NEEDS REVIEW. 사람이 찍힌 사진은 초상권(모델 동의)도 확인.
  - `id_제목.webp` (예: `/JnR5Ie_경복궁(1).webp`) 은 KTO 원본의 재인코딩본으로 보이나 크레딧이 파일명에 없다. 같은 id 의 `Type1_` 원본이 `public/` 에 있으면 생성기가 크레딧을 복원한다.

---

## 4. 설치 (CocoTrip 레포 **밖**, 커밋 고정)

전제: Python 3.10+ (`.python-version` = 3.10, `setup.py` `python_requires=">=3.10"`), FFmpeg, Node 18+(README 기준. CocoTrip 은 Node 22 사용), Claude Code.

```bash
# 레포 밖 경로 (예시). CocoTrip 폴더 안에 클론하지 않는다.
git clone https://github.com/calesthio/OpenMontage.git ~/work/OpenMontage
cd ~/work/OpenMontage
git checkout 9327439db69021ab4b0e2776729bf3b58fdb5a87
git rev-parse HEAD            # 9327439db69021ab4b0e2776729bf3b58fdb5a87 인지 확인
```

`make setup` 대신 **수동 단계**를 쓴다. `Makefile` 의 `setup` 타깃은 아래를 순서대로 하는데, 그중 일부가 고정되지 않은 최신본을 받는다.

| `make setup` 이 하는 일 (Makefile 실측) | 수동 대응 |
|---|---|
| `ensure-venv`: uv 가 있으면 `uv venv`, 없으면 `python -m venv .venv` (+ 3.10 이상인지 검사) | 버전 확인 후 `python3 -m venv .venv` — 수동 단계에는 이 검사가 없다. macOS 의 Xcode 도구 `python3` 는 3.9 인 경우가 있다(미검증) |
| `pip install -r requirements.txt` (전부 `>=` 미고정) | 같음. 버전 고정이 필요하면 설치 후 `pip freeze` 를 따로 보관 |
| `cd remotion-composer && npm install` | **`npm ci`** — `remotion-composer/package-lock.json` 이 있으므로 lockfile 그대로 설치 |
| `pip install piper-tts` (미고정, 오프라인 TTS) | 선택. 필요할 때만 |
| `npx --yes hyperframes --version` (최신 npm 패키지를 캐시에 받음) | **생략.** HyperFrames 가 필요해지면 그때 승인 후 |
| `.env.example` → `.env` 복사(없을 때만) | `cp -n .env.example .env` |

```bash
cd ~/work/OpenMontage
python3 -c 'import sys; assert sys.version_info >= (3, 10), sys.version'   # 오류가 나면 3.10 이상(python3.11 등)으로 바꿔서 아래 줄 실행
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
(cd remotion-composer && npm ci)
cp -n .env.example .env
# 선택: .venv/bin/python -m pip install piper-tts
```

- 키 없이 되는 확인: `make demo` (`render_demo.py`, Remotion 데모 렌더), `make preflight` (도구 레지스트리 provider 메뉴 출력). 둘 다 미검증.
- 로컬 보드(Backlot)는 `127.0.0.1:4750` 에만 바인딩된다(`backlot/__main__.py`).
- HyperFrames 를 쓰게 되면 `HYPERFRAMES_SKIP_SKILLS=1` 을 켠다 — 안 켜면 `npx hyperframes init` 이 매번 GitHub 를 확인하고, 하나라도 오래됐으면 에이전트 skill 파일 전체를 최신본으로 덮는다(`--skip-skills` 플래그는 현재 무력화됨, `.agents/skills/hyperframes/SKILL.md`).
- OpenMontage 용 Claude Code 설정을 CocoTrip 에 복사할 필요는 없다. OpenMontage 폴더에서 `claude` 를 실행하면 그쪽 `CLAUDE.md`·skills 가 자동으로 로드된다.

---

## 5. 키 격리 — CocoTrip 운영 키 재사용 금지

**CocoTrip 의 `GEMINI_API_KEY`·`GOOGLE_APPLICATION_CREDENTIALS` 를 OpenMontage 가 집어 가면, Veo·Imagen·TTS 비용이 CocoTrip 운영 키로 청구된다.**

근거 (커밋 9327439 소스):

- `tools/google_credentials.py:42`·`:58` — `GOOGLE_API_KEY or GEMINI_API_KEY` 로 **GEMINI_API_KEY 를 별칭으로 받는다**.
  `GOOGLE_APPLICATION_CREDENTIALS` 가 가리키는 서비스 계정 파일도 그대로 쓴다(Vertex 경로).
- `tools/video/gemini_omni_video.py:183` — 이 도구는 반대로 **`GEMINI_API_KEY` 를 먼저** 본다. `.env` 에 마케팅 키를 넣어도 셸에 CocoTrip 키가 있으면 그게 이긴다.
- `tools/base_tool.py` `_load_dotenv()` — "Only sets variables that are not already in the environment". 즉 **셸에 export 된 값이 `.env` 보다 우선**한다.
  (`lib/env_loader.py` 의 `load_dotenv` 도 기본값이 override 안 함.)
- 다행인 점: `.env` 경로는 OpenMontage 루트로 고정이라(`base_tool.py:32`) CocoTrip 의 `.env` 를 거슬러 읽지는 않는다.

CocoTrip 쪽 사용처: `GEMINI_API_KEY` 는 `api/` 의 AI 플래너·번역·챗 등 여러 곳과 `scripts/plan-local/`, `GOOGLE_APPLICATION_CREDENTIALS` 는 `scripts/deploy-firestore-indexes-rest.mjs` 가 읽는다.

**규칙**

1. 마케팅 전용 Google 프로젝트 + 전용 API 키를 새로 만들고, 그 프로젝트에 **예산 알림**을 건다.
   예산 알림은 **알림이지 자동 차단이 아니다** — `docs/GOOGLE-PLACES-COST-HARD-STOP-2026-08-31.md` 의 오답("예산 알림을 강제 차단으로 잘못 취급")을 반복하지 않는다.
2. 그 키는 **OpenMontage/.env 의 `GOOGLE_API_KEY=` 에만** 넣는다. `GEMINI_API_KEY` 줄은 비워 둔다.
3. CocoTrip 의 `FIREBASE_*`, `PAYPAL_*`, `GEMINI_API_KEY`, `NCP_*` 등 운영 비밀은 OpenMontage/.env 에 **절대** 넣지 않는다.
4. 실행 전 셸 확인 (값은 출력하지 않고 **이름만** 본다):

   ```bash
   env | cut -d= -f1 | grep -E '^(GEMINI|GOOGLE|GCLOUD|OPENAI|FAL|FIREBASE|PAYPAL|NCP)' || echo "clean"
   ```

5. Claude Code 는 항상 이렇게 띄운다:

   ```bash
   cd ~/work/OpenMontage
   env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS -u OPENAI_API_KEY claude
   ```

   `-u GOOGLE_API_KEY` 는 셸에 다른 프로젝트의 `GOOGLE_API_KEY` 가 export 돼 있을 때 그 값이 `.env` 의 마케팅 키를 이기는 것을 막는다
   (셸 값이 우선 — 위 `_load_dotenv`). 셸에서 빼도 마케팅 키는 OpenMontage `.env` 에서 다시 채워진다.
   위 확인에서 `GOOGLE_GENAI_USE_VERTEXAI`·`GOOGLE_GENAI_USE_ENTERPRISE`·`GOOGLE_CLOUD_PROJECT`·`GOOGLE_CLOUD_PROJECT_ID`·`GCLOUD_PROJECT`·`FAL_KEY` 같은 이름이 보이면
   같은 방식(`-u 이름`)으로 함께 뺀다(`tools/google_credentials.py` 가 Vertex 경로·프로젝트 선택에 이 이름들을 읽는다).

---

## 6. config.yaml 예산 cap

OpenMontage 기본값은 `budget.mode: warn`(예산 초과 시 경고만 기록하고 막지 않음 — `tools/cost_tracker.py` `reserve()`) / `total_usd: 10.00` 이다. 처음 영상은 작게 잡는다:

```yaml
budget:
  mode: cap                      # observe | warn | cap
  total_usd: 1.00                # 생성기 기본 --budget 1 과 맞춘다
  reserve_pct: 0.10
  single_action_approval_usd: 0.50
  require_approval_for_new_paid_tool: true
```

주의 (미검증): 커밋 9327439 소스를 grep 했을 때 `tools/cost_tracker.py` 의 `CostTracker` 와 `lib/config_model.py` 를
**테스트 외 코드에서 import 하는 곳이 없었다.** 즉 `mode: cap` 이 코드로 강제되는지 확인하지 못했다 — 에이전트가 읽고 지키는 "지시"일 수 있다.
그래서 실제 안전장치는 세 겹이다: (1) 마케팅 전용 키, (2) 제공자 쪽 예산 알림/한도, (3) prompt.md 의 "유료 호출마다 먼저 묻기" + 사람이 매번 승인.

비용 0 경로(권장 시작점): 우리 사진 + Remotion 템플릿 + 내레이션 없음 + `music_library/` 곡.

---

## 7. 단계별 절차

### 7-1. CocoTrip 에서 입력 파일 만들기

```bash
# CocoTrip 레포 루트에서
npm run marketing:video-brief -- --tour gyeongju-day-tour                      # 4개 locale, instagram, 30초, $1
npm run marketing:video-brief -- --tour gyeongju-day-tour --locale en --platform youtube --seconds 45 --budget 2
npm run marketing:video-brief -- --all --locale en
npm run marketing:video-brief -- --help                                        # 한/영 사용법
# (npm script 가 없을 때는 node scripts/export-openmontage-brief.mjs 로 같은 인자)
```

| 옵션 | 값 | 기본 |
|---|---|---|
| `--tour` | slug 또는 id, 쉼표로 여러 개 | (필수, 또는 `--all`) |
| `--locale` | `ko,en,ja,zh` 중 | 4개 전부 |
| `--platform` | `instagram`→`instagram_reels`(최대 90초) / `youtube`→`youtube_shorts`(60초) / `tiktok`→`tiktok`(600초) | `instagram` |
| `--seconds` | 1 ~ 플랫폼 상한 | 30 |
| `--budget` | 0 ~ 20 USD (prompt.md 의 상한 문구) | 1 |
| `--out` | 출력 폴더. `public/`·`src/`·`api/`·`dist/` 안(그곳을 가리키는 심볼릭 링크 경유 포함)과 레포 루트는 거부 | `outputs/openmontage-briefs` (gitignore) |

종료 코드: 0 = 전부 생성 / 1 = 일부 locale 을 데이터 부족으로 건너뜀 / 2 = 잘못된 인자(사용법 출력).

출력: `outputs/openmontage-briefs/<slug>/<locale>/`

- `brief.json` — OpenMontage `schemas/artifacts/brief.schema.json` (version `1.0`) 형식. 필수 필드 + `metadata`(정류지·사진·제약·예산).
- `prompt.md` — OpenMontage 에서 연 Claude Code 에 붙여넣을 영어 지시문(하드 제약 포함).
- `CREDITS.txt` — END CARD 크레딧 줄 / NEEDS REVIEW 사진 / 복사한 사진 전체 목록.
- `photos/` — `public/` 의 로컬 사진 사본. 파일명은 ASCII(`01-stop-1.jpg`, `03-gallery.webp` …)로 바꾼다(한글·공백·쉼표·괄호 파일명은 셸/FFmpeg 에서 깨지기 쉽다). http(s) URL 사진은 복사하지 않고 목록에 남긴다.
  사진 사본이 크다 — 사진은 locale 마다 따로 복사된다. 실측(2026-10-07, 정적 투어 9개): 경주 1개 투어 4개 locale 약 97MB,
  `--all --locale en` 약 150MB, **`--all` (4개 locale) 약 580MB**. 디스크 여유를 확인하고, 필요한 투어·locale 만 뽑고, 다 쓰면 지운다(아래 7-6).

생성기가 하는 것 / 안 하는 것:

- 네트워크·env·Firestore 접근 없음. `src/data/tours.ts` 를 Vite `ssrLoadModule` 로 읽는다(`envDir: false` — `.env` 도 안 읽음). 어드민(Firestore) 등록 투어는 범위 밖.
- **가격·할인·평점·후기 수 필드를 만들지 않는다.** 영상은 가격보다 오래 남고 가격 SSOT 는 사이트다. stop 의 `tip`(가격 포함)·`entry_fee_krw` 도 넣지 않는다.
- 원문 문구 중 가격("free"·₩ 등)·평점·최상급("best"·"No.1"·"iconic"·"최대"·"必去"·"精华" 등)·식이(할랄·비건·알레르기)·"AI" 표현은 **문장 단위로 빼고 warning** 을 출력한다. 빠진 문구는 터미널 warning 에만 남고 brief 에는 없다.
  - 부분 삭제는 "앞 구 — 꼬리 구" (대시 1개) 에서 꼬리 구만 위험하고 그 꼬리가 부정·한정("only"·"not"·"추가"·"不" 등)이 아닐 때만 한다. 그 밖에는 뜻이 바뀔 수 있어 문장 전체를 뺀다.
  - 보수적으로 잡으므로 정상 문장도 빠질 수 있다(예: "정숙 관람 필수" 의 '필수'). 빠진 사실이 영상에 꼭 필요하면 `tours.ts` 원문을 고치는 게 맞다 — brief.json 을 손으로 고치지 않는다.
- locale 문자열이 없으면 **다른 언어로 폴백하지 않는다** — 생략 + warning. 필수 필드(title/hook/key_points)가 비면 그 locale 은 쓰지 않는다(종료 코드 1).
- 근거 없는 배지 태그(Popular / Best Value / AI-Curated)는 `src/data/tours.ts` 의 `isUngroundedBadgeTag` 로 뺀다.
- 정류지 사진: `tours.ts` 에 지정된 사진(`photo_link: tour_data`). 없으면 KTO 사진 제목이 정류지 한국어 정식 명칭과 **정규화 후 완전히 같을 때만** 연결(`kto_title_match`). 부분 일치는 연결하지 않는다(`docs/TOUR-PHOTO-AUDIT-MISTAKE-NOTES-2026-08-22.md` 함정 4).

### 7-2. OpenMontage 로 복사

```bash
# 예: 경주 / 영어
mkdir -p ~/work/OpenMontage/projects/cocotrip-gyeongju-day-tour-en/inputs
cp -R outputs/openmontage-briefs/gyeongju-day-tour/en/. ~/work/OpenMontage/projects/cocotrip-gyeongju-day-tour-en/inputs/
```

프로젝트 id 규칙은 `cocotrip-<slug>-<locale>` (prompt.md 에 그대로 적혀 있다). OpenMontage 의 `projects/` 는 그쪽 `.gitignore` 대상이다.

### 7-3. OpenMontage 에서 Claude Code 실행

```bash
cd ~/work/OpenMontage
env | cut -d= -f1 | grep -E '^(GEMINI|GOOGLE|GCLOUD|OPENAI|FAL|FIREBASE|PAYPAL|NCP)' || echo "clean"
env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS -u OPENAI_API_KEY claude
```

그다음 `inputs/prompt.md` 에서 `---` 아래 전부를 붙여넣는다.

### 7-4. 게이트 승인

`hybrid` 파이프라인은 idea / script / scene_plan / assets / publish 에서 멈추고 승인을 기다린다(`pipeline_defs/hybrid.yaml` `human_approval_default: true`).

- 게이트마다 산출물을 **읽고** 승인한다. "전부 승인" 같은 일괄 승인은 하지 않는다.
- script 게이트: 모든 문장이 brief.json 에 있는지, 가격·최상급·식이·"AI" 표현이 없는지.
- scene_plan 게이트: 정류지 카드 뒤 사진이 그 장소 사진인지(`photo_link`), gallery 사진에 장소 캡션이 없는지.
- assets 게이트: **생성 이미지/영상 도구 호출이 0** 인지, 유료 호출이 있었다면 사전 승인한 것인지, NEEDS REVIEW 사진을 쓰지 않았는지.
- Remotion vs HyperFrames 선택을 물어오는 건 정상이다(AGENT_GUIDE 의 "present both runtimes" 규칙). 패키지 설치·`npx hyperframes` 는 승인 전 금지로 프롬프트에 박혀 있다.

### 7-5. 결과물

`~/work/OpenMontage/projects/cocotrip-<slug>-<locale>/renders/final.mp4`. 9절 체크리스트를 통과한 뒤 **사람이 직접** 업로드한다.
게시 캡션 링크는 prompt.md 의 "Post caption link"(UTM 포함 URL)를 쓴다.

### 7-6. 정리

```bash
rm -rf outputs/openmontage-briefs/<slug>     # CocoTrip 쪽 사본 (gitignore 라 커밋엔 안 들어가지만 용량이 크다)
rm -rf outputs/openmontage-briefs            # --all 로 만들었으면 통째로
```

---

## 8. 예시 프롬프트 (생성기 실제 출력 — 경주 / en / instagram / 30초 / $1)

`npm run marketing:video-brief -- --tour gyeongju-day-tour --locale en` 이 만든 `prompt.md` 의 `---` 아래 본문이다.
문구를 고칠 때는 이 문서가 아니라 `scripts/lib/openmontage-brief.mjs` (`HARD_CONSTRAINTS`, `buildOpenMontagePrompt`) 를 고치고 테스트를 돌린다.

````text
Use the `hybrid` pipeline with anchor medium `still_sequence` (CocoTrip's own real photos) to make a 30-second 9:16 Instagram Reels video (media profile `instagram_reels`) in English.

Project id: `cocotrip-gyeongju-day-tour-en`. Inputs (read-only): `projects/cocotrip-gyeongju-day-tour-en/inputs/brief.json`, `projects/cocotrip-gyeongju-day-tour-en/inputs/CREDITS.txt` and the photos in `projects/cocotrip-gyeongju-day-tour-en/inputs/photos/`. brief.json is the only source of facts.

## Hard constraints (non-negotiable)

1. Use only the real photos supplied in the inputs photos/ folder. Motion such as slow zooms, pans and crops is fine. Do not pull stock footage or archive clips.
2. Do not generate AI images or AI video of real places or real people, and do not generate a logo or a hero shot. No avatars, no face or voice cloning.
3. Every factual line (place names, times, durations, what is included) must come from brief.json. Do not add facts from web research, from memory, or by translating another language's brief.
4. Do not mention prices, currency amounts, discounts, coupons, deals or "free". The website is the only source of prices.
5. Do not mention ratings, reviews, star counts or customer counts, and do not use superlatives or hype ("best", "#1", "most popular", "must-see", "guaranteed").
6. Do not say or imply that any food, meal or restaurant is halal, vegan, vegetarian, allergy-safe or gluten-free.
7. Do not lead with "AI" and do not present CocoTrip as an AI product. Lead with the itinerary: real places, timed stops, a private vehicle.
8. Burn in subtitles in the target language, using the brief.json strings verbatim.
9. Credit every photo you use on the end card, copying the lines from CREDITS.txt verbatim (do not translate or romanize names). Do not use a photo listed under NEEDS REVIEW until I confirm it.
10. Total paid provider spend for this project must stay at or under $1.00 USD. Ask me before every paid API call, even under the cap, and show the estimated cost first.

## Structure

- Hook (first 2 to 3 seconds): the photo with `is_cover: true` in `metadata.photos`, with on-screen text taken from `hook` in brief.json (you may shorten it by dropping items, never by adding words).
- Itinerary: the 5 entries of `metadata.stops` in order, each as a time + place card over that stop's own `photo` when it has one (`photo_link` says whether the link comes from CocoTrip's tour data or from an exact match with the KTO photo title). A stop without a photo gets a plain card: never put another place's photo behind it.
- Photos with role `gallery` are atmosphere only: no place caption, and never next to a stop card for a different place.
- Key points: pick from `key_points` only, as short text cards. Do not rephrase them into claims they do not make.
- End card: `cocotripkr.com/tours/gyeongju-day-tour`, then the photo credit lines from CREDITS.txt for the photos you actually used.
- Post caption link (not on screen): `https://cocotripkr.com/tours/gyeongju-day-tour?utm_source=instagram&utm_medium=social_video&utm_campaign=tour_video&utm_content=gyeongju-day-tour_en`.

## Subtitles and audio

- Burn in English subtitles (language code en-US) using the brief.json strings verbatim. Use a font with full Latin glyph coverage and check that every glyph renders before the final render.
- Audio: show me two options with their cost before choosing: (a) no narration, with a track I placed in `music_library/` (I confirm its licence); (b) English narration with a voice for en-US from the provider menu. Do not generate music with a paid provider without asking.

## Budget, approvals and safety

- Budget cap: $1.00 USD in total for paid provider calls. Check that `config.yaml` has `budget.mode: cap` and tell me before starting if it does not.
- Stop at every approval gate (idea, script, scene plan, assets, publish) and wait for my explicit approval. Approving one gate does not approve the next.
- Do not install or update any package, and do not run `npx hyperframes` commands, without asking me first.
- Do not upload or publish anything. The deliverable is `projects/cocotrip-gyeongju-day-tour-en/renders/final.mp4`.
- 8 photo(s) are listed under NEEDS REVIEW in CREDITS.txt. Ask me before using any of them.

## If something is missing

If brief.json lacks a fact you need, leave it out or ask me. Never fill the gap from the web, from memory, or by translating the brief of another language.
````

---

## 9. 게시 전 체크리스트

- [ ] **사실 대조**: 영상 속 장소명·시간·체류시간·포함 항목이 brief.json 과 같고, brief.json 은 지금 사이트 `/tours/<slug>` 내용과 같다(`tours.ts` 가 바뀌었으면 brief 를 다시 만든다).
- [ ] **가격 없음**: 금액·통화·할인·쿠폰·"free/무료"·"딜" 없음. 게시 캡션에도 없음.
- [ ] **평점·최상급 없음**: 별점·후기 수·고객 수·"best/No.1/인기/필수/最大/必去" 없음.
- [ ] **식이 주장 없음**: 할랄·비건·채식·알레르기·글루텐 안전 암시 없음(CLAUDE.md: `verified: true` 는 식이 안전 보장이 아니다).
- [ ] **"AI" 로 시작하지 않음**: 훅·첫 자막·캡션 첫 줄에 AI 없음.
- [ ] **사진**: 생성 이미지/영상 0, 스톡·아카이브 클립 0. 정류지 카드 뒤 사진 = 그 장소. NEEDS REVIEW 사진은 미사용이거나 라이선스 확인 완료.
- [ ] **크레딧**: 사용한 KOGL 사진 전부 엔드카드에 CREDITS.txt 문구 그대로. 이름을 번역·로마자화하지 않음.
- [ ] **음악**: 출처와 상업 이용 가능 증빙 보관. TTS 를 썼다면 그 제공자 약관(무료 티어 상업 제한) 확인.
- [ ] **자막**: 대상 locale 언어, 글리프 깨짐(빈 네모) 없음, 원문 그대로.
- [ ] **CTA**: 엔드카드 `cocotripkr.com/tours/<slug>` 가 실제로 열리는지 사람이 브라우저로 확인.
- [ ] **폰에서 확인**: 세로 9:16, 자막이 플랫폼 UI 에 가리지 않음, 소리 끈 상태로도 이해됨.
- [ ] **비용**: 제공자 콘솔의 실제 지출이 예산 안. CocoTrip 운영 Gemini 키 사용량에 변화 없음.
- [ ] **업로드는 수동**. Remotion 렌더를 썼다면 Remotion 라이선스 확인을 마친 뒤.

---

## 10. CocoTrip 쪽 검증 방법

```bash
npx vitest run tests/unit/openmontage-brief.test.ts   # 생성기 잠금 테스트
npm run test:unit                                     # 전체 단위 테스트
```

테스트가 잠그는 것: 정적 투어 전체 × ko/en/ja/zh 의 스키마 필수 필드(또는 명시적 warning), 가격·평점 키 0, 통화 표기 0, stop tip 미포함,
근거 없는 배지 태그 0, en/ja/zh 문구에 원문에 없던 한글 0, 다른 언어 폴백 0, 위험 표현 필터, KTO 파일명 크레딧 파서(실제 `public/` 파일),
사진 경로 안전성(원격·`..`·누락), prompt.md 하드 제약 전부, CLI 잘못된 인자 → exit 2 / `--help` → exit 0,
부분 삭제가 뜻을 바꾸는 경우(대시 2개·앞 구·부정 꼬리) 문장 전체 삭제, 약어(`Mt.`·`No. 1`) 뒤 미분할, 필터 결과의 스캐너 재통과,
`--out` 이 심볼릭 링크로 `public/`·`src/` 나 레포 루트를 가리켜도 거부.

스키마 원본과의 대조(`brief.schema.json`, 커밋 9327439)는 생성기 안의 `validateOpenMontageBrief()` 가 같은 규칙(required·const·enum·타입·additionalProperties:false)을 재현한다.
OpenMontage 를 올리면 스키마가 바뀌었는지 먼저 보고 이 함수와 테스트를 같이 고친다.

---

## 11. 미검증 목록 (운영자 확인 필요)

- **OpenMontage 실행 전체**: 이 작업에서는 클론을 읽기만 했다. 설치(`pip`/`npm ci`)·`make demo`·`make preflight`·파이프라인 실행·렌더 품질 모두 미검증.
- **Remotion 회사 라이선스** 필요 여부(remotion.dev/license). HyperFrames 패키지 라이선스.
- **`budget.mode: cap` 의 코드 강제 여부** (6절 — 소스 grep 상 `CostTracker` 를 쓰는 비테스트 코드가 없음).
- **KTO 사진**: 공공누리 유형·크레딧 문구는 파일명 기준 추정. 원본 페이지에서 확인 필요. 출처 불명 사진(`/tourists/*`, `/<지역>/*`, `region-*`, `hero-*`)의 라이선스·초상권.
- **자막·음성 품질**: Remotion 의 한국어/일본어/중국어 폰트 렌더, Google TTS 언어별 음성 품질, Piper 한국어 음성 유무.
- **키 격리의 충분성**: `env -u` 는 지정한 이름만 뺀다. 셸 rc·direnv·gcloud 기본 자격증명(ADC) 경로로 다른 자격증명이 잡히는지는 확인하지 않았다(Vertex 경로 `GOOGLE_GENAI_USE_VERTEXAI` 사용 시 특히).
- **플랫폼 사양**: 인스타 릴스·유튜브 쇼츠·틱톡의 현재 길이·해상도 정책(OpenMontage `lib/media_profiles.py` 값 기준으로만 맞춤).
- **게시 결과**: 업로드·노출·UTM 집계(`src/lib/analytics.ts` 가 utm_* 를 저장) 는 실제 게시 후에만 확인 가능.
