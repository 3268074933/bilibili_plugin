/**
 * B站图片提取器 - Service Worker
 *
 * 职责：
 * 1. 代理 B 站视频元信息接口（内容脚本受页面 CORS 限制，不能直接跨域请求）；
 * 2. 把内容脚本整理好的图片列表写入 chrome.storage.session，并打开结果页；
 * 3. 清理过期的结果页数据，避免长期占用配额。
 */

const API_URL = 'https://api.bilibili.com/x/web-interface/view';
const GALLERY_PREFIX = 'gallery:';
const MAX_GALLERIES = 60;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGES = 500;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'FETCH_VIDEO_META') {
    fetchVideoMeta(message.bvid)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: describeError(error) }));
    return true; // 异步响应，保持消息通道开启
  }

  if (message.type === 'OPEN_GALLERY') {
    openGallery(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: describeError(error) }));
    return true;
  }

  return;
});

/**
 * 读取视频元信息。任何失败都返回 { ok:false }，由内容脚本降级到 DOM 方案。
 */
async function fetchVideoMeta(bvid) {
  if (!bvid || !/^BV[0-9A-Za-z]+$/.test(bvid)) {
    return { ok: false, error: 'BAD_BVID' };
  }

  const url = API_URL + '?bvid=' + encodeURIComponent(bvid);
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (!res.ok) {
        lastError = new Error('HTTP_' + res.status);
        // 4xx 通常是 BV 号错误或风控，重试没有意义
        if (res.status < 500) break;
        await sleep(500);
        continue;
      }

      const json = await res.json();
      if (!json || json.code !== 0 || !json.data) {
        lastError = new Error('API_' + (json && json.code));
        break;
      }

      const data = json.data;
      const pages = Array.isArray(data.pages)
        ? data.pages.map((page) => ({
            page: Number(page.page) || 0,
            part: String(page.part || ''),
            firstFrame: String(page.first_frame || '')
          }))
        : [];

      return {
        ok: true,
        title: String(data.title || ''),
        cover: String(data.pic || ''),
        pages
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(500);
    }
  }

  return { ok: false, error: describeError(lastError) };
}

/**
 * 保存抓取结果并打开结果页。
 */
async function openGallery(payload) {
  if (!payload || !Array.isArray(payload.images)) {
    throw new Error('INVALID_PAYLOAD');
  }

  const images = payload.images
    .filter((item) => item && typeof item.url === 'string' && /^https:\/\//i.test(item.url))
    .slice(0, MAX_IMAGES)
    .map((item) => ({
      url: item.url,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      label: String(item.label || '图片'),
      source: String(item.source || 'page'),
      isCover: Boolean(item.isCover)
    }));

  if (images.length === 0) {
    throw new Error('EMPTY_IMAGES');
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const key = GALLERY_PREFIX + id;

  await chrome.storage.session.set({
    [key]: {
      id,
      bvid: String(payload.bvid || ''),
      title: String(payload.title || ''),
      pageUrl: String(payload.pageUrl || ''),
      createdAt: Date.now(),
      images
    }
  });

  await cleanupGalleries();

  await chrome.tabs.create({
    url: chrome.runtime.getURL('viewer/viewer.html') + '?id=' + encodeURIComponent(id)
  });

  return { ok: true, id };
}

/**
 * 只保留最近 MAX_GALLERIES 条结果，避免 session 配额被占满。
 */
async function cleanupGalleries() {
  let all = {};
  try {
    all = await chrome.storage.session.get(null);
  } catch (error) {
    console.info('[B站图片提取器] 读取 session 失败，跳过清理', error);
    return;
  }

  const keys = Object.keys(all).filter((key) => key.startsWith(GALLERY_PREFIX));
  if (keys.length <= MAX_GALLERIES) return;

  keys.sort((a, b) => (all[a] && all[a].createdAt ? all[a].createdAt : 0) - (all[b] && all[b].createdAt ? all[b].createdAt : 0));

  const removeKeys = keys.slice(0, keys.length - MAX_GALLERIES);
  try {
    await chrome.storage.session.remove(removeKeys);
  } catch (error) {
    console.info('[B站图片提取器] 清理 session 失败', error);
  }
}

function describeError(error) {
  if (!error) return 'UNKNOWN';
  if (typeof error === 'string') return error;
  if (error.name === 'TimeoutError') return 'TIMEOUT';
  if (error.name === 'AbortError') return 'ABORTED';
  return String(error.message || error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
