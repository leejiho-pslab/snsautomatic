#!/usr/bin/env node
// 카카오톡 알림용 refresh_token 발급 도우미.
// 1) node scripts/kakao-auth.js            → 브라우저에서 열 인가 URL 출력
// 2) 브라우저 로그인 후 주소창의 code= 값 복사
// 3) node scripts/kakao-auth.js --code <값> → refresh_token 출력 (시크릿에 등록)
import { loadEnv, requireEnv, fetchJson } from './lib/common.js';

const REDIRECT = 'https://localhost';

async function main() {
  loadEnv();
  const restKey = requireEnv('KAKAO_REST_KEY');
  const i = process.argv.indexOf('--code');

  if (i === -1) {
    console.log('1️⃣ 아래 주소를 브라우저에 붙여넣고 카카오 로그인 → 동의하세요:\n');
    console.log(`https://kauth.kakao.com/oauth/authorize?client_id=${restKey}&redirect_uri=${REDIRECT}&response_type=code&scope=talk_message\n`);
    console.log('2️⃣ 이동된 주소가 https://localhost/?code=XXXX 형태입니다. code= 뒤의 값을 복사해서:');
    console.log('   node scripts/kakao-auth.js --code XXXX');
    return;
  }

  const code = process.argv[i + 1];
  const json = await fetchJson('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: restKey, redirect_uri: REDIRECT, code }),
  }, 'kakao:token');

  console.log('\n✅ 발급 완료! 아래 값을 GitHub 시크릿에 등록하세요:\n');
  console.log(`KAKAO_REFRESH_TOKEN = ${json.refresh_token}`);
  console.log('\n(refresh token은 사용 중이면 자동 연장됩니다. 2개월간 발행이 없을 때만 재발급 필요)');
}

main().catch((e) => {
  console.error(`실패: ${e.message}`);
  console.error('code는 1회용·10분 유효예요. 다시 1단계부터 진행해 주세요.');
  process.exit(1);
});
