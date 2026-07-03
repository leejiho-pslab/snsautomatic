import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { clientDir, dataDir, log } from './common.js';

const WIDTH = 1080;
const HEIGHT = 1350;

function executablePath() {
  // 클라우드/CI 환경의 사전 설치 크로미움 우선, 없으면 playwright 기본 탐색
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? fs.readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
          .filter((d) => d.startsWith('chromium-'))
          .map((d) => path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, d, 'chrome-linux', 'chrome'))
      : []),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
      if (st.isDirectory()) {
        const inner = path.join(c, 'chrome-linux', 'chrome');
        if (fs.existsSync(inner)) return inner;
      }
    } catch { /* try next */ }
  }
  return undefined; // playwright-core가 스스로 못 찾으면 명확한 에러를 냄
}

// content/<post-id>/slide-*.html → data/<client>/renders/<post-id>/slide-*.png
// HTML 해시가 같으면 재렌더 스킵.
export async function renderPost(client, postId) {
  const contentDir = path.join(clientDir(client), 'content', postId);
  if (!fs.existsSync(contentDir)) throw new Error(`콘텐츠 폴더 없음: ${contentDir}`);

  const slides = fs.readdirSync(contentDir).filter((f) => /^slide-\d+\.html$/.test(f)).sort();
  if (slides.length === 0) throw new Error(`슬라이드 HTML 없음: ${contentDir}/slide-01.html …`);
  if (slides.length > 10) throw new Error(`슬라이드 ${slides.length}장 — 인스타그램 캐러셀 최대 10장`);

  const outDir = path.join(dataDir(client), 'renders', postId);
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

  const jobs = [];
  for (const slide of slides) {
    const html = fs.readFileSync(path.join(contentDir, slide), 'utf8');
    const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
    const png = path.join(outDir, slide.replace('.html', '.png'));
    if (manifest[slide] === hash && fs.existsSync(png)) {
      log('render', `${slide} 변경 없음 — 스킵`);
    } else {
      jobs.push({ slide, hash, png, htmlPath: path.join(contentDir, slide) });
    }
  }

  if (jobs.length > 0) {
    const browser = await chromium.launch({ executablePath: executablePath() });
    try {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      for (const job of jobs) {
        await page.goto('file://' + job.htmlPath, { waitUntil: 'networkidle', timeout: 30000 });
        await page.screenshot({ path: job.png, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
        manifest[job.slide] = job.hash;
        log('render', `${job.slide} → ${path.relative(process.cwd(), job.png)}`);
      }
    } finally {
      await browser.close();
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  return slides.map((s) => path.join(outDir, s.replace('.html', '.png')));
}
