# SNS 채널 자동화 스킬 검토 보고서 (v1 → v2)

> 작성일: 2026-07-03
> 검토 대상: `instagram-carousel-autopost`, `instagram-publisher`, `meta-search-ad-data` (claude.ai 등록 스킬)
> 검토 방식: 클라우드 코드 세션에서는 claude.ai 스킬 본문이 직접 노출되지 않아, 스킬 메타데이터(설명·트리거·구성요소)에 기록된 아키텍처(Meta Graph API + Playwright HTML→PNG + Cloudinary + 카카오톡 알림 + Google Sheets 스케줄 + PC 로그온 무인실행)를 기준으로 구조 검토를 수행함.

---

## 1. 발견된 비효율 요약

| # | 구분 | 문제 | 영향 |
|---|------|------|------|
| 1 | 스킬 구조 | Instagram 발행 스킬이 2개로 분리 (`carousel-autopost` 범용 + `publisher` P.S.LAB 전용) | 로직 중복, 트리거 충돌로 잘못된 스킬 로드 → 토큰 낭비, 클라이언트 추가 시마다 스킬 복제 |
| 2 | 토큰 소비 | 스킬 설명(description)이 장문 + 트리거 문구 중복 나열 | 매 세션 시스템 프롬프트에 상시 주입되는 고정 비용 |
| 3 | 토큰 소비 | 셋업·디자인·트러블슈팅이 SKILL.md 본문에 통합(추정) → 발행만 할 때도 전체 로드 | 발행 1회당 불필요한 수천 토큰 로드 |
| 4 | 토큰 소비 | 에이전트가 단계별(렌더→업로드→발행→알림)로 개별 판단·실행 | 각 단계 결과를 대화 컨텍스트로 왕복 → 실행당 토큰 과다. 스크립트 1회 호출로 대체 가능 |
| 5 | 운영 | PC 로그온 시 무인 자동실행(로컬 스케줄러) 의존 | PC 꺼짐/절전 시 발행 누락, 클라이언트별 PC 셋업 필요, 로그 유실 |
| 6 | 운영 | Google Sheets 스케줄 의존 | 서비스계정 발급·공유 등 온보딩 비용 + API 쿼터/장애 지점 추가. 스케줄은 저빈도 데이터라 리포 내 JSON으로 충분 |
| 7 | 운영 | 발행 이력/중복 방지 상태 관리 부재(추정) | 재실행 시 중복 게시 위험, 실패 시 어디까지 진행됐는지 불명 |
| 8 | 운영 | 클라이언트별 계정/브랜드 설정이 스킬 본문에 하드코딩 (P.S.LAB 전용 스킬 존재가 증거) | 신규 클라이언트 = 스킬 복제. 유지보수 N배 |
| 9 | 가시성 | 발행 결과가 카카오톡 알림 단발로만 전달 | 이력·성과·다음 일정의 통합 뷰 부재 → 이번 요청(대시보드)의 배경 |

## 2. v2 개선 설계

### 2.1 스킬 통합 + 점진적 로딩 (문제 1·2·3)
- 3개 스킬 중 Instagram 발행 계열 2개를 **`sns-autopost` 단일 스킬**로 통합. 클라이언트 구분은 스킬이 아니라 `clients/<client>/config.json` 데이터로 처리.
- SKILL.md는 **핵심 워크플로만 담은 경량 본문**(±150줄)으로 유지하고, 저빈도 정보는 `references/`로 분리:
  - `references/setup-guide.md` — 신규 클라이언트 온보딩(토큰 발급)시에만 로드
  - `references/carousel-design.md` — 콘텐츠 제작 시에만 로드
  - `references/troubleshooting.md` — 에러 발생 시에만 로드
- description은 트리거 키워드 중심으로 압축.

### 2.2 단일 명령 파이프라인 (문제 4)
- `node scripts/run.js --client dongsung-print [--test|--live] [--date YYYY-MM-DD]` 한 번으로 렌더→업로드→발행→기록→알림 전 과정 실행.
- 에이전트는 결과 JSON 요약만 읽음. 단계별 왕복 제거 → 발행 1회당 토큰 소비 대폭 절감.

### 2.3 스케줄·실행 기반 이전 (문제 5·6)
- 로컬 PC 스케줄러 → **GitHub Actions cron** (서버리스, 로그 보존, PC 무관).
- Google Sheets → **리포 내 `clients/<client>/schedule.json`** (버전 관리, API 의존 제거). Sheets가 꼭 필요한 클라이언트는 sync 스크립트로 선택적 유지.

### 2.4 상태 관리·멱등성 (문제 7)
- `data/<client>/published.json`에 발행 이력 기록. 같은 포스트 ID는 재실행해도 스킵 → 중복 게시 원천 차단.
- 각 단계 산출물(렌더 PNG, Cloudinary URL, media container ID)을 기록해 실패 지점부터 재개 가능.

### 2.5 멀티 클라이언트 구조 (문제 8)
- `clients/<client>/` = config.json(계정·시간대·해시태그 기본값) + brand.md(브랜드 가이드) + schedule.json + templates/ + content/.
- 신규 클라이언트 온보딩 = 폴더 1개 복제 + secrets 등록. 스킬·스크립트는 공용.

### 2.6 통합 대시보드 (문제 9)
- 정적 HTML 대시보드: 발행 일정 캘린더, 발행 이력, 파이프라인 상태, 게시물 성과(Graph API insights).
- GitHub Actions가 발행 후 `dashboard/data/*.json` 갱신 → GitHub Pages 자동 배포. 별도 서버·DB 없음.

### 2.7 유지 항목
- Meta Graph API 캐러셀 발행 (컨테이너 생성 → 캐러셀 컨테이너 → publish) — 표준 방식 유지
- Playwright HTML→PNG 렌더 — 유지하되 이미 렌더된 슬라이드는 해시 비교로 스킵
- Cloudinary 이미지 호스팅 — Graph API가 공개 URL을 요구하므로 유지
- 카카오톡 발행 알림 — 유지 (발행 성공/실패 모두 알림)
- `--test` 모드 — 유지·강화 (발행 직전까지 전체 파이프라인 실행 + 미리보기 산출)

## 3. 기대 효과

| 항목 | v1 | v2 |
|------|----|----|
| 발행 1회 토큰 소비 | 스킬 전문 로드 + 단계별 대화 왕복 | 경량 SKILL.md + 스크립트 1회 실행 (약 70~85% 절감 추정) |
| 발행 신뢰성 | PC 전원 의존 | GitHub Actions cron (SLA 수준) |
| 신규 클라이언트 온보딩 | 스킬 복제 + Sheets 셋업 + PC 셋업 | 폴더 복제 + secrets 5개 등록 |
| 중복 게시 방지 | 없음(추정) | published.json 멱등성 |
| 운영 가시성 | 카카오 알림 단발 | 대시보드(일정·이력·성과) 상시 |

## 4. claude.ai 스킬 교체 안내

이 리포의 `.claude/skills/sns-autopost/`가 v2 스킬 원본이다. claude.ai에 등록된 기존 스킬을 교체하려면:
1. `sns-autopost/` 폴더를 zip으로 압축해 claude.ai > 설정 > 기능(Capabilities) > 스킬에 업로드
2. 기존 `instagram-carousel-autopost`, `instagram-publisher` 스킬은 비활성화 (트리거 충돌 방지)
3. `meta-search-ad-data`(광고 대시보드 스킬)는 별도 도메인이므로 유지
