#!/usr/bin/env node
// 발행된 게시물 성과 수집 → data/<client>/insights.json → 대시보드 갱신
// 사용법: node scripts/insights.js --client <slug> [--reconcile]
//        node scripts/insights.js --all-clients
import fs from 'node:fs';
import path from 'node:path';
import {
  loadEnv, loadConfig, loadPublished, savePublished, listClients, dataDir, log,
} from './lib/common.js';
import { fetchInsights, listRecentMedia } from './lib/publish.js';
import { buildDashboard } from './build-dashboard.js';

function parseArgs(argv) {
  const args = { allClients: false, reconcile: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client') args.client = argv[++i];
    else if (a === '--all-clients') args.allClients = true;
    else if (a === '--reconcile') args.reconcile = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!args.client && !args.allClients) throw new Error('--client <slug> 또는 --all-clients 필수');
  return args;
}

// IG 계정 실데이터와 이력 대조 — 발행됐는데 기록 누락된 포스트 복구
async function reconcile(client, config) {
  const published = loadPublished(client);
  const known = new Set(published.posts.map((p) => p.mediaId));
  const recent = await listRecentMedia(config);
  let added = 0;
  for (const m of recent) {
    if (!known.has(m.id)) {
      published.posts.push({
        id: `reconciled-${m.id}`,
        date: (m.timestamp || '').slice(0, 10),
        title: (m.caption || '').split('\n')[0].slice(0, 60) || m.id,
        mediaId: m.id, permalink: m.permalink,
        publishedAt: m.timestamp, reconciled: true,
      });
      added++;
    }
  }
  if (added) savePublished(client, published);
  log('reconcile', `${client}: ${added}건 이력 복구`);
}

async function collect(client) {
  const config = loadConfig(client);
  const published = loadPublished(client);
  const insights = [];
  for (const post of published.posts) {
    try {
      const data = await fetchInsights(config, post.mediaId);
      insights.push({ id: post.id, title: post.title, date: post.date, mediaId: post.mediaId, ...data });
      log('insights', `${post.id}: 좋아요 ${data.likes} 댓글 ${data.comments} 도달 ${data.reach ?? '-'}`);
    } catch (e) {
      log('insights', `${post.id} 조회 실패: ${e.message}`);
    }
  }
  fs.writeFileSync(
    path.join(dataDir(client), 'insights.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), posts: insights }, null, 2) + '\n'
  );
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);
  const clients = args.allClients ? listClients() : [args.client];
  for (const client of clients) {
    if (args.reconcile) await reconcile(client, loadConfig(client));
    await collect(client);
  }
  buildDashboard();
  console.log(JSON.stringify({ ok: true, clients }));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
