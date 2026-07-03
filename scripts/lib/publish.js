import { requireEnv, fetchJson, sleep, log } from './common.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

function igUserId(config) {
  return requireEnv(`IG_USER_ID__${config.igEnvKey}`);
}

async function waitForContainer(containerId, token, label) {
  for (let i = 0; i < 20; i++) {
    const st = await fetchJson(`${GRAPH}/${containerId}?fields=status_code&access_token=${token}`, {}, 'graph:status');
    if (st.status_code === 'FINISHED') return;
    if (st.status_code === 'ERROR') throw new Error(`${label} 컨테이너 처리 실패 (이미지 규격 확인: 4:5, 8MB 이하)`);
    await sleep(3000);
  }
  throw new Error(`${label} 컨테이너 처리 시간 초과 (60초)`);
}

// 캐러셀 발행: 아이템 컨테이너 N개 → 캐러셀 컨테이너 → publish
export async function publishCarousel(config, imageUrls, caption) {
  const token = requireEnv('META_ACCESS_TOKEN');
  const user = igUserId(config);

  const children = [];
  for (const [i, url] of imageUrls.entries()) {
    const item = await fetchJson(
      `${GRAPH}/${user}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: token }),
      },
      'graph:item'
    );
    log('publish', `아이템 컨테이너 ${i + 1}/${imageUrls.length}: ${item.id}`);
    children.push(item.id);
  }
  for (const id of children) await waitForContainer(id, token, '아이템');

  const carousel = await fetchJson(
    `${GRAPH}/${user}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'CAROUSEL', children, caption, access_token: token }),
    },
    'graph:carousel'
  );
  await waitForContainer(carousel.id, token, '캐러셀');

  const published = await fetchJson(
    `${GRAPH}/${user}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: carousel.id, access_token: token }),
    },
    'graph:publish'
  );

  const permalink = await fetchJson(
    `${GRAPH}/${published.id}?fields=permalink&access_token=${token}`,
    {},
    'graph:permalink'
  ).catch(() => ({}));

  log('publish', `발행 완료: media_id=${published.id}`);
  return { mediaId: published.id, permalink: permalink.permalink || null };
}

// 발행된 미디어 인사이트 조회
export async function fetchInsights(config, mediaId) {
  const token = requireEnv('META_ACCESS_TOKEN');
  const base = await fetchJson(
    `${GRAPH}/${mediaId}?fields=like_count,comments_count,permalink,timestamp&access_token=${token}`,
    {},
    'graph:media'
  );
  let reach = null, saved = null;
  try {
    const ins = await fetchJson(
      `${GRAPH}/${mediaId}/insights?metric=reach,saved&access_token=${token}`,
      {},
      'graph:insights'
    );
    for (const m of ins.data || []) {
      if (m.name === 'reach') reach = m.values?.[0]?.value ?? null;
      if (m.name === 'saved') saved = m.values?.[0]?.value ?? null;
    }
  } catch {
    // instagram_manage_insights 권한 없으면 기본 지표만
  }
  return {
    likes: base.like_count ?? null,
    comments: base.comments_count ?? null,
    reach,
    saved,
    permalink: base.permalink ?? null,
    publishedAt: base.timestamp ?? null,
  };
}

// 계정 최근 미디어 목록 (이력 복구용)
export async function listRecentMedia(config, limit = 25) {
  const token = requireEnv('META_ACCESS_TOKEN');
  const user = igUserId(config);
  const json = await fetchJson(
    `${GRAPH}/${user}/media?fields=id,caption,permalink,timestamp&limit=${limit}&access_token=${token}`,
    {},
    'graph:media-list'
  );
  return json.data || [];
}
