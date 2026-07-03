# 신규 클라이언트 온보딩 가이드

새 클라이언트(예: 동성인쇄소)를 자동화 시스템에 추가하는 전체 절차. 소요 시간 약 30~60분 (토큰 발급 대기 포함).

## 0. 사전 조건

- 클라이언트의 Instagram 계정이 **프로페셔널(비즈니스/크리에이터) 계정**이어야 함
- 해당 IG 계정이 **Facebook 페이지에 연결**되어 있어야 함 (IG 설정 > 공유 계정 센터)
- 클라이언트 또는 운영사가 해당 Facebook 페이지의 관리자여야 함

## 1. Meta (Instagram Graph API) 토큰 발급

1. https://developers.facebook.com > 앱 생성 (유형: Business)
2. 앱에 **Instagram Graph API** 제품 추가
3. 비즈니스 설정 > 시스템 사용자 생성 (권한: admin) — 개인 토큰보다 만료가 없어 무인 운영에 적합
4. 시스템 사용자에 자산(페이지) 할당 후 토큰 생성. 필요 권한:
   - `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `business_management`
   - 인사이트 수집까지 하려면 `instagram_manage_insights` 추가
5. IG User ID 조회:
   ```
   GET https://graph.facebook.com/v21.0/me/accounts?access_token=<TOKEN>
   GET https://graph.facebook.com/v21.0/<PAGE_ID>?fields=instagram_business_account&access_token=<TOKEN>
   ```
   `instagram_business_account.id`가 IG User ID.

## 2. Cloudinary (이미지 호스팅)

Graph API는 공개 이미지 URL을 요구하므로 렌더된 PNG를 호스팅해야 한다.
1. https://cloudinary.com 무료 플랜 가입 (25 크레딧/월 — 월 수십 회 발행에 충분)
2. Dashboard에서 `CLOUDINARY_URL` (cloudinary://api_key:api_secret@cloud_name) 복사
3. 여러 클라이언트가 하나의 Cloudinary 계정을 공유해도 된다 (폴더로 분리됨: `<client>/<post-id>/`)

## 3. 카카오톡 알림 (나에게 보내기)

1. https://developers.kakao.com > 앱 생성 > REST API 키 확보
2. 카카오 로그인 활성화, Redirect URI에 `https://localhost` 추가
3. 동의항목에서 **카카오톡 메시지 전송(talk_message)** 활성화
4. 브라우저에서 인가 코드 발급:
   ```
   https://kauth.kakao.com/oauth/authorize?client_id=<REST_KEY>&redirect_uri=https://localhost&response_type=code&scope=talk_message
   ```
5. 토큰 교환 후 **refresh_token** 저장 (약 2개월 유효, 스크립트가 자동 갱신):
   ```bash
   curl -X POST https://kauth.kakao.com/oauth/token \
     -d grant_type=authorization_code -d client_id=<REST_KEY> \
     -d redirect_uri=https://localhost -d code=<CODE>
   ```

## 4. GitHub Secrets 등록

리포 Settings > Secrets and variables > Actions:

| Secret | 값 | 공유 범위 |
|--------|----|-----------|
| `META_ACCESS_TOKEN` | 시스템 사용자 토큰 | 전 클라이언트 공용 가능(같은 비즈니스 관리자면) |
| `IG_USER_ID__DONGSUNG_PRINT` | IG User ID | 클라이언트별. 키 규칙: `IG_USER_ID__<config.json의 envKey>` |
| `CLOUDINARY_URL` | cloudinary://… | 공용 |
| `KAKAO_REST_KEY` | REST API 키 | 공용 |
| `KAKAO_REFRESH_TOKEN` | refresh token | 공용(운영자 1인 수신 기준) |

로컬 테스트는 `.env` 파일 사용 (`.env.example` 참고, 커밋 금지).

## 5. 클라이언트 폴더 생성

```bash
cp -r clients/_template clients/<client-slug>
```
1. `config.json` 수정: `name`, `igEnvKey`, `timezone`, `defaultHashtags`, `notify`
2. `brand.md` 작성: 브랜드 색상, 톤앤매너, 타깃, 콘텐츠 필러, 금칙어
3. `templates/` 커스터마이즈 (브랜드 색·로고 반영)
4. `schedule.json` 초기화: `{"posts": []}`

## 6. 검증

```bash
node scripts/run.js --client <client-slug> --test
```
렌더·업로드·컨테이너 생성(발행 제외)까지 통과하면 온보딩 완료. 이후 `.github/workflows/autopost.yml`의 클라이언트 목록에 slug 추가.
