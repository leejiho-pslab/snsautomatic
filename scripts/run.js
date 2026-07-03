#!/usr/bin/env node
// 통합 발행 파이프라인: 렌더 → 업로드 → (테스트 종료 | 발행 → 기록 → 알림) → 대시보드 갱신
// 사용법: node scripts/run.js --client <slug> (--test|--live) [--date YYYY-MM-DD] [--post-id ID] [--force]
//        node scripts/run.js --all-clients --live
import fs from 'node:fs';
import path from 'node:path';
import {
  loadEnv, loadConfig, loadSchedule, loadPublished, savePublished,
  listClients, todayInTz, clientDir, dataDir, log, sleep,
} from './lib/common.js';
import { renderPost } from './lib/render.js';
import { uploadPost } from './lib/upload.js';
import { publishCarousel } from './lib/publish.js';
import { notifyKakao } from './lib/notify.js';
import { buildDashboard } from './build-dashboard.js';

function parseArgs(argv) {
  const args = { force: false, allClients: false, mode: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client') args.client = argv[++i];
    else if (a === '--all-clients') args.allClients = true;
    else if (a === '--test') args.mode = 'test';
    else if (a === '--live') args.mode = 'live';
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--post-id') args.postId = argv[++i];
    else if (a === '--force') args.force = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!args.mode) throw new Error('--test 또는 --live 필수');
  if (!args.client && !args.allClients) throw new Error('--client <slug> 또는 --all-clients 필수');
  return args;
}

function buildCaption(client, post, config) {
  const capPath = path.join(clientDir(client), 'content', post.id, 'caption.txt');
  if (!fs.existsSync(capPath)) throw new Error(`caption.txt 없음: ${capPath}`);
  let caption = fs.readFileSync(capPath, 'utf8').trim();
  const inCaption = new Set((caption.match(/#[^\s#]+/g) || []).map((t) => t.toLowerCase()));
  const extra = (config.defaultHashtags || []).filter((t) => !inCaption.has(t.toLowerCase()));
  if (extra.length) caption += '\n\n' + extra.join(' ');
  const tagCount = (caption.match(/#[^\s#]+/g) || []).length;
  if (caption.length > 2200) throw new Error(`캡션 ${caption.length}자 — 2,200자 초과`);
  if (tagCount > 30) throw new Error(`해시태그 ${tagCount}개 — 30개 초과`);
  return caption;
}

function duePosts(client, args, config) {
  const schedule = loadSchedule(client);
  const published = loadPublished(client);
  const done = new Set(published.posts.map((p) => p.id));
  const target = args.date || todayInTz(config.timezone);

  return schedule.posts
    .filter((p) => (args.postId ? p.id === args.postId : p.date <= target))
    .filter((p) => args.force || !done.has(p.id))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function processClient(client, args, result) {
  const config = loadConfig(client);
  const posts = duePosts(client, args, config);
  if (posts.length === 0) {
    log('run', `${client}: 발행 대상 없음 (스케줄/이력 확인)`);
    return;
  }

  for (const [i, post] of posts.entries()) {
    log('run', `── ${client}/${post.id} (${args.mode}) ──`);
    try {
      const caption = buildCaption(client, post, config);
      const pngs = await renderPost(client, post.id);

      // 테스트 모드에서 Cloudinary 미설정이면 로컬 렌더만으로 미리보기 생성
      let urls;
      let uploadSkipped = false;
      if (args.mode === 'test' && !process.env.CLOUDINARY_URL) {
        urls = pngs;
        uploadSkipped = true;
        log('upload', 'CLOUDINARY_URL 미설정 — 업로드 생략, 로컬 PNG로 미리보기 생성');
      } else {
        urls = await uploadPost(client, post.id, pngs);
      }

      if (args.mode === 'test') {
        const preview = { id: post.id, date: post.date, slides: urls, uploadSkipped, caption };
        const previewPath = path.join(dataDir(client), 'previews', `${post.id}.json`);
        fs.mkdirSync(path.dirname(previewPath), { recursive: true });
        fs.writeFileSync(previewPath, JSON.stringify(preview, null, 2) + '\n');
        result.tested.push({ client, id: post.id, slides: urls.length, preview: path.relative(process.cwd(), previewPath) });
        continue;
      }

      const { mediaId, permalink } = await publishCarousel(config, urls, caption);
      const published = loadPublished(client);
      published.posts.push({
        id: post.id, date: post.date, title: post.title || post.id,
        mediaId, permalink, slides: urls.length,
        publishedAt: new Date().toISOString(),
      });
      savePublished(client, published);
      result.published.push({ client, id: post.id, mediaId, permalink });

      if (config.notify?.kakao !== false) {
        await notifyKakao(`✅ [${config.name}] 인스타그램 발행 완료\n${post.title || post.id}\n${permalink || ''}`, permalink);
      }
      if (i < posts.length - 1) await sleep(30000); // 연속 발행 간 rate limit 여유
    } catch (e) {
      result.failed.push({ client, id: post.id, error: e.message });
      log('run', `실패: ${client}/${post.id} — ${e.message}`);
      const config2 = loadConfig(client);
      if (args.mode === 'live' && config2.notify?.kakao !== false) {
        await notifyKakao(`❌ [${config2.name}] 발행 실패: ${post.title || post.id}\n${e.message.slice(0, 150)}`);
      }
    }
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);
  const clients = args.allClients ? listClients() : [args.client];
  const result = { ok: true, mode: args.mode, published: [], tested: [], failed: [], skipped: [] };

  for (const client of clients) {
    await processClient(client, args, result);
  }

  try { buildDashboard(); } catch (e) { log('dashboard', `갱신 실패: ${e.message}`); }

  result.ok = result.failed.length === 0;
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
