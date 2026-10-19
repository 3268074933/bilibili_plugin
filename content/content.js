/**
 * B站图片提取器 - 内容脚本
 *
 * 在 B 站视频页右下角挂一个「获取图片」按钮：
 * 1. 读取视频元信息（由 Service Worker 代理接口）；
 * 2. 抓取视频封面、分 P 首帧与页面大图；
 * 3. 去重、排序后交给 Service Worker 打开结果页。
 *
 * 注意：内容脚本运行在隔离世界，跨域请求一律交给 Service Worker。
 */

(() => {
  'use strict';

  // 脚本入口幂等：同一个页面被注入两次时直接退出。
  if (window.__biliImagePickerLoaded) return;
  window.__biliImagePickerLoaded = true;

  const HOST_ID = 'bili-image-picker-root';
  const BUTTON_TEXT = '获取图片';
  const MIN_W = 400;
  const MIN_H = 200;
  const CDN_HOSTS = ['hdslb.com', 'biliimg.com', 'bilivideo.com'];

  const ICON_IMAGE = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <path d="m21 15-5-5L5 21"></path>
    </svg>`;

  const ICON_SPINNER = `
    <svg class="bip-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.3"></circle>
      <path d="M21 12a9 9 0 0 0-9-9"></path>
    </svg>`;

  // 全部样式挂在 Shadow DOM 内，避免污染 B 站页面，也避免被 B 站样式覆盖。
  const CSS_TEXT = `
    :host {
      all: initial;
    }
    .bip-wrap {
      position: relative;
      display: inline-flex;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .bip-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      height: 44px;
      padding: 0 18px;
      border: 0;
      border-radius: 22px;
      background: linear-gradient(135deg, #fb7299 0%, #fc9bb3 100%);
      color: #ffffff;
      font: 600 14px/1 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.02em;
      box-shadow: 0 6px 18px rgba(251, 114, 153, 0.35);
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
    }
    .bip-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 24px rgba(251, 114, 153, 0.45);
    }
    .bip-btn:active:not(:disabled) {
      transform: scale(0.96);
    }
    .bip-btn:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
      box-shadow: 0 0 0 4px rgba(251, 114, 153, 0.6);
    }
    .bip-btn:disabled {
      cursor: progress;
      opacity: 0.92;
    }
    .bip-icon {
      display: inline-flex;
      width: 16px;
      height: 16px;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .bip-icon svg {
      display: block;
      width: 16px;
      height: 16px;
    }
    .bip-spinner {
      animation: bip-spin 800ms linear infinite;
      transform-origin: 50% 50%;
    }
    @keyframes bip-spin {
      to { transform: rotate(360deg); }
    }
    .bip-label {
      white-space: nowrap;
    }
    .bip-toast {
      position: absolute;
      right: 0;
      bottom: 56px;
      box-sizing: border-box;
      max-width: 280px;
      padding: 8px 12px;
      border-radius: 10px;
      background: rgba(24, 25, 28, 0.92);
      color: #ffffff;
      font: 400 13px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 180ms ease, transform 180ms ease;
      pointer-events: none;
      word-break: break-word;
    }
    .bip-toast.is-show {
      opacity: 1;
      transform: translateY(0);
    }
    @media (prefers-reduced-motion: reduce) {
      .bip-btn { transition: none; }
      .bip-toast { transition: none; }
      .bip-spinner { animation-duration: 2.4s; }
    }
  `;

  let ui = null;
  let state = 'idle';
  let doneTimer = 0;
  let toastTimer = 0;
  let lastHref = location.href;
  let started = false;

  /** 只处理 B 站视频页，且路径里必须能取到 BV 号。 */
  function getBvid() {
    const match = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)/);
    return match ? match[1] : '';
  }

  function isVideoPage() {
    return Boolean(getBvid());
  }

  /** 创建宿主节点、Shadow DOM 与内部 UI。 */
  function mount() {
    if (!isVideoPage()) return;
    if (document.getElementById(HOST_ID)) return;
    if (!document.body) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'right: 24px',
      'bottom: 24px',
      'z-index: 2147483000'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'open' });
    applyStyles(shadow);

    const wrap = document.createElement('div');
    wrap.className = 'bip-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bip-btn';
    btn.title = BUTTON_TEXT;
    btn.setAttribute('aria-label', BUTTON_TEXT);

    const icon = document.createElement('span');
    icon.className = 'bip-icon';
    icon.innerHTML = ICON_IMAGE;

    const label = document.createElement('span');
    label.className = 'bip-label';
    label.setAttribute('aria-live', 'polite');
    label.textContent = BUTTON_TEXT;

    btn.appendChild(icon);
    btn.appendChild(label);

    const toast = document.createElement('div');
    toast.className = 'bip-toast';
    toast.setAttribute('role', 'status');

    wrap.appendChild(btn);
    wrap.appendChild(toast);
    shadow.appendChild(wrap);
    document.body.appendChild(host);

    ui = { host, shadow, btn, icon, label, toast };
    state = 'idle';

    btn.addEventListener('click', handleClick);
  }

  /** 优先用 constructed stylesheet，失败时退回 <style>。 */
  function applyStyles(shadow) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      shadow.adoptedStyleSheets = [sheet];
      return;
    } catch (error) {
      console.info('[B站图片提取器] constructed stylesheet 不可用，回退 <style>', error);
    }

    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    shadow.appendChild(style);
  }

  function unmount() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
    ui = null;
    state = 'idle';
    clearTimeout(doneTimer);
  }

  /** 按钮状态机：idle / scanning / done / error。 */
  function setState(next, count) {
    state = next;
    if (!ui) return;

    clearTimeout(doneTimer);

    if (next === 'scanning') {
      ui.btn.disabled = true;
      ui.btn.setAttribute('aria-busy', 'true');
      ui.icon.innerHTML = ICON_SPINNER;
      ui.label.textContent = '正在获取…';
      return;
    }

    ui.btn.disabled = false;
    ui.btn.removeAttribute('aria-busy');
    ui.icon.innerHTML = ICON_IMAGE;

    if (next === 'done') {
      ui.btn.disabled = true;
      ui.label.textContent = `已获取 ${count} 张`;
      doneTimer = setTimeout(() => {
        if (state === 'done') setState('idle');
      }, 1600);
      return;
    }

    ui.label.textContent = BUTTON_TEXT;
  }

  function showToast(text) {
    if (!ui) return;
    clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.classList.add('is-show');
    toastTimer = setTimeout(() => {
      if (ui) ui.toast.classList.remove('is-show');
    }, 2500);
  }

  /** 点击主流程。 */
  async function handleClick() {
    if (state === 'scanning') return;

    const bvid = getBvid();
    if (!bvid) {
      showToast('请先打开一个 B 站视频页');
      return;
    }

    setState('scanning');

    try {
      const meta = await requestVideoMeta(bvid);
      const gallery = collectGallery(meta, bvid);

      if (gallery.images.length === 0) {
        showToast('没有找到可下载的图片');
        setState('idle');
        return;
      }

      // 抓取期间用户可能已经切换到别的视频，避免把旧结果带到新页面
      if (getBvid() !== bvid) {
        setState('idle');
        return;
      }

      const result = await chrome.runtime.sendMessage({
        type: 'OPEN_GALLERY',
        payload: gallery
      });

      if (!result || !result.ok) {
        throw new Error((result && result.error) || 'OPEN_GALLERY_FAILED');
      }

      setState('done', gallery.images.length);
    } catch (error) {
      console.error('[B站图片提取器] 获取失败', error);
      const message = String((error && error.message) || '');
      showToast(
        message.includes('Extension context invalidated')
          ? '扩展已更新，请刷新页面后重试'
          : '获取失败，请刷新页面后重试'
      );
      setState('idle');
    }
  }

  /** 由 Service Worker 请求接口，失败返回 null 走 DOM 降级。 */
  async function requestVideoMeta(bvid) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'FETCH_VIDEO_META',
        bvid
      });
      return result && result.ok ? result : null;
    } catch (error) {
      console.info('[B站图片提取器] 元信息接口不可用，使用页面数据', error);
      return null;
    }
  }

  /** 汇总封面、分 P 首帧与页面大图，统一规范化、去重、排序。 */
  function collectGallery(meta, bvid) {
    const title = buildTitle(meta);
    const coverCandidates = [];

    if (meta && meta.cover) coverCandidates.push(meta.cover);

    for (const selector of ['meta[itemprop="image"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const node = document.querySelector(selector);
      if (node && node.content) coverCandidates.push(node.content);
    }

    const video = document.querySelector('video[poster]');
    if (video && video.poster) coverCandidates.push(video.poster);

    const coverUrl = coverCandidates
      .map(normalizeImageUrl)
      .find((url) => url && isCdnHost(url)) || '';

    const seen = new Map();

    function add(rawUrl, options) {
      const opts = options || {};
      const url = normalizeImageUrl(rawUrl);
      if (!url || !isCdnHost(url)) return;

      const isCover = Boolean(coverUrl && url === coverUrl) || Boolean(opts.isCover);
      const existing = seen.get(url);

      if (existing) {
        if (isCover) {
          existing.isCover = true;
          existing.label = '封面';
          existing.source = 'cover';
        }
        // 同一张图以最大尺寸为准
        const area = (Number(opts.width) || 0) * (Number(opts.height) || 0);
        if (area > existing.width * existing.height) {
          existing.width = Number(opts.width) || existing.width;
          existing.height = Number(opts.height) || existing.height;
        }
        return;
      }

      seen.set(url, {
        url,
        width: Number(opts.width) || 0,
        height: Number(opts.height) || 0,
        label: isCover ? '封面' : String(opts.label || '页面图片'),
        source: isCover ? 'cover' : String(opts.source || 'page'),
        isCover,
        order: Number(opts.order) || 0
      });
    }

    // 分 P 首帧
    if (meta && Array.isArray(meta.pages)) {
      meta.pages.forEach((page) => {
        if (!page.firstFrame) return;
        add(page.firstFrame, {
          label: `P${page.page} 首帧`,
          source: 'page-frame',
          order: page.page
        });
      });
    }

    // 页面大图
    scanDomImages().forEach((item) => add(item.url, item));

    // 封面可能没有出现在 DOM 里，补一条
    if (coverUrl) {
      add(coverUrl, { label: '封面', source: 'cover', isCover: true });
    }

    const images = Array.from(seen.values()).sort((a, b) => {
      if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;

      const aFrame = a.source === 'page-frame';
      const bFrame = b.source === 'page-frame';
      if (aFrame !== bFrame) return aFrame ? -1 : 1;
      if (aFrame && bFrame) return a.order - b.order;

      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      if (areaA !== areaB) return areaB - areaA;
      return a.url.localeCompare(b.url);
    });

    return {
      bvid,
      title,
      pageUrl: location.href,
      images
    };
  }

  function buildTitle(meta) {
    if (meta && meta.title) return String(meta.title);

    const raw = String(document.title || '').trim();
    const cleaned = raw
      .replace(/_哔哩哔哩.*$/, '')
      .replace(/-哔哩哔哩.*$/, '')
      .trim();

    return cleaned || 'bilibili';
  }

  /** 扫描当前 DOM 中的大图。 */
  function scanDomImages() {
    const items = [];

    for (const img of document.images) {
      if (!img) continue;

      const rect = img.getBoundingClientRect();
      // 1px 占位图视为未加载，退回布局尺寸
      const naturalW = img.naturalWidth > 2 ? img.naturalWidth : 0;
      const naturalH = img.naturalHeight > 2 ? img.naturalHeight : 0;
      const width = naturalW || Math.round(rect.width);
      const height = naturalH || Math.round(rect.height);

      if (width < MIN_W || height < MIN_H) continue;
      if (height > 0 && width / height > 8) continue;
      if (img.closest('[class*="avatar"], [class*="face"], [class*="emoji"], [class*="icon"]')) continue;

      const loaded = img.naturalWidth > 2;
      let url = loaded ? (img.currentSrc || img.src) : '';
      if (!url) url = img.dataset.src || img.dataset.original || '';
      // srcset 优先于 data:/占位图 src，避免拿到 1px 占位图
      if (!url && img.srcset) url = largestFromSrcset(img.srcset);
      if (!url) url = img.currentSrc || img.src || '';
      if (!url) continue;

      const recommend = Boolean(
        img.closest('[class*="recommend"], [class*="video-card"], [class*="video-page-card"]')
      );

      items.push({
        url,
        width,
        height,
        label: recommend ? '推荐' : '页面图片',
        source: recommend ? 'recommend' : 'page'
      });
    }

    return items;
  }

  /** srcset 形如 "a.jpg 320w, b.jpg 640w"，按宽度描述符取最大。 */
  function largestFromSrcset(srcset) {
    const list = String(srcset || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(/\s+/);
        const url = parts[0] || '';
        const descriptor = parts[1] || '';
        const width = /^\d+w$/.test(descriptor) ? parseInt(descriptor, 10) : 0;
        return { url, width };
      });

    list.sort((a, b) => b.width - a.width);
    return list.length > 0 ? list[0].url : '';
  }

  /** 补全协议、剥离 B 站 CDN 的缩放/格式后缀。 */
  function normalizeImageUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';

    let url = raw.trim();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension:')) return '';

    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (url.startsWith('http://')) {
      url = 'https://' + url.slice(7);
    } else if (!/^https:\/\//i.test(url)) {
      return '';
    }

    url = url.replace(/@[^/]*$/, '').replace(/#.*$/, '');
    return url;
  }

  /** 只接受 B 站图片 CDN 的域名，用后缀匹配避免相似域名绕过。 */
  function isCdnHost(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return CDN_HOSTS.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
    } catch (error) {
      return false;
    }
  }

  /** 全屏元素之外的节点不渲染，全屏时把按钮搬进去。 */
  function handleFullscreenChange() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;

    const fullscreenElement = document.fullscreenElement;

    if (fullscreenElement) {
      if (
        fullscreenElement instanceof HTMLElement &&
        fullscreenElement.tagName !== 'VIDEO' &&
        host.parentElement !== fullscreenElement
      ) {
        fullscreenElement.appendChild(host);
        host.style.bottom = '96px';
      }
      return;
    }

    if (host.parentElement !== document.body) {
      document.body.appendChild(host);
    }
    host.style.bottom = '24px';
  }

  /** 每秒检查：URL 变了要重挂，节点被页面重绘删掉也要重挂。 */
  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
    }

    if (!isVideoPage()) {
      if (document.getElementById(HOST_ID)) unmount();
      return;
    }

    if (!document.getElementById(HOST_ID)) mount();
  }

  let observer = null;
  let observerTimer = 0;

  function startObserver() {
    if (observer || !document.body) return;

    observer = new MutationObserver(() => {
      if (observerTimer) return;
      observerTimer = setTimeout(() => {
        observerTimer = 0;
        tick();
      }, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (started) return;
    if (!document.body) {
      setTimeout(boot, 300);
      return;
    }

    started = true;
    tick();
    startObserver();
    setInterval(tick, 1000);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  }

  boot();
})();
