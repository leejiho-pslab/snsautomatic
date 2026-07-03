import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// .env 로더 (dotenv 의존성 없이). 이미 설정된 환경변수가 우선.
export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function clientDir(client) {
  const dir = path.join(ROOT, 'clients', client);
  if (!fs.existsSync(path.join(dir, 'config.json'))) {
    throw new Error(`클라이언트를 찾을 수 없음: ${client} (clients/${client}/config.json 없음)`);
  }
  return dir;
}

export function loadConfig(client) {
  return JSON.parse(fs.readFileSync(path.join(clientDir(client), 'config.json'), 'utf8'));
}

export function loadSchedule(client) {
  const p = path.join(clientDir(client), 'schedule.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { posts: [] };
}

export function dataDir(client) {
  const dir = path.join(ROOT, 'data', client);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadPublished(client) {
  const p = path.join(dataDir(client), 'published.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { posts: [] };
}

export function savePublished(client, published) {
  fs.writeFileSync(path.join(dataDir(client), 'published.json'), JSON.stringify(published, null, 2) + '\n');
}

export function listClients() {
  const base = path.join(ROOT, 'clients');
  return fs.readdirSync(base).filter(
    (d) => !d.startsWith('_') && fs.existsSync(path.join(base, d, 'config.json'))
  );
}

// 클라이언트 시간대 기준 오늘 날짜 (YYYY-MM-DD)
export function todayInTz(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Seoul' }).format(new Date());
}

export function log(step, msg) {
  process.stderr.write(`[${step}] ${msg}\n`);
}

export function requireEnv(name) {
  if (!process.env[name]) throw new Error(`환경변수 누락: ${name} (.env 또는 GitHub secrets 확인)`);
  return process.env[name];
}

export async function fetchJson(url, options = {}, label = 'api') {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
