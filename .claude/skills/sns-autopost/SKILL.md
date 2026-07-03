---
name: sns-autopost
description: 멀티 클라이언트 인스타그램 캐러셀 자동 발행 스킬 v2. "인스타 발행", "캐러셀 올려줘", "SNS 자동화", "포스팅 자동화", "새 클라이언트 셋업", "발행 스케줄" 요청 시 사용. Meta Graph API + Playwright 렌더 + Cloudinary + 카카오톡 알림. 단일 명령 파이프라인(run.js)과 GitHub Actions cron 기반.
---

# sns-autopost — 인스타그램 캐러셀 자동 발행 (v2)

멀티 클라이언트 구조. 클라이언트별 설정은 `clients/<client>/`에 있고, 스크립트·워크플로는 공용이다.
**절대 단계별(렌더/업로드/발행)로 나눠 실행하지 말 것 — 항상 `run.js` 하나로 실행한다.**

## 저장소 구조

```
clients/<client>/
  config.json     # IG 계정, 시간대, 기본 해시태그, 알림 설정
  brand.md        # 브랜드 가이드(색·톤·금칙어) — 콘텐츠 제작 시에만 읽기
  schedule.json   # 발행 스케줄 (post 배열)
  templates/      # 캐러셀 HTML 템플릿
  content/<post-id>/  # 포스트별 슬라이드 HTML + caption.txt
data/<client>/published.json  # 발행 이력 (자동 관리 — 직접 수정 금지)
scripts/run.js    # 통합 파이프라인
dashboard/        # 콘텐츠 관제실 (Actions가 자동 갱신 → GitHub Pages)
```

**대시보드가 곧 제품이다** — sns채널-자동화 스킬(pslab)의 관제실 구조를 따른다:
채널 탭(전체/채널별) · 오픈 준비 체크리스트 · 채널 바로가기(그라데이션 카드) · 주간 종합 리포트 ·
KPI · 성과 인사이트·자체 학습 · 채널별 요약 · 월 콘텐츠 기획안(카드 그리드 → 클릭 시 캐러셀 전체보기 +
발행 캡션 + GitHub 이슈 수정요청) · 5분 자동 새로고침 · window.onerror 빈화면 가드.
생성기: `scripts/build-dashboard.js` (자가완결형 HTML 1장, `--inline`이면 이미지까지 임베드).

## 핵심 명령

```bash
# 테스트 (발행 제외 전 과정: 렌더→업로드→미리보기 JSON)
node scripts/run.js --client <client> --test

# 실제 발행 (오늘 스케줄분. --post-id로 특정 포스트만)
node scripts/run.js --client <client> --live

# 특정 날짜/포스트 발행
node scripts/run.js --client <client> --live --date 2026-07-10
node scripts/run.js --client <client> --live --post-id 2026-07-10-print-tips

# 성과 수집 (대시보드 데이터 갱신)
node scripts/insights.js --client <client>
```

결과는 stdout 마지막 줄의 JSON 한 줄로 요약된다 (`{"ok":true,"published":[...],"skipped":[...]}`). 이 JSON만 읽고 사용자에게 보고하면 된다.

## 워크플로별 절차

### A. 포스트 발행 (가장 빈번)
1. `schedule.json`에 해당 포스트가 있고 `content/<post-id>/`에 슬라이드가 준비됐는지 확인
2. `--test`로 파이프라인 검증 → 미리보기 확인
3. `--live` 실행 → 결과 JSON 보고
- 이미 발행된 post-id는 자동 스킵(멱등). 강제 재발행은 `--force`.

### B. 콘텐츠(캐러셀) 제작
1. `clients/<client>/brand.md` 읽기 (이때만)
2. 필요 시 `references/carousel-design.md` 읽기
3. `templates/`의 템플릿을 복사해 `content/<post-id>/slide-01.html … slide-NN.html` 작성 (1080×1350)
4. `caption.txt` 작성 (본문 + 해시태그. config의 기본 해시태그는 자동 병합)
5. `schedule.json`에 항목 추가
6. `--test`로 렌더 확인

### C. 신규 클라이언트 온보딩
`references/setup-guide.md`를 읽고 진행 (Meta 토큰·Cloudinary·Kakao 토큰 발급 + GitHub secrets 등록 + clients/ 폴더 생성). 이 문서는 온보딩 때만 로드할 것.

### D. 자동 발행 (무인)
`.github/workflows/autopost.yml`이 매일 cron으로 `run.js --live --all-clients`를 실행하고 대시보드를 갱신한다. 에이전트가 할 일은 스케줄·콘텐츠 준비까지다.

## 규칙

- 발행 실패·에러 시에만 `references/troubleshooting.md` 로드
- secrets(.env, 토큰)는 절대 커밋 금지. GitHub Actions secrets 사용: `META_ACCESS_TOKEN`, `IG_USER_ID__<CLIENT>`, `CLOUDINARY_URL`, `KAKAO_REST_KEY`, `KAKAO_REFRESH_TOKEN`
- `published.json`·`dashboard/data/`는 스크립트가 관리한다. 손으로 고치지 말 것
- 슬라이드는 1080×1350(4:5) 고정, 최대 10장, 웹폰트는 로컬/구글폰트 CDN만
- 사용자가 "테스트"를 명시하지 않아도 첫 발행이거나 콘텐츠가 새로 만들어졌으면 반드시 `--test` 먼저
