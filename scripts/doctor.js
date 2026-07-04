#!/usr/bin/env node
// 설정 진단 (읽기 전용) — 토큰·연결·콘텐츠 상태를 쉬운 한국어로 점검한다.
// 사용법: node scripts/doctor.js [--client <slug>]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv, loadConfig, loadSchedule, loadPublished, listClients, todayInTz, fetchJson } from './lib/common.js';
import { accessToken } from './lib/notify.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const results = [];
function ok(name, detail) { results.push({ ok: true, name, detail }); }
function no(name, detail) { results.push({ ok: false, name, detail }); }

async function checkMeta(config) {
  const token = process.env.META_ACCESS_TOKEN;
  const igId = process.env[`IG_USER_ID__${config.igEnvKey}`];
  if (!token) return no('인스타그램 토큰', 'META_ACCESS_TOKEN이 없어요. setup-guide.md 1번 절차로 발급 후 등록하세요.');
  if (!igId) return no('인스타그램 계정 ID', `IG_USER_ID__${config.igEnvKey}가 없어요. 토큰 발급 후 doctor를 다시 실행하면 후보 ID를 찾아드립니다.`);
  try {
    const me = await fetchJson(`${GRAPH}/${igId}?fields=username,followers_count&access_token=${token}`, {}, 'graph');
    ok('인스타그램 연결', `@${me.username} (팔로워 ${me.followers_count ?? '?'}) — 토큰·계정 ID 모두 정상`);
  } catch (e) {
    no('인스타그램 연결', `토큰 또는 계정 ID가 유효하지 않아요: ${e.message.slice(0, 120)}`);
  }
}

// 토큰만 있고 IG ID를 모를 때 후보를 찾아준다
async function findIgId() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return;
  try {
    const pages = await fetchJson(`${GRAPH}/me/accounts?fields=name,instagram_business_account&access_token=${token}`, {}, 'graph');
    const found = (pages.data || []).filter((p) => p.instagram_business_account);
    if (found.length) {
      console.error('\n💡 이 토큰으로 찾은 인스타그램 비즈니스 계정 ID 후보:');
      for (const p of found) console.error(`   - ${p.name}: ${p.instagram_business_account.id}  ← 이 값을 IG_USER_ID__* 시크릿에`);
    }
  } catch { /* 조용히 스킵 */ }
}

async function checkCloudinary() {
  const url = process.env.CLOUDINARY_URL;
  if (!url) return no('이미지 호스팅(Cloudinary)', 'CLOUDINARY_URL이 없어요. cloudinary.com 무료 가입 → Dashboard에서 복사.');
  const m = url.match(/^cloudinary:\/\/(\d+):([^@]+)@(.+)$/);
  if (!m) return no('이미지 호스팅(Cloudinary)', 'CLOUDINARY_URL 형식이 틀렸어요. cloudinary://키:시크릿@클라우드명 형태여야 합니다.');
  try {
    await fetchJson(`https://api.cloudinary.com/v1_1/${m[3]}/usage`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${m[1]}:${m[2]}`).toString('base64') },
    }, 'cloudinary');
    ok('이미지 호스팅(Cloudinary)', `${m[3]} 계정 연결 정상`);
  } catch (e) {
    no('이미지 호스팅(Cloudinary)', `인증 실패: ${e.message.slice(0, 100)}`);
  }
}

async function checkKakao() {
  if (!process.env.KAKAO_REST_KEY || !process.env.KAKAO_REFRESH_TOKEN) {
    return no('카카오톡 알림', 'KAKAO_REST_KEY / KAKAO_REFRESH_TOKEN이 없어요. (선택 항목 — 없어도 발행은 됩니다) 발급: node scripts/kakao-auth.js');
  }
  try {
    const token = await accessToken();
    const info = await fetchJson('https://kapi.kakao.com/v1/user/access_token_info', {
      headers: { Authorization: `Bearer ${token}` },
    }, 'kakao');
    ok('카카오톡 알림', `연결 정상 (앱 ${info.app_id})`);
  } catch (e) {
    no('카카오톡 알림', `토큰이 유효하지 않아요: ${e.message.slice(0, 100)} — node scripts/kakao-auth.js 로 재발급`);
  }
}

function checkContent(client, config) {
  const schedule = loadSchedule(client);
  const published = loadPublished(client);
  const done = new Set(published.posts.map((p) => p.id));
  const today = todayInTz(config.timezone);
  let ready = 0, missing = [];
  for (const post of schedule.posts) {
    const dir = path.join(ROOT, 'clients', client, 'content', post.id);
    const hasSlides = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^slide-\d+\.html$/.test(f));
    const hasCaption = fs.existsSync(path.join(dir, 'caption.txt'));
    if (hasSlides && hasCaption) ready++;
    else missing.push(post.id);
  }
  if (missing.length === 0) ok('콘텐츠 준비', `스케줄 ${schedule.posts.length}건 전부 슬라이드+캡션 완성`);
  else no('콘텐츠 준비', `${missing.length}건 미완성: ${missing.join(', ')}`);
  const overdue = schedule.posts.filter((p) => p.date < today && !done.has(p.id));
  if (overdue.length) no('발행 지연', `${overdue.length}건이 예정일을 지났는데 미발행: ${overdue.map((p) => p.id).join(', ')}`);
  else ok('발행 일정', `지연 없음 (오늘 ${today} 기준, 발행 완료 ${published.posts.length}건)`);
}

async function main() {
  loadEnv();
  const arg = process.argv.indexOf('--client');
  const clients = arg > -1 ? [process.argv[arg + 1]] : listClients();
  console.error('🩺 sns-autopost 설정 진단\n');
  for (const client of clients) {
    const config = loadConfig(client);
    console.error(`── ${config.name} (${client}) ──`);
    await checkMeta(config);
    if (!process.env[`IG_USER_ID__${config.igEnvKey}`]) await findIgId();
    checkContent(client, config);
  }
  await checkCloudinary();
  await checkKakao();

  console.error('');
  for (const r of results) console.error(`${r.ok ? '✅' : '⬜'} ${r.name} — ${r.detail}`);
  const todo = results.filter((r) => !r.ok);
  console.error(todo.length
    ? `\n📌 남은 일 ${todo.length}개. 위의 ⬜ 항목을 순서대로 해결하면 됩니다.`
    : '\n🎉 모든 점검 통과! 다음 스케줄 시각에 자동 발행됩니다.');
  console.log(JSON.stringify({ ok: todo.length === 0, checks: results }));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
