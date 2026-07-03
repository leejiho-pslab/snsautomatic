#!/usr/bin/env node
/**
 * 실시간 콘텐츠 관제 대시보드 (HTML 생성) — sns채널-자동화 스킬의 pslab dashboard.ts 포팅.
 *
 * 클라이언트별 격리 저장소(스케줄/발행이력/성과)를 모아 자가완결형 HTML 한 장으로 렌더.
 * 데이터는 인라인 JSON, 채널 탭 전환은 클라이언트 JS. 5분 자동 새로고침 + window.onerror 가드.
 *
 * 사용법: node scripts/build-dashboard.js [--inline]   (--inline: 카드 이미지를 data URI로 임베드)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, loadSchedule, loadPublished, listClients } from './lib/common.js';

const REPO = process.env.SNSAUTO_REPO ?? 'leejiho-pslab/snsautomatic';

const CHANNELS = [
  { key: 'instagram', label: '인스타그램', icon: '📸' },
  { key: 'threads', label: '스레드', icon: '🧵' },
  { key: 'naver-blog', label: '네이버 블로그', icon: '📝' },
  { key: 'blogger', label: '구글 블로그', icon: '🅱️' },
  { key: 'youtube', label: '유튜브', icon: '▶️' },
  { key: 'linkedin', label: '링크드인', icon: '💼' },
];

function seed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function loadInsights(client) {
  const p = path.join(ROOT, 'data', client, 'insights.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { updatedAt: null, posts: [] };
}

// 렌더된 슬라이드 PNG를 dashboard/cards/<post-id>/로 복사(있을 때만) → 상대경로 반환
function collectCards(client, postId) {
  const src = path.join(ROOT, 'data', client, 'renders', postId);
  const destRel = `cards/${postId}`;
  const dest = path.join(ROOT, 'dashboard', destRel);
  const out = [];
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src).filter((x) => /^slide-\d+\.png$/.test(x)).sort()) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f));
      out.push(`${destRel}/${f}`);
    }
  } else if (fs.existsSync(dest)) {
    for (const f of fs.readdirSync(dest).filter((x) => /^slide-\d+\.png$/.test(x)).sort()) {
      out.push(`${destRel}/${f}`);
    }
  }
  return out;
}

function readCaption(client, postId) {
  const p = path.join(ROOT, 'clients', client, 'content', postId, 'caption.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
}

const BLOG_TIERS = ['저품질', '일반', '준최적화 1', '준최적화 2', '준최적화 3', '최적화 1', '최적화 2', '최적화 3'];

function buildBlog(config, blogPublished) {
  const postCount = blogPublished.length;
  const avgEng = postCount > 0 ? blogPublished.reduce((a, p) => a + p.engagementRate, 0) / postCount : 0;
  const rawScore = Math.min(100, postCount * 9 + avgEng * 100 * 4);
  const measured = postCount > 0;
  const tierIdx = Math.min(BLOG_TIERS.length - 1, Math.floor((rawScore / 100) * BLOG_TIERS.length));
  const keywords = (config.keywords || []).map((kw) => {
    const r = seed(`kw:${kw}`);
    return { kw, searchIndex: 1000 + (r % 90000), competition: ['낮음', '보통', '높음'][r % 3] };
  });
  return { measured, grade: measured ? BLOG_TIERS[tierIdx] : '측정 전', score: Math.round(rawScore), posts: [], keywords };
}

function buildLearning(insightPosts) {
  const sample = insightPosts
    .filter((p) => p.likes != null)
    .map((p) => ({
      ...p,
      engagementRate: p.engagementRate ?? (p.reach ? ((p.likes || 0) + (p.comments || 0)) / p.reach : 0),
    }));
  if (sample.length < 1) return { sampleSize: 0, generatedAt: new Date().toISOString(), hints: [], variants: [], hours: [] };
  const hints = [];
  const best = [...sample].sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0))[0];
  if (best) hints.push(`"${best.title}" 반응이 가장 좋음 → 비슷한 주제·구성을 더 자주.`);
  const byPillar = {};
  for (const p of sample) {
    const k = p.pillar || '기타';
    (byPillar[k] = byPillar[k] || []).push(p);
  }
  const variants = Object.entries(byPillar).map(([key, arr]) => ({
    key,
    posts: arr.length,
    avgEngagement: arr.reduce((a, p) => a + (p.engagementRate || 0), 0) / arr.length,
    avgLikes: arr.reduce((a, p) => a + (p.likes || 0), 0) / arr.length,
  }));
  return { sampleSize: sample.length, generatedAt: new Date().toISOString(), hints, variants, hours: [], bestVariant: null };
}

function buildWeekly(config, publishedCards) {
  const now = Date.now();
  const week = publishedCards.filter((p) => p.publishedAt && now - Date.parse(p.publishedAt) < 7 * 864e5);
  if (!week.length) return null;
  const withM = week.filter((p) => p.metrics);
  const avg = withM.length ? withM.reduce((a, p) => a + (p.metrics.engagementRate || 0), 0) / withM.length : 0;
  const top = withM.sort((a, b) => (b.metrics?.engagementRate || 0) - (a.metrics?.engagementRate || 0))[0];
  return {
    weekOf: new Date(now - 6 * 864e5).toISOString().slice(0, 10),
    postsCount: week.length,
    generatedAt: new Date().toISOString(),
    summary: `지난주 ${week.length}건 발행. 평균 참여율 ${(avg * 100).toFixed(1)}%.` + (top ? ` 최고 성과는 "${top.topic}"입니다.` : ''),
    top: top ? { label: '인스타그램', title: top.topic, engagementRate: top.metrics.engagementRate || 0 } : null,
    channels: [{ label: '인스타그램', posts: week.length, avgEngagement: avg, totalViews: withM.reduce((a, p) => a + (p.metrics.views || 0), 0), totalLikes: withM.reduce((a, p) => a + (p.metrics.likes || 0), 0) }],
    recommendations: top ? [`"${top.topic}" 톤·구성을 변주해 후속편을 만드세요.`] : [],
  };
}

function buildClientData(slug) {
  const config = loadConfig(slug);
  const schedule = loadSchedule(slug);
  const published = loadPublished(slug);
  const insights = loadInsights(slug);
  const pubById = new Map(published.posts.map((p) => [p.id, p]));
  const insById = new Map((insights.posts || []).map((p) => [p.id, p]));
  const publishTime = (config.scheduleTimes || ['11:00'])[0];

  // 기획안 카드 (pslab PendingCard 대응)
  const planCards = schedule.posts.map((post) => {
    const pub = pubById.get(post.id);
    const ins = insById.get(post.id);
    const slides = collectCards(slug, post.id);
    const er = ins && ins.reach ? ((ins.likes || 0) + (ins.comments || 0)) / ins.reach : 0;
    return {
      id: post.id,
      topic: post.title,
      format: '카드뉴스',
      channels: ['instagram'],
      scheduledFor: `${post.date}T${publishTime}`,
      headline: post.title,
      dayLabel: post.pillar,
      cardImage: slides[0],
      captionBody: readCaption(slug, post.id),
      slideImages: slides,
      status: pub ? 'published' : 'planned',
      publishedUrl: pub?.permalink || undefined,
      publishedAt: pub?.publishedAt,
      metrics: ins ? { views: ins.reach || 0, likes: ins.likes || 0, comments: ins.comments || 0, engagementRate: er } : undefined,
      pillar: post.pillar,
    };
  }).sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));

  // 채널별 데이터
  const channels = CHANNELS.map((c) => {
    const active = (config.targets || ['instagram']).includes(c.key);
    const pending = c.key === 'instagram' ? planCards.filter((p) => p.status !== 'published') : [];
    const pubCards = c.key === 'instagram'
      ? planCards.filter((p) => p.status === 'published').map((p) => ({
          topic: p.topic, time: p.publishedAt || p.scheduledFor, imageUrl: p.cardImage,
          caption: (p.captionBody || '').split('\n')[0], url: p.publishedUrl,
          views: p.metrics?.views || 0, likes: p.metrics?.likes || 0, comments: p.metrics?.comments || 0,
          engagementRate: p.metrics?.engagementRate || 0,
        }))
      : [];
    const er = pubCards.map((p) => p.engagementRate);
    const avgEng = er.length ? er.reduce((a, b) => a + b, 0) / er.length : 0;
    return {
      ...c,
      active,
      published: pubCards.reverse(),
      pending,
      stats: {
        publishedCount: pubCards.length,
        pendingCount: pending.length,
        avgEngagement: avgEng,
        trend: er.length < 2 ? 'n/a' : er[er.length - 1] >= er[er.length - 2] ? 'up' : 'down',
        totalViews: pubCards.reduce((a, p) => a + p.views, 0),
        totalLikes: pubCards.reduce((a, p) => a + p.likes, 0),
      },
      series: er.map((x) => x * 100).slice(-12),
    };
  });

  const defaultManageUrl = (key, handle) => {
    switch (key) {
      case 'instagram': return handle ? `https://www.instagram.com/${handle}` : 'https://www.instagram.com/';
      case 'threads': return handle ? `https://www.threads.net/@${handle}` : 'https://www.threads.net/';
      case 'naver-blog': return 'https://admin.blog.naver.com/';
      case 'blogger': return 'https://www.blogger.com/';
      case 'youtube': return 'https://studio.youtube.com/';
      case 'linkedin': return handle ? `https://www.linkedin.com/in/${handle}` : 'https://www.linkedin.com/';
      default: return '';
    }
  };
  const channelLinks = CHANNELS
    .filter((c) => (config.targets || ['instagram']).includes(c.key))
    .map((c) => {
      const handle = config.accounts?.[c.key];
      const url = config.channelLinks?.[c.key] || defaultManageUrl(c.key, handle);
      return { key: c.key, label: c.label, icon: c.icon, url, sub: handle ? `@${handle}` : '관리 열기' };
    })
    .filter((x) => x.url);

  const publishedCards = planCards.filter((p) => p.status === 'published');
  const blogChannel = channels.find((c) => c.key === 'naver-blog');

  return {
    id: slug,
    name: config.name,
    industry: config.industry || '',
    brandTone: config.brandTone || '',
    keywords: config.keywords || [],
    competitors: config.competitors || [],
    bannedWords: [],
    schedule: config.scheduleTimes || ['11:00'],
    reviewMode: '검수 후 발행',
    designVersion: 2,
    designStyle: {
      palette: 'CMYK 모티프 (잉크 네이비 + 시안/마젠타/옐로)',
      mood: '물어보기 편한 인쇄 전문가',
      composition: '후킹 커버 → 본문 팁 → CTA',
      notes: [],
    },
    heldCount: planCards.filter((p) => p.status !== 'published').length,
    totalCycles: planCards.length,
    totalPublished: publishedCards.length,
    planUpdatedAt: insights.updatedAt || new Date().toISOString(),
    planCards,
    channels,
    channelLinks,
    blog: buildBlog(config, blogChannel.published),
    learning: buildLearning(insights.posts || []),
    tokenHealth: null,
    weeklyReport: buildWeekly(config, publishedCards),
  };
}

export function buildDashboard(opts = {}) {
  const env = process.env;
  const has = (...keys) => keys.every((k) => Boolean(env[k]));
  const clients = listClients().map(buildClientData);
  const first = clients[0];
  const setup = {
    instagram: has('META_ACCESS_TOKEN') && clients.some((c) => {
      const cfg = loadConfig(c.id);
      return Boolean(env[`IG_USER_ID__${cfg.igEnvKey}`]);
    }),
    cloudinary: has('CLOUDINARY_URL'),
    kakao: has('KAKAO_REST_KEY', 'KAKAO_REFRESH_TOKEN'),
    contentReady: Boolean(first && first.planCards.some((p) => (p.slideImages || []).length > 0)),
    firstPublish: Boolean(first && first.totalPublished > 0),
  };
  const monthLabel = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date());

  const data = { generatedAt: new Date().toISOString(), repo: REPO, monthLabel, channels: CHANNELS, setup, clients };
  let json = JSON.stringify(data).replace(/</g, '\\u003c');

  let html = renderHtml(json, first?.name || 'SNS');

  // --inline: 카드 이미지를 data URI로 임베드 (Artifact 등 단일 파일 배포용)
  if (opts.inline) {
    html = html.replace(/"cards\/([^"\\]+)"/g, (m, rel) => {
      const p = path.join(ROOT, 'dashboard', 'cards', rel);
      if (!fs.existsSync(p)) return m;
      return `"data:image/png;base64,${fs.readFileSync(p).toString('base64')}"`;
    });
  }

  const outPath = opts.outPath || path.join(ROOT, 'dashboard', 'index.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return { clients: clients.map((c) => c.id), outPath };
}

function renderHtml(json, brandName) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="refresh" content="300"/>
<title>${brandName} 콘텐츠 관제실</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;background:#0d0f14;color:#e6e8ee}
a{color:#6db3ff}
header{padding:16px 22px;border-bottom:1px solid #1e2230;background:#12141d;position:sticky;top:0;z-index:5}
.brand{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
.sub{color:#7b8398;font-size:12px;margin-top:3px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.clients{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.cbtn{background:#1a1e2a;border:1px solid #262b3a;color:#cbd3e1;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px}
.cbtn.on{background:#2b6fff;border-color:#2b6fff;color:#fff}
.tabs{display:flex;gap:4px;flex-wrap:wrap;padding:12px 22px 0;border-bottom:1px solid #1e2230;background:#12141d;position:sticky;top:58px;z-index:4}
.tab{background:transparent;border:none;border-bottom:2px solid transparent;color:#8b93a7;padding:8px 12px;cursor:pointer;font-size:14px}
.tab.on{color:#fff;border-bottom-color:#2b6fff}
.tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:5px;vertical-align:middle}
.dot.live{background:#4ade80}.dot.off{background:#444b5c}
main{padding:18px 22px;max-width:1180px;margin:0 auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:#141823;border:1px solid #222838;border-radius:12px;padding:12px 14px}
.kpi .v{font-size:22px;font-weight:700}.kpi .l{color:#7b8398;font-size:12px;margin-top:2px}
.kpi .v.accent{color:#ffb454}
.panel{background:#141823;border:1px solid #222838;border-radius:12px;padding:14px 16px;margin-bottom:16px}
.panel h3{margin:0 0 10px;font-size:15px}
.sect-h{display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px}
.sect-h h2{font-size:16px;margin:0}
.btn{background:#222838;border:1px solid #2d3346;color:#cbd3e1;padding:6px 11px;border-radius:8px;font-size:12px;text-decoration:none;cursor:pointer}
.btn.fb{background:#2a2030;border-color:#5a3a6a;color:#e0b0ff}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.card{background:#141823;border:1px solid #222838;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.thumb{width:100%;aspect-ratio:4/5;object-fit:cover;background:#0a0c11;display:block}
.thumb.noimg{display:flex;align-items:center;justify-content:center;color:#4b5263;font-size:13px}
.cbody{padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:6px}
.ctop{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.ctop strong{font-size:13px}
.muted{color:#7b8398;font-size:11px}
.cap{color:#aeb6c6;font-size:12px;line-height:1.4;max-height:3.6em;overflow:hidden}
.met{display:flex;gap:10px;font-size:11px;color:#9aa3b5;margin-top:auto}
.badge{font-size:10px;padding:2px 7px;border-radius:20px;white-space:nowrap}
.b-ok{background:#15331f;color:#4ade80}.b-wait{background:#33290f;color:#ffb454}.b-plan{background:#16243a;color:#6db3ff}.b-hold{background:#331818;color:#ff7a7a}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1e2230}
th{color:#7b8398;font-weight:600;font-size:12px}
.grade{display:inline-flex;align-items:center;justify-content:center;min-width:108px;padding:10px 16px;border-radius:12px;font-weight:800;font-size:18px}
.bar{height:7px;border-radius:4px;background:#222838;overflow:hidden}.bar>i{display:block;height:100%;background:#2b6fff}
.plan-pill{font-size:11px;color:#9aa3b5}
.spark{display:block}
.empty{color:#6b7387;padding:18px;text-align:center;font-size:13px}
.tag{display:inline-block;background:#1a1e2a;border:1px solid #262b3a;border-radius:6px;padding:2px 7px;font-size:11px;color:#9aa3b5;margin:2px 2px 0 0}
footer{text-align:center;color:#4b5263;font-size:11px;padding:22px}
.card.clk{cursor:pointer;transition:transform .12s,border-color .12s}
.card.clk:hover{transform:translateY(-3px);border-color:#3a4256}
.b-var{font-weight:600}.v-A{background:#33240f;color:#ff8a3d}.v-B{background:#0c2a28;color:#36d6c4}.v-C{background:#2a2415;color:#ffc24a}
.modal{position:fixed;inset:0;background:rgba(6,8,12,.82);display:none;align-items:flex-start;justify-content:center;z-index:50;padding:32px 16px;overflow:auto}
.modal.on{display:flex}
.mwrap{position:relative;background:#12141d;border:1px solid #262b3a;border-radius:16px;max-width:920px;width:100%;padding:22px}
.mx{position:absolute;top:14px;right:14px;background:#222838;border:1px solid #2d3346;color:#cbd3e1;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:15px}
#mbody h2{font-size:23px}
#mbody .kick{color:#ff8a3d;font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.carou{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px 12px;-webkit-overflow-scrolling:touch}
.carou .slide{position:relative;flex:0 0 auto;scroll-snap-align:center}
.carou .slide img{height:520px;width:auto;border-radius:14px;display:block;background:#0a0c11;border:1px solid #222838}
.carou .snum{position:absolute;top:10px;right:10px;background:rgba(8,10,14,.7);color:#cbd3e1;font-size:11px;padding:3px 8px;border-radius:20px}
.carou::-webkit-scrollbar{height:8px}.carou::-webkit-scrollbar-thumb{background:#2d3346;border-radius:8px}
.capbox{background:#0f1219;border:1px solid #222838;border-radius:12px;padding:14px 16px}
.caphd{color:#7b8398;font-size:12px;font-weight:600;margin-bottom:8px}
.mcap{white-space:normal;line-height:1.75;font-size:15px;color:#d4dae6}
.chgrp{margin:10px 0 18px}
.chgrp-h{font-size:14px;font-weight:700;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid #1e2230}
.md-h1{font-size:19px;margin:10px 0 8px;font-weight:800}.md-h{font-size:15px;color:#ffb454;margin:14px 0 4px;font-weight:700}
.md-tag{color:#6db3ff;font-weight:600;font-size:13px;margin:10px 0 2px}.md-sp{height:10px}
.md-quote{background:#16202e;border-left:3px solid #ffb454;padding:8px 12px;color:#e6e8ee;font-size:14px}
.md-quote+.md-quote{padding-top:0}
.md-tags{color:#6db3ff;font-size:13px;margin-top:12px}
.md-img{display:block;width:100%;border-radius:10px;margin:12px 0;border:1px solid #222838}
.mcap b{color:#fff}
.thumbwrap{position:relative}
.b-car{position:absolute;top:8px;right:8px;background:rgba(8,10,14,.74);color:#e6e8ee;border:1px solid #2d3346}
@media(max-width:720px){.carou .slide img{height:60vh}}
</style>
</head>
<body>
<header>
  <div class="brand">🖨️ ${brandName} 콘텐츠 관제실</div>
  <div class="sub">채널별 현황 · 발행/대기 · 반응도 · 기획안 피드백 · 5분 자동 새로고침</div>
  <div class="clients" id="clients"></div>
</header>
<div class="tabs" id="tabs"></div>
<main id="view"></main>
<footer>sns-autopost v2 · 자동 생성 · <span id="gen"></span></footer>
<div id="modal" class="modal" onclick="if(event.target===this)closeModal()">
  <div class="mwrap"><button class="mx" onclick="closeModal()">✕</button><div id="mbody"></div></div>
</div>
<script>
/* 안전장치: 메인 스크립트가 깨져도 빈 화면 대신 오류와 새로고침 버튼을 보여준다. */
window.onerror = function (m) {
  try {
    var v = document.getElementById('view');
    if (v && !(v.innerHTML && v.innerHTML.replace(/\\s/g, ''))) {
      v.innerHTML = '<div style="padding:24px;line-height:1.7;color:#ffb4b4">'
        + '화면을 그리는 중 문제가 생겼어요.<br>'
        + '<span style="color:#9aa6bd;font-size:13px">' + String(m) + '</span><br><br>'
        + '<button onclick="location.reload(true)" style="padding:10px 16px;border-radius:8px;border:0;background:#2b6fff;color:#fff;font-size:15px">새로고침</button>'
        + '</div>';
    }
  } catch (e) {}
  return false;
};
</script>
<script>
const DATA = ${json};
const REPO = DATA.repo;
let ci = 0, ch = 'all';
const VER = (((DATA.clients[0]||{}).planUpdatedAt)||DATA.generatedAt||'').replace(/\\D/g,'').slice(0,14);
const imgv = s => !s ? s : (s.indexOf('data:')===0 ? s : (s + (s.indexOf('?')<0?'?':'&') + 'v=' + VER));
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ftime = s => !s?'-':String(s).replace('T',' ').slice(0,16);
const pct = v => (v*100).toFixed(1)+'%';
const tIcon = t => ({up:'📈',down:'📉','n/a':'·'}[t]||'·');
function issue(title, body){
  return 'https://github.com/'+REPO+'/issues/new?labels=feedback&title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
}
function sparkline(arr){
  if(!arr||arr.length<2) return '';
  const w=160,h=34,mx=Math.max(...arr,1),mn=Math.min(...arr,0);
  const dx=w/(arr.length-1);
  const pts=arr.map((v,i)=>[i*dx,h-((v-mn)/(mx-mn||1))*(h-6)-3]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  return '<svg class="spark" width="'+w+'" height="'+h+'"><path d="'+d+'" fill="none" stroke="#2b6fff" stroke-width="2"/></svg>';
}
function publishedCard(p, badge){
  const img=p.imageUrl?'<img class="thumb" src="'+esc(imgv(p.imageUrl))+'" loading="lazy" alt=""/>':'<div class="thumb noimg">이미지 없음</div>';
  const link=p.url?'<a href="'+esc(p.url)+'" target="_blank">열기 ↗</a>':'';
  return '<div class="card">'+img+'<div class="cbody"><div class="ctop"><strong>'+esc(p.topic)+'</strong>'+badge+'</div>'+
    '<div class="muted">'+ftime(p.time)+'</div>'+
    '<div class="cap">'+esc(p.caption||'')+'</div>'+
    '<div class="met"><span>👁 '+p.views+'</span><span>❤ '+p.likes+'</span><span>💬 '+p.comments+'</span><span>'+pct(p.engagementRate)+'</span></div>'+
    '<div>'+link+'</div></div></div>';
}
function plainHead(it){ return it.headline?it.headline.replace(/<br>/g,' ').replace(/\\*/g,''):it.topic; }
function vBadge(v){ return v?'<span class="badge b-var v-'+esc(v)+'">디자인 '+esc(v)+'</span>':''; }
function slideCount(it){ return (it.slideImages&&it.slideImages.length)||1; }
function planCard(client, chLabel, it){
  const img=it.cardImage?'<img class="thumb" src="'+esc(imgv(it.cardImage))+'" loading="lazy" alt=""/>':'<div class="thumb noimg">카드 준비중</div>';
  const head=esc(plainHead(it));
  const n=slideCount(it);
  const carBadge=n>1?'<span class="badge b-car">📑 '+n+'장</span>':'';
  const pub=it.status==='published';
  const manual=it.status==='manual';
  const stBadge=pub?'<span class="badge b-ok">발행됨</span>':manual?'<span class="badge b-wait">수동발행</span>':'<span class="badge b-plan">예정</span>';
  const right=pub&&it.publishedUrl?'<a href="'+esc(it.publishedUrl)+'" target="_blank" onclick="event.stopPropagation()">열기 ↗</a>':'<span class="muted">클릭하면 전체보기 →</span>';
  const m=it.metrics;
  const metLine=(pub&&m)?'<div class="met" style="margin-top:0"><span>👁 '+(m.views||0)+'</span><span>❤ '+(m.likes||0)+'</span><span>💬 '+(m.comments||0)+'</span><span>'+pct(m.engagementRate||0)+'</span></div>':'';
  return '<div class="card clk" onclick="openDetail(\\''+esc(it.id)+'\\')">'+
    '<div class="thumbwrap">'+img+carBadge+'</div>'+
    '<div class="cbody"><div class="ctop"><strong>'+head+'</strong>'+stBadge+'</div>'+
    '<div class="muted">🗓 '+ftime(it.scheduledFor)+(it.dayLabel?' · '+esc(it.dayLabel):'')+'</div>'+
    (it.captionNote?'<div class="cap">'+esc(it.captionNote)+'</div>':'')+
    metLine+
    '<div class="met" style="justify-content:space-between;align-items:center">'+vBadge(it.variant)+right+'</div></div></div>';
}
function openDetail(id){
  const c=DATA.clients[ci];
  const it=(c.planCards||[]).find(x=>x.id===id); if(!it) return;
  const t='['+c.name+'] 콘텐츠 수정요청: '+plainHead(it);
  const b='이 콘텐츠 수정/방향 요청을 남겨주세요.\\n\\n- 헤드라인: '+plainHead(it)+'\\n- 예정: '+ftime(it.scheduledFor)+'\\n- 필러: '+(it.dayLabel||'')+'\\n\\n[수정 요청]\\n';
  const imgs=(it.slideImages&&it.slideImages.length)?it.slideImages:(it.cardImage?[it.cardImage]:[]);
  const chDef=DATA.channels.find(x=>x.key===((it.channels||[])[0]))||{icon:'📸',label:'인스타그램',key:'instagram'};
  const isCarousel=imgs.length>1;
  const capLabel=chDef.key==='naver-blog'?'📝 블로그 본문':chDef.key==='youtube'?'🎬 쇼츠 대본':chDef.key==='threads'?'🧵 스레드 타래':chDef.key==='linkedin'?'💼 링크드인 포스트':'📝 발행 캡션';
  const slides=imgs.map((s,i)=>'<div class="slide"><img src="'+esc(imgv(s))+'" alt=""/><span class="snum">'+(i+1)+' / '+imgs.length+'</span></div>').join('');
  const cap=fmtCaption(it.captionBody||it.captionNote||'');
  const m=it.metrics;
  const pubBadge=it.status==='published'?'<span class="badge b-ok">발행됨</span>':'<span class="badge b-plan">발행 대기</span>';
  const perf=(it.status==='published'&&m)?'<div class="capbox" style="margin-bottom:12px;border-color:#2d3a5a"><div class="caphd">📊 성과 데이터</div>'+
    '<div class="met" style="font-size:13px"><span>👁 '+(m.views||0)+'</span><span>❤ '+(m.likes||0)+'</span><span>💬 '+(m.comments||0)+'</span><span>참여율 '+pct(m.engagementRate||0)+'</span></div>'+
    (it.insightComment?'<div style="color:#9fe6b0;font-size:14px;margin-top:8px;line-height:1.6">💬 '+esc(it.insightComment)+'</div>':'')+'</div>':'';
  document.getElementById('mbody').innerHTML=
    '<div class="kick">'+esc(it.kicker||it.dayLabel||'')+(isCarousel?' · 📑 캐러셀 '+imgs.length+'장':'')+'</div>'+
    '<h2 style="margin:2px 0 4px">'+esc(plainHead(it))+'</h2>'+
    '<div class="muted" style="margin-bottom:14px">🗓 '+ftime(it.scheduledFor)+(it.dayLabel?' · '+esc(it.dayLabel):'')+' · '+chDef.icon+' '+esc(chDef.label)+' · '+pubBadge+'</div>'+
    '<div class="carou">'+slides+'</div>'+
    (isCarousel?'<div class="muted" style="margin:6px 0 14px">← 좌우로 넘겨 보세요 ('+imgs.length+'장)</div>':'<div style="height:8px"></div>')+
    perf+
    '<div class="capbox"><div class="caphd">'+capLabel+'</div><div class="mcap">'+cap+'</div></div>'+
    '<div style="margin-top:16px;display:flex;gap:8px"><a class="btn fb" href="'+issue(t,b)+'" target="_blank">✏️ 수정요청</a><button class="btn" onclick="closeModal()">닫기</button></div>';
  document.getElementById('modal').classList.add('on');
  const car=document.querySelector('.carou'); if(car) car.scrollLeft=0;
}
function closeModal(){ document.getElementById('modal').classList.remove('on'); }
function mdInline(x){ return esc(x).replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>'); }
function fmtCaption(s){
  return String(s||'').split('\\n').map(line=>{
    const t=line.trim();
    const img=t.match(/^!\\[([^\\]]*)\\]\\(([^)]+)\\)$/);
    if(img) return '<img class="md-img" src="'+esc(img[2])+'" alt="'+esc(img[1])+'" loading="lazy"/>';
    if(t.startsWith('## ')) return '<h4 class="md-h">'+mdInline(t.slice(3))+'</h4>';
    if(t.startsWith('# ')) return '<h3 class="md-h1">'+mdInline(t.slice(2))+'</h3>';
    if(t==='>'||t.startsWith('> ')) return '<div class="md-quote">'+mdInline(t.replace(/^>\\s?/,''))+'</div>';
    if(t.indexOf('🔖')===0) return '<div class="md-tags">'+esc(t)+'</div>';
    if(/^\\[.+\\]$/.test(t)) return '<div class="md-tag">'+esc(t)+'</div>';
    if(t==='---'||t==='') return '<div class="md-sp"></div>';
    return '<div>'+mdInline(line)+'</div>';
  }).join('');
}
function channelDetail(client, c){
  const chLabel=(DATA.channels.find(x=>x.key===c.key)||{}).label||c.key;
  let h='';
  const planTitle='['+client.name+'/'+chLabel+'] 기획안 피드백';
  const planBody='이 채널 기획안에 대한 피드백/수정사항을 적어주세요.\\n\\n[현재 기획안]\\n- 키워드: '+client.keywords.join(', ')+'\\n- 브랜드 말투: '+client.brandTone+'\\n- 발행시간: '+client.schedule.join(', ')+'\\n- 디자인 스타일: '+client.designStyle.mood+' / '+client.designStyle.palette+'\\n\\n[수정 요청]\\n';
  h+='<div class="panel"><div class="sect-h" style="margin:0 0 8px"><h3>📋 기획안</h3><a class="btn fb" href="'+issue(planTitle,planBody)+'" target="_blank">✏️ 기획안 피드백</a></div>'+
     '<div>'+client.keywords.map(k=>'<span class="tag">#'+esc(k)+'</span>').join('')+'</div>'+
     '<div class="muted" style="margin-top:8px">말투: '+esc(client.brandTone)+' · 발행 '+client.schedule.join(', ')+' · 검수 '+esc(client.reviewMode)+' · 디자인 v'+client.designVersion+'</div>'+
     '<div class="muted">디자인 스타일: '+esc(client.designStyle.mood)+' / '+esc(client.designStyle.palette)+' / '+esc(client.designStyle.composition)+'</div></div>';
  if(!c.active){
    h+='<div class="panel"><div class="empty">이 채널은 아직 <b>연결되지 않았습니다</b>. 설정표(targets)에 '+chLabel+'을 추가하고 키를 연결하면 자동 발행이 시작됩니다.</div></div>';
  }
  h+='<div class="kpis">'+
    kpi(c.stats.publishedCount,'발행됨')+
    kpi(c.stats.pendingCount,'발행 대기')+
    kpi(pct(c.stats.avgEngagement)+' '+tIcon(c.stats.trend),'평균 참여율',true)+
    kpi(c.stats.totalViews,'누적 도달')+
    kpi(c.stats.totalLikes,'누적 좋아요')+'</div>';
  if(c.series&&c.series.length>1){h+='<div class="panel"><h3>반응도 추세 (참여율 %)</h3>'+sparkline(c.series)+'</div>';}
  h+=pubDataRows(client.planCards.filter(it=>(it.channels||[]).includes(c.key)));
  if(c.key==='naver-blog'){ h+=blogSection(client); }
  h+='<div class="sect-h"><h2>🕓 발행 대기 콘텐츠 ('+c.pending.length+')</h2></div>';
  h+= c.pending.length? '<div class="cards">'+c.pending.map(it=>planCard(client,chLabel,it)).join('')+'</div>' : '<div class="empty">예정된 콘텐츠가 없습니다. 다음 사이클에 자동 생성됩니다.</div>';
  h+='<div class="sect-h"><h2>✅ 발행된 콘텐츠 ('+c.published.length+')</h2></div>';
  h+= c.published.length? '<div class="cards">'+c.published.map(p=>publishedCard(p,'<span class="badge b-ok">발행</span>')).join('')+'</div>' : '<div class="empty">아직 발행된 콘텐츠가 없습니다.</div>';
  return h;
}
function blogSection(client){
  const b=client.blog;
  const color = b.score>=70?'#15331f':b.score>=40?'#33290f':'#262b3a';
  const fg = b.score>=70?'#4ade80':b.score>=40?'#ffb454':'#9aa3b5';
  let h='<div class="panel"><div class="sect-h" style="margin:0 0 10px"><h3>📊 블로그 지수</h3><span class="muted">내부 추정 · 네이버 연동 시 실측 교체</span></div>';
  h+='<div class="row"><div class="grade" style="background:'+color+';color:'+fg+'">'+esc(b.grade)+'</div>'+
     '<div style="flex:1;min-width:160px"><div class="muted">종합 점수 '+b.score+'/100</div><div class="bar"><i style="width:'+b.score+'%"></i></div></div></div>';
  h+='<table style="margin-top:12px"><tr><th>키워드</th><th>검색지수</th><th>경쟁도</th></tr>'+
    b.keywords.map(k=>'<tr><td>#'+esc(k.kw)+'</td><td>'+k.searchIndex.toLocaleString()+'</td><td>'+esc(k.competition)+'</td></tr>').join('')+'</table>';
  h+='</div>';
  return h;
}
function learningPanel(client){
  const L=client.learning; if(!L) return '';
  const gs=g=>'<tr><td>'+esc(g.key)+'</td><td>'+g.posts+'</td><td>'+pct(g.avgEngagement)+'</td><td>'+Math.round(g.avgLikes)+'</td></tr>';
  let h='<div class="panel"><div class="sect-h" style="margin:0 0 10px"><h3>🧠 성과 인사이트 · 자체 학습</h3><span class="muted">표본 '+L.sampleSize+'건 · '+ftime(L.generatedAt)+'</span></div>';
  if(L.sampleSize<1){
    h+='<div class="empty">발행물 성과가 쌓이면 어떤 디자인·시간대·소재가 잘 먹히는지 여기서 자동 분석됩니다.</div></div>';
    return h;
  }
  if(L.hints&&L.hints.length){
    h+='<div style="margin-bottom:10px">'+L.hints.map(x=>'<div class="muted" style="color:#9fe6b0;font-size:13px;margin:3px 0">💡 '+esc(x)+'</div>').join('')+'</div>';
  }
  if(L.variants&&L.variants.length){
    h+='<div class="muted" style="margin:8px 0 4px">콘텐츠 필러별 성과</div>'+
      '<table><tr><th>필러</th><th>발행</th><th>평균 참여율</th><th>평균 좋아요</th></tr>'+L.variants.map(gs).join('')+'</table>';
  }
  if(L.hours&&L.hours.length>1){
    h+='<div class="muted" style="margin:12px 0 4px">시간대별 성과</div><table><tr><th>발행시각</th><th>발행</th><th>평균 참여율</th><th>평균 좋아요</th></tr>'+L.hours.map(gs).join('')+'</table>';
  }
  h+='<div class="muted" style="margin-top:10px">이 학습은 다음 기획 생성 때 디자인 선택·소재 방향에 자동 반영됩니다(자체 디벨롭).</div></div>';
  return h;
}
function weeklyPanel(client){
  const w=client.weeklyReport; if(!w) return '';
  const chRows=(w.channels||[]).map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+c.posts+'</td><td>'+pct(c.avgEngagement)+'</td><td>'+c.totalViews+'</td><td>'+c.totalLikes+'</td></tr>').join('');
  const recs=(w.recommendations||[]).map(r=>'<li>'+esc(r)+'</li>').join('');
  const top=w.top?'<div class="muted" style="margin:6px 0">🏆 최고 성과: <b>['+esc(w.top.label)+'] '+esc(w.top.title)+'</b> ('+pct(w.top.engagementRate)+')</div>':'';
  return '<div class="panel" style="border-color:#2d3a5a;background:#121a26">'+
    '<div class="sect-h" style="margin:0 0 10px"><h3>📅 주간 종합 리포트</h3><span class="muted">'+esc(w.weekOf)+' 주 · 발행 '+w.postsCount+'건 · '+ftime(w.generatedAt)+'</span></div>'+
    '<div class="mcap" style="font-size:14px;margin-bottom:8px">'+esc(w.summary)+'</div>'+top+
    (chRows?'<table style="margin:8px 0"><tr><th>채널</th><th>발행</th><th>평균 참여율</th><th>도달</th><th>좋아요</th></tr>'+chRows+'</table>':'')+
    (recs?'<div class="muted" style="margin:8px 0 4px">다음 주 방향</div><ul style="margin:0;padding-left:18px;color:#9fe6b0;font-size:13px">'+recs+'</ul>':'')+
    '</div>';
}
function pubDataRows(items){
  const pub=items.filter(it=>it.status==='published'&&it.metrics);
  if(!pub.length) return '';
  pub.sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||''));
  const rows=pub.map(it=>{const m=it.metrics||{};
    return '<tr><td><b>'+esc(plainHead(it))+'</b><div class="muted">'+ftime(it.publishedAt)+(it.dayLabel?' · '+esc(it.dayLabel):'')+'</div>'+
      (it.insightComment?'<div style="color:#9fe6b0;font-size:12px;margin-top:4px">💬 '+esc(it.insightComment)+'</div>':'')+'</td>'+
      '<td>'+(m.views||0)+'</td><td>'+(m.likes||0)+'</td><td>'+(m.comments||0)+'</td><td>'+pct(m.engagementRate||0)+'</td>'+
      '<td>'+(it.publishedUrl?'<a href="'+esc(it.publishedUrl)+'" target="_blank">열기↗</a>':'')+'</td></tr>';
  }).join('');
  return '<div class="panel"><div class="sect-h" style="margin:0 0 8px"><h3>📊 발행 콘텐츠 데이터</h3><span class="muted">'+pub.length+'건 · 성과+인사이트</span></div>'+
    '<table><tr><th>콘텐츠 / 인사이트</th><th>도달</th><th>좋아요</th><th>댓글</th><th>참여율</th><th></th></tr>'+rows+'</table></div>';
}
function setupPanel(){
  const s=DATA.setup||{};
  const settingsUrl='https://github.com/'+REPO+'/settings/secrets/actions';
  const row=(ok,name,todo,url)=>'<tr><td style="width:34px;font-size:16px">'+(ok?'✅':'⬜')+'</td><td><b>'+esc(name)+'</b>'+(ok?'':'<div class="muted" style="margin-top:2px">'+todo+(url?' · <a href="'+url+'" target="_blank">설정 열기 ↗</a>':'')+'</div>')+'</td></tr>';
  const done=[s.instagram,s.cloudinary,s.kakao,s.contentReady,s.firstPublish].filter(Boolean).length;
  return '<div class="panel" style="border-color:#2b6fff">'+
    '<div class="sect-h" style="margin:0 0 8px"><h3>🚀 오픈 준비 체크리스트</h3><span class="muted">'+done+'/5 완료</span></div>'+
    '<table>'+
    row(s.instagram,'인스타그램 연결','발행 토큰 미설정 — META_ACCESS_TOKEN + IG_USER_ID__* 시크릿',settingsUrl)+
    row(s.cloudinary,'이미지 호스팅(Cloudinary)','CLOUDINARY_URL 시크릿 (Graph API는 공개 이미지 URL 필요)',settingsUrl)+
    row(s.kakao,'카카오톡 발행 알림','KAKAO_REST_KEY + KAKAO_REFRESH_TOKEN 시크릿',settingsUrl)+
    row(s.contentReady,'첫 캐러셀 콘텐츠 준비','clients/*/content/에 슬라이드 제작 후 렌더',null)+
    row(s.firstPublish,'첫 자동발행 완료','토큰 등록 후 run.js --live 또는 Actions cron 대기',null)+
    '</table>'+
    '<div class="muted" style="margin-top:8px"><b>인스타그램</b>은 API로 자동발행됩니다. <b>네이버 블로그·유튜브</b> 등 추가 채널은 확장 예정입니다.</div>'+
    '</div>';
}
function chGrad(key){
  return ({youtube:'linear-gradient(135deg,#3a0d12,#5a1620)',instagram:'linear-gradient(135deg,#3a1140,#5a1a4a)',threads:'linear-gradient(135deg,#0f1c1e,#16282b)','naver-blog':'linear-gradient(135deg,#0e2417,#123a22)',blogger:'linear-gradient(135deg,#3a1e08,#5a2f0d)',linkedin:'linear-gradient(135deg,#0d1b33,#12294d)'})[key]||'linear-gradient(135deg,#161b26,#1c2434)';
}
function chBorder(key){ return ({youtube:'#7a2530',instagram:'#7a3a6a',threads:'#2b5a5f','naver-blog':'#2b7a4a',blogger:'#7a4a1f',linkedin:'#2b5aa0'})[key]||'#2b3550'; }
function channelLinksPanel(client){
  const links=client.channelLinks||[];
  if(!links.length) return '';
  const cards=links.map(l=>
    '<a href="'+esc(l.url)+'" target="_blank" rel="noopener" style="flex:1 1 200px;min-width:180px;text-decoration:none;border-radius:14px;padding:16px 18px;border:1px solid '+chBorder(l.key)+';background:'+chGrad(l.key)+';display:block">'+
    '<div style="font-weight:800;font-size:18px;color:#f4f7fb;margin-bottom:4px">'+l.icon+' '+esc(l.label)+'</div>'+
    '<div style="font-size:13px;color:#cdd6e6;opacity:.85">'+esc(l.sub)+'</div></a>').join('');
  return '<div class="panel"><div class="sect-h" style="margin:0 0 10px"><h3>🔗 채널 바로가기</h3><span class="muted">클릭하면 각 채널 관리로 이동</span></div>'+
    '<div style="display:flex;gap:12px;flex-wrap:wrap">'+cards+'</div></div>';
}
function overview(client){
  let h='';
  h+=setupPanel();
  h+=channelLinksPanel(client);
  h+=weeklyPanel(client);
  h+='<div class="kpis">'+
    kpi(client.totalCycles,'총 기획')+
    kpi(client.totalPublished,'총 발행')+
    kpi(client.heldCount,'발행 대기',client.heldCount>0)+
    kpi('v'+client.designVersion,'시스템 버전')+'</div>';
  h+=learningPanel(client);
  h+='<div class="panel"><h3>채널별 요약</h3><table><tr><th>채널</th><th>상태</th><th>발행</th><th>대기</th><th>평균 참여율</th></tr>'+
    client.channels.map(c=>{const lab=(DATA.channels.find(x=>x.key===c.key)||{});
      return '<tr><td>'+lab.icon+' '+lab.label+'</td><td>'+(c.active?'<span class="badge b-ok">연결</span>':'<span class="badge b-hold">미연결</span>')+'</td><td>'+c.stats.publishedCount+'</td><td>'+c.stats.pendingCount+'</td><td>'+pct(c.stats.avgEngagement)+' '+tIcon(c.stats.trend)+'</td></tr>';}).join('')+'</table></div>';
  const plan=client.planCards||[];
  const fbTitle='['+client.name+'] 기획안 전체 피드백';
  const fbBody='이번 달 기획안에 대한 의견/수정사항을 적어주세요.\\n\\n';
  h+='<div class="sect-h"><h2>📅 '+DATA.monthLabel+'월 콘텐츠 기획안 ('+plan.length+')</h2><a class="btn fb" href="'+issue(fbTitle,fbBody)+'" target="_blank">✏️ 기획안 피드백</a></div>';
  if(!plan.length){ h+='<div class="empty">기획안이 아직 없습니다.</div>'; }
  else {
    for(const chDef of DATA.channels){
      const items=plan.filter(p=>(p.channels||[]).includes(chDef.key));
      if(!items.length) continue;
      const lab=chDef.icon+' '+chDef.label;
      h+='<div class="chgrp"><div class="chgrp-h">'+lab+' <span class="muted">'+items.length+'건 · '+esc((items[0].format)||'')+'</span></div>'+
         '<div class="cards">'+items.map(p=>planCard(client,chDef.label,p)).join('')+'</div></div>';
    }
  }
  h+='<div class="panel" style="margin-top:16px"><h3>벤치마킹 경쟁사</h3><div>'+(client.competitors.length?client.competitors.map(x=>'<span class="tag">@'+esc(x)+'</span>').join(''):'<span class="muted">미설정</span>')+'</div></div>';
  const recent=[].concat(...client.channels.map(c=>c.published)).sort((a,b)=>(b.time||'').localeCompare(a.time||'')).slice(0,8);
  h+='<div class="sect-h"><h2>✅ 최근 발행</h2></div>';
  h+= recent.length?'<div class="cards">'+recent.map(p=>publishedCard(p,'<span class="badge b-ok">발행</span>')).join('')+'</div>':'<div class="empty">아직 발행된 콘텐츠가 없습니다. (검수 우선 — 승인 후 발행)</div>';
  return h;
}
function kpi(v,l,accent){return '<div class="kpi"><div class="v'+(accent?' accent':'')+'">'+v+'</div><div class="l">'+l+'</div></div>';}
function renderClients(){
  document.getElementById('clients').innerHTML = DATA.clients.length>1 ? DATA.clients.map((c,i)=>'<button class="cbtn'+(i===ci?' on':'')+'" onclick="setClient('+i+')">'+esc(c.name)+'</button>').join('') : '';
}
function renderTabs(){
  const c=DATA.clients[ci];
  const tabs=[{key:'all',label:'전체',icon:'🏠',active:true}].concat(DATA.channels.map(ch=>{const cc=c.channels.find(x=>x.key===ch.key);return {key:ch.key,label:ch.label,icon:ch.icon,active:cc&&cc.active};}));
  document.getElementById('tabs').innerHTML = tabs.map(t=>'<button class="tab'+(t.key===ch?' on':'')+'" onclick="setCh(\\''+t.key+'\\')">'+t.icon+' '+t.label+(t.key!=='all'?'<span class="dot '+(t.active?'live':'off')+'"></span>':'')+'</button>').join('');
}
function renderView(){
  const c=DATA.clients[ci];
  document.getElementById('view').innerHTML = ch==='all'?overview(c):channelDetail(c,c.channels.find(x=>x.key===ch));
  document.getElementById('gen').textContent = ftime(DATA.generatedAt)+' (UTC)';
}
function setClient(i){ci=i;ch='all';renderClients();renderTabs();renderView();window.scrollTo(0,0);}
function setCh(k){ch=k;renderTabs();renderView();window.scrollTo(0,0);}
try {
  renderClients(); renderTabs(); renderView();
} catch (e) {
  var v = document.getElementById('view');
  if (v) v.innerHTML = '<div style="padding:24px;line-height:1.7;color:#ffb4b4">표시 중 오류: '
    + ((e && e.message) || e)
    + '<br><br><button onclick="location.reload(true)" style="padding:10px 16px;border-radius:8px;border:0;background:#2b6fff;color:#fff;font-size:15px">새로고침</button></div>';
}
</script>
</body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inline = process.argv.includes('--inline');
  const outIdx = process.argv.indexOf('--out');
  const out = buildDashboard({ inline, outPath: outIdx > -1 ? process.argv[outIdx + 1] : undefined });
  console.log(JSON.stringify({ ok: true, clients: out.clients, outPath: out.outPath, inline }));
}
