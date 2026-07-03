import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireEnv, fetchJson, log } from './common.js';

function parseCloudinaryUrl() {
  const url = requireEnv('CLOUDINARY_URL');
  const m = url.match(/^cloudinary:\/\/(\d+):([^@]+)@(.+)$/);
  if (!m) throw new Error('CLOUDINARY_URL 형식 오류 (cloudinary://api_key:api_secret@cloud_name)');
  return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
}

// 서명 업로드 (SDK 없이 REST API 직접 호출)
async function uploadOne(pngPath, publicId) {
  const { apiKey, apiSecret, cloudName } = parseCloudinaryUrl();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { overwrite: 'true', public_id: publicId, timestamp: String(timestamp) };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(pngPath)], { type: 'image/png' }), path.basename(pngPath));
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', apiKey);
  form.append('signature', signature);

  const json = await fetchJson(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: form },
    'cloudinary'
  );
  return json.secure_url;
}

// PNG 목록 업로드 → 공개 URL 목록. 파일 해시 기반 public_id로 재업로드 시 중복 방지.
export async function uploadPost(client, postId, pngPaths) {
  const urls = [];
  for (const png of pngPaths) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex').slice(0, 10);
    const slide = path.basename(png, '.png');
    const publicId = `${client}/${postId}/${slide}-${hash}`;
    const url = await uploadOne(png, publicId);
    log('upload', `${slide} → ${url}`);
    urls.push(url);
  }
  return urls;
}
