# 캐러셀 디자인 가이드

콘텐츠(슬라이드 HTML) 제작 시에만 읽는 문서.

## 규격

- 캔버스: **1080×1350px (4:5)** 고정. `<body>`에 `width:1080px;height:1350px;margin:0;overflow:hidden`
- 슬라이드 수: 3~10장. 파일명 `slide-01.html`부터 연번
- 렌더러(Playwright)는 `deviceScaleFactor: 1`로 1080×1350 PNG를 그대로 캡처한다
- 폰트: Google Fonts CDN 또는 시스템 폰트만. 한글은 Pretendard(CDN) 또는 Noto Sans KR 권장
- 외부 이미지는 절대 URL만 (렌더 시 네트워크 접근 가능). 로컬 이미지는 같은 폴더에 두고 상대경로

## 구성 공식 (인쇄소·로컬 비즈니스 기준)

1. **slide-01 (후킹)**: 큰 타이포 1문장 + 브랜드 컬러 배경. 질문형/숫자형 후킹
2. **slide-02 ~ N-1 (본문)**: 슬라이드당 핵심 1개. 제목(40~56px) + 본문(28~34px) + 시각 요소
3. **slide-N (CTA)**: 저장·공유 유도 + 문의 채널(전화/카카오채널) + 로고

## 캡션 (caption.txt)

- 1행: 후킹 문장 (더보기 접힘 전 노출 구간)
- 본문: 3~6문장, 줄바꿈으로 가독성 확보
- 해시태그: 포스트 고유 태그만 작성 — config.json의 `defaultHashtags`가 발행 시 자동 병합됨
- 총 2,200자·해시태그 30개 제한 (스크립트가 초과 시 에러)

## 템플릿 활용 — 디자인 토큰은 단일 소스 (중요)

브랜드 색·타이포 스케일은 `clients/<client>/design-tokens.json`에만 정의한다. 템플릿·슬라이드 HTML은
**절대 `:root{...}` 로 색을 직접 선언하지 말고**, 생성된 CSS를 `<link>`로만 참조한다:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="../design-tokens.css">   <!-- templates/ 기준. content/<post>/ 에서는 ../../design-tokens.css -->
```

사용 가능한 변수(자동 생성, `node scripts/build-tokens.js`):
`--brand-*`(색), `--font-family-base`, `--type-<display|h2|kicker|body|caption>-<size|weight|leading|tracking>`, `--space-*`, `--radius-*`.

**색을 하나라도 바꿔야 하면 `design-tokens.json`만 고치고 `node scripts/build-tokens.js` 실행 — 슬라이드 파일을 손으로 뒤지지 않는다.** (`run.js`가 발행 때마다 자동 재생성하므로 평소엔 신경 쓸 필요 없음.)

새 슬라이드는 템플릿 복사 → 텍스트만 교체가 원칙. 레이아웃 변형이 필요하면 기존 템플릿의 그리드·여백 체계(외곽 여백 80px, 제목/본문 간격 32px)를 유지할 것.

## 빠른 검수: 콘택트시트

```bash
node scripts/contact-sheet.js --client <client> --post <post-id>
```
슬라이드 전체를 한 장에 이어붙인 이미지를 생성한다(`data/<client>/previews/<post-id>-contact-sheet.png`). 레퍼런스 디자인과 나란히 비교하거나, 수정 후 전체 흐름을 한눈에 볼 때 매번 이걸로 확인할 것 — 슬라이드 1장씩 따로 보면 놓치는 리듬 문제(간격 불균일, 톤 튐)가 콘택트시트에서는 바로 보인다.

## 품질 체크리스트 (발행 전)

- [ ] `--test` 렌더 PNG에서 텍스트 잘림·오버플로 없음
- [ ] 슬라이드 좌우 스와이프 흐름이 자연스러움 (후킹→본문→CTA)
- [ ] 브랜드 색·로고 일관성
- [ ] 오탈자, 금칙어(brand.md) 확인
- [ ] 캡션 첫 줄이 잘려도 의미 전달됨
