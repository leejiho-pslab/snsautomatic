# snsautomatic — SNS 채널 자동화 시스템 (sns-autopost v2)

멀티 클라이언트 인스타그램 캐러셀 자동 발행 + 운영 대시보드.
첫 적용 클라이언트: **동성인쇄소** (`clients/dongsung-print/`).

## 구조

```
.claude/skills/sns-autopost/   # 자동화 스킬 v2 (SKILL.md + references/)
clients/<client>/              # 클라이언트별 설정·브랜드·스케줄·콘텐츠
scripts/                       # 파이프라인 (render→upload→publish→notify→dashboard)
dashboard/                     # 운영 대시보드 (GitHub Pages 배포)
data/<client>/published.json   # 발행 이력 (멱등성)
docs/skill-review.md           # v1 스킬 검토 보고서 (개선 근거)
.github/workflows/             # autopost cron + dashboard 배포
```

## 빠른 시작

```bash
npm ci
cp .env.example .env   # 토큰 채우기 (발급 절차: .claude/skills/sns-autopost/references/setup-guide.md)

# 테스트 (발행 없이 렌더→업로드→미리보기)
node scripts/run.js --client dongsung-print --test

# 실제 발행 (오늘 스케줄분)
node scripts/run.js --client dongsung-print --live

# 대시보드 로컬 확인
node scripts/build-dashboard.js
python3 -m http.server 8000 --directory dashboard   # → http://localhost:8000
```

## 자동 운영

- **발행**: `.github/workflows/autopost.yml` — 매일 11:00 KST에 due 포스트 자동 발행, 발행 이력·대시보드 데이터 커밋, 카카오톡 알림
- **대시보드**: `.github/workflows/dashboard.yml` — GitHub Pages 자동 배포 (Settings > Pages > Source: GitHub Actions 활성화 필요)
- **필요 secrets**: `META_ACCESS_TOKEN`, `IG_USER_ID__DONGSUNG_PRINT`, `CLOUDINARY_URL`, `KAKAO_REST_KEY`, `KAKAO_REFRESH_TOKEN`

## 오픈 절차

**[docs/오픈-가이드.md](docs/오픈-가이드.md)** — 머지 → Pages → 토큰 등록 → 리허설 → 오픈, 순서대로 따라 하면 됩니다.

## 신규 클라이언트 추가

`clients/_template` 복제 후 `references/setup-guide.md` 절차 수행. 스킬·스크립트 수정 불필요.
