#!/usr/bin/env node
// 콘택트시트 — 한 포스트의 슬라이드 전체를 한 장에 모아 빠르게 검수하는 도구.
// 레퍼런스 디자인과 나란히 비교할 때, 또는 디자인 수정 후 전체 흐름을 한눈에 볼 때 사용.
// 사용법: node scripts/contact-sheet.js --client <slug> --post <post-id>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, dataDir, log } from './lib/common.js';
import { renderPost } from './lib/render.js';

function executablePath() {
  const c = '/opt/pw-browsers/chromium';
  return fs.existsSync(c) ? c : undefined;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--client') args.client = argv[++i];
    else if (argv[i] === '--post') args.post = argv[++i];
  }
  if (!args.client || !args.post) throw new Error('--client <slug> --post <post-id> 필수');
  return args;
}

async function main() {
  const { client, post } = parseArgs(process.argv);
  const pngs = await renderPost(client, post);
  const THUMB_W = 360, THUMB_H = 450, GAP = 24, PAD = 32;
  const cols = pngs.length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:${PAD}px;background:#20242c;display:flex;gap:${GAP}px;font-family:sans-serif}
    figure{margin:0;display:flex;flex-direction:column;gap:8px}
    img{width:${THUMB_W}px;height:${THUMB_H}px;object-fit:cover;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
    figcaption{color:#aab;font-size:13px;text-align:center}
  </style></head><body>
  ${pngs.map((p, i) => `<figure><img src="file://${p}"><figcaption>${i + 1}. ${path.basename(p)}</figcaption></figure>`).join('')}
  </body></html>`;

  const tmp = path.join(dataDir(client), '_contact-sheet-tmp.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch({ executablePath: executablePath() });
  try {
    const page = await browser.newPage({
      viewport: { width: cols * (THUMB_W + GAP) + PAD * 2, height: THUMB_H + PAD * 2 + 30 },
    });
    await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
    const outPath = path.join(dataDir(client), 'previews', `${post}-contact-sheet.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: true });
    log('contact-sheet', `생성됨: ${outPath}`);
    console.log(JSON.stringify({ ok: true, outPath, slides: pngs.length }));
  } finally {
    await browser.close();
    fs.unlinkSync(tmp);
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
