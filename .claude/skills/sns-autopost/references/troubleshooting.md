# 트러블슈팅

에러 발생 시에만 읽는 문서. run.js는 실패 시 stderr에 단계명과 원인을 출력한다.

## 렌더 (render)

| 증상 | 원인/해결 |
|------|-----------|
| `browserType.launch` 실패 | Playwright 브라우저 미설치. CI에서는 `npx playwright install chromium --with-deps`. 클라우드 세션은 `/opt/pw-browsers` 사전 설치 — `PLAYWRIGHT_BROWSERS_PATH` 확인 |
| PNG가 흰 화면 | 웹폰트/이미지 로딩 전 캡처. 렌더러는 `networkidle` 대기함 — 외부 리소스 URL 오타 확인 |
| 텍스트 잘림 | 슬라이드 HTML이 1350px 초과. `overflow:hidden` 확인, 본문 축약 |

## 업로드 (Cloudinary)

| 증상 | 원인/해결 |
|------|-----------|
| 401 | `CLOUDINARY_URL` 형식 오류 (`cloudinary://key:secret@cloud`) |
| 420 | 무료 플랜 쿼터 초과. 다음 달까지 대기 또는 플랜 업그레이드 |

## 발행 (Meta Graph API)

| 코드 | 의미 | 해결 |
|------|------|------|
| 190 | 토큰 만료/무효 | 시스템 사용자 토큰 재발급. 개인 장기 토큰(60일)이라면 시스템 사용자 토큰으로 교체 권장 |
| 10 / 200 | 권한 부족 | `instagram_content_publish` 권한, 페이지-IG 연결 확인 |
| 9004 / 2207052 | 이미지 URL 접근 불가 | Cloudinary URL이 공개인지, https인지 확인 |
| 25 (rate limit) | 시간당 발행 한도(계정당 API 발행 50회/24h) | 대기 후 재시도. `--all-clients`에서 클라이언트 간 30초 간격 두는 것 확인 |
| 컨테이너 status `ERROR` | 이미지 규격 위반 | 4:5 비율·8MB 이하·JPEG/PNG 확인 |

컨테이너는 생성 후 `status_code`가 `FINISHED`일 때만 publish된다. run.js가 최대 60초 폴링 — 그 이상 걸리면 이미지 크기 축소.

## 카카오 알림

| 증상 | 해결 |
|------|------|
| `invalid_grant` | refresh token 만료(2개월 무사용 시). setup-guide 3절 절차로 재발급 |
| `insufficient scopes` | talk_message 동의항목 미활성 |
| 알림만 실패 | 발행은 성공했을 수 있음 — `published.json` 확인. 알림 실패는 발행을 롤백하지 않음 |

## 멱등성/이력

- "이미 발행됨" 스킵을 무시하려면 `--force`
- 발행은 됐는데 기록 실패(rare): `data/<client>/published.json`에 수동으로 항목 추가하지 말고 `scripts/insights.js --client <client> --reconcile` 실행 — IG 계정의 최신 미디어와 대조해 이력 복구

## GitHub Actions

- cron 미실행: 리포가 60일간 커밋 없으면 스케줄 워크플로 자동 비활성화 — Actions 탭에서 re-enable
- secrets 누락: `IG_USER_ID__<ENVKEY>` 키 이름이 config.json의 `igEnvKey`와 일치하는지 확인
