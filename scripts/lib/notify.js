import fs from 'node:fs';
import path from 'node:path';
import { ROOT, fetchJson, log } from './common.js';

const TOKEN_CACHE = path.join(ROOT, 'data', '.kakao-token.json');

// refresh_token으로 access_token 발급 (회전된 refresh_token은 캐시에 보관)
export async function accessToken() {
  const restKey = process.env.KAKAO_REST_KEY;
  let refresh = process.env.KAKAO_REFRESH_TOKEN;
  if (!restKey || !refresh) return null; // 알림 미설정 — 조용히 스킵

  if (fs.existsSync(TOKEN_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      if (cached.refresh_token) refresh = cached.refresh_token;
      if (cached.access_token && cached.expires_at > Date.now() + 60000) return cached.access_token;
    } catch { /* 캐시 무시 */ }
  }

  const json = await fetchJson('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: restKey, refresh_token: refresh }),
  }, 'kakao:token');

  fs.mkdirSync(path.dirname(TOKEN_CACHE), { recursive: true });
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
    access_token: json.access_token,
    refresh_token: json.refresh_token || refresh,
    expires_at: Date.now() + (json.expires_in || 21600) * 1000,
  }, null, 2));
  return json.access_token;
}

// 카카오톡 "나에게 보내기". 실패해도 발행 결과에는 영향 없음.
export async function notifyKakao(text, linkUrl) {
  try {
    const token = await accessToken();
    if (!token) { log('notify', 'KAKAO 미설정 — 알림 스킵'); return false; }
    const template = {
      object_type: 'text',
      text: text.slice(0, 200),
      link: { web_url: linkUrl || 'https://instagram.com', mobile_web_url: linkUrl || 'https://instagram.com' },
    };
    await fetchJson('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }),
    }, 'kakao:send');
    log('notify', '카카오톡 알림 전송 완료');
    return true;
  } catch (e) {
    log('notify', `카카오톡 알림 실패(발행과 무관): ${e.message}`);
    return false;
  }
}
