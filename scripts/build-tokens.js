#!/usr/bin/env node
// design-tokens.json(단일 소스) → design-tokens.css 생성.
// 템플릿·슬라이드는 이 CSS 파일을 <link>로 참조한다 — 색 하나 바꿔도 여기 한 곳만 고치면 된다.
// 사용법: node scripts/build-tokens.js [--client <slug>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, clientDir, listClients, log } from './lib/common.js';

function toCss(tokens) {
  const lines = [':root {'];
  for (const [k, v] of Object.entries(tokens.color || {})) {
    lines.push(`  --brand-${k}: ${v};`);
  }
  const t = tokens.type || {};
  if (t.fontFamily) lines.push(`  --font-family-base: ${t.fontFamily};`);
  for (const [name, s] of Object.entries(t.scale || {})) {
    lines.push(`  --type-${name}-size: ${s.size}px;`);
    lines.push(`  --type-${name}-weight: ${s.weight};`);
    lines.push(`  --type-${name}-leading: ${s.lineHeight};`);
    lines.push(`  --type-${name}-tracking: ${s.tracking}em;`);
  }
  for (const [k, v] of Object.entries(tokens.space || {})) lines.push(`  --space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.radius || {})) lines.push(`  --radius-${k}: ${v}px;`);
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function buildTokens(client) {
  const dir = clientDir(client);
  const jsonPath = path.join(dir, 'design-tokens.json');
  if (!fs.existsSync(jsonPath)) return null;
  const tokens = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const cssPath = path.join(dir, 'design-tokens.css');
  fs.writeFileSync(cssPath, toCss(tokens));
  log('tokens', `${client}: design-tokens.css 갱신 (${Object.keys(tokens.color || {}).length}색)`);
  return cssPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--client');
  const clients = i > -1 ? [process.argv[i + 1]] : listClients();
  const built = clients.map(buildTokens).filter(Boolean);
  console.log(JSON.stringify({ ok: true, built }));
}
