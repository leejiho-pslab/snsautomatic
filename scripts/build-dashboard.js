#!/usr/bin/env node
// 대시보드 데이터 집계: clients/* + data/* → dashboard/data/status.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, loadConfig, loadSchedule, loadPublished, listClients, todayInTz,
} from './lib/common.js';

export function buildDashboard() {
  const out = { generatedAt: new Date().toISOString(), clients: [] };

  for (const slug of listClients()) {
    const config = loadConfig(slug);
    const schedule = loadSchedule(slug);
    const published = loadPublished(slug);
    const today = todayInTz(config.timezone);

    const insightsPath = path.join(ROOT, 'data', slug, 'insights.json');
    const insights = fs.existsSync(insightsPath)
      ? JSON.parse(fs.readFileSync(insightsPath, 'utf8'))
      : { updatedAt: null, posts: [] };

    const doneIds = new Set(published.posts.map((p) => p.id));
    const upcoming = schedule.posts
      .filter((p) => !doneIds.has(p.id))
      .sort((a, b) => a.date.localeCompare(b.date));
    const overdue = upcoming.filter((p) => p.date < today);

    out.clients.push({
      slug,
      name: config.name,
      instagram: config.instagram || null,
      brandColor: config.brandColor || '#333333',
      today,
      counts: {
        scheduled: schedule.posts.length,
        published: published.posts.length,
        upcoming: upcoming.length,
        overdue: overdue.length,
      },
      schedule: schedule.posts.map((p) => ({
        ...p,
        status: doneIds.has(p.id) ? 'published' : p.date < today ? 'overdue' : 'upcoming',
      })),
      published: published.posts.slice(-30),
      insights,
    });
  }

  const dataDir = path.join(ROOT, 'dashboard', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'status.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildDashboard();
  console.log(JSON.stringify({ ok: true, clients: out.clients.map((c) => c.slug) }));
}
