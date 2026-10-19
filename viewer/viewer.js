/**
 * B站图片提取器 - 结果页
 *
 * 读取 Service Worker 写入 chrome.storage.session 的抓取结果，
 * 渲染网格、勾选、灯箱，并把选中的图片转换为 PNG 下载。
 */

(() => {
  'use strict';

  const MAX_CANVAS = 16384;
  const DOWNLOAD_TIMEOUT_MS = 20000;
  const CONCURRENCY = 3;
  const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

  const els = {
    topbar: document.getElementById('topbar'),
    title: document.getElementById('title'),
    count: document.getElementById('count'),
    filters: document.getElementById('filters'),
    prefix: document.getElementById('prefix'),
    selectAll: document.getElementById('selectAll'),
    downloadSelected: document.getElementById('downloadSelected'),
    downloadAll: document.getElementById('downloadAll'),
    main: document.getElementById('main'),
    grid: document.getElementById('grid'),
    noMatch: document.getElementById('noMatch'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progressText'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    progressToggle: document.getElementById('progressToggle'),
    cancelDownload: document.getElementById('cancelDownload'),
    failures: document.getElementById('failures'),
    lightbox: document.getElementById('lightbox'),
    lbImage: document.getElementById('lbImage'),
    lbCounter: document.getElementById('lbCounter'),
    lbPrev: document.getElementById('lbPrev'),
    lbNext: document.getElementById('lbNext'),
    lbClose: document.getElementById('lbClose'),
    empty: document.getElementById('empty'),
    emptyText: document.getElementById('emptyText'),
    backToBili: document.getElementById('backToBili'),
    toast: document.getElementById('toast')
  };

  const state = {
    images: [],
    filter: 'all',
    downloading: false,
    cancelled: false
  };

  const pendingRevoke = new Map();
  let lightboxList = [];
  let lightboxPos = 0;
  let toastTimer = 0;
  let toastSeq = 0;
  let prefixTimer = 0;

  init();

  async function init() {
    bindEvents();
    renderSkeleton();

    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      showEmpty('缺少数据标识，请回到 B 站视频页重新获取图片。');
      return;
    }

    let record = null;
    try {
      const key = 'gallery:' + id;
      const stored = await chrome.storage.session.get(key);
      record = stored ? stored[key] || null : null;
    } catch (error) {
      console.error('[B站图片提取器] 读取数据失败', error);
      showEmpty('读取数据失败，请刷新页面重试。');
      return;
    }

    if (!record || !Array.isArray(record.images)) {
      showEmpty('数据已过期，请回到 B 站视频页重新点击「获取图片」。');
      return;
    }

    state.images = normalizeImages(record.images);
    if (state.images.length === 0) {
      showEmpty('这个页面没有找到可下载的图片。');
      return;
    }

    await applyTitle(record);
    renderGrid();
    updateSelection();
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                            */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    els.filters.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-filter]');
      if (!chip) return;
      state.filter = chip.dataset.filter;
      els.filters.querySelectorAll('.chip').forEach((node) => {
        node.classList.toggle('is-active', node === chip);
      });
      applyFilter();
    });

    els.selectAll.addEventListener('click', toggleSelectVisible);
    els.downloadSelected.addEventListener('click', () => {
      downloadImages(state.images.filter((image) => image.selected));
    });
    els.downloadAll.addEventListener('click', () => {
      if (state.images.length === 0) return;
      if (!window.confirm(`将下载全部 ${state.images.length} 张图片，继续？`)) return;
      downloadImages(state.images.slice());
    });

    els.cancelDownload.addEventListener('click', () => {
      if (!state.downloading) return;
      state.cancelled = true;
      els.cancelDownload.disabled = true;
      els.progressText.textContent = '正在取消…';
    });

    els.progressToggle.addEventListener('click', () => {
      setProgressCollapsed(!els.progress.classList.contains('is-collapsed'));
    });

    els.prefix.addEventListener('input', () => {
      clearTimeout(prefixTimer);
      prefixTimer = setTimeout(() => {
        try {
          chrome.storage.local.set({ lastPrefix: els.prefix.value });
        } catch (error) {
          // 忽略存储失败，不影响下载
        }
      }, 300);
    });

    els.lbClose.addEventListener('click', closeLightbox);
    els.lbPrev.addEventListener('click', () => moveLightbox(-1));
    els.lbNext.addEventListener('click', () => moveLightbox(1));
    els.lightbox.addEventListener('click', (event) => {
      if (event.target === els.lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (event) => {
      if (els.lightbox.hidden) return;
      if (event.key === 'Escape') closeLightbox();
      else if (event.key === 'ArrowLeft') moveLightbox(-1);
      else if (event.key === 'ArrowRight') moveLightbox(1);
    });

    els.backToBili.addEventListener('click', () => {
      if (chrome.tabs && typeof chrome.tabs.create === 'function') {
        chrome.tabs.create({ url: 'https://www.bilibili.com' });
      } else {
        location.href = 'https://www.bilibili.com';
      }
    });

    if (chrome.downloads && chrome.downloads.onChanged) {
      chrome.downloads.onChanged.addListener((delta) => {
        if (!delta || !delta.state) return;
        const entry = pendingRevoke.get(delta.id);
        if (!entry) return;

        const current = delta.state.current;
        if (current === 'complete' || current === 'interrupted') {
          if (current === 'interrupted' && entry.image) {
            setImageStatus(entry.image, 'failed', '下载被中断');
          }
          releasePending(delta.id);
        }
      });
    }

    window.addEventListener('beforeunload', () => {
      pendingRevoke.forEach((entry) => {
        try {
          URL.revokeObjectURL(entry.url);
        } catch (error) {
          // 忽略释放失败
        }
      });
      pendingRevoke.clear();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 数据与渲染                                                          */
  /* ------------------------------------------------------------------ */

  function normalizeImages(list) {
    const allowedSources = new Set(['cover', 'page-frame', 'page', 'recommend']);

    const cleaned = list
      .map((item) => {
        const source = item && allowedSources.has(item.source) ? item.source : 'page';
        return {
          url: String((item && item.url) || ''),
          width: Number(item && item.width) || 0,
          height: Number(item && item.height) || 0,
          label: String((item && item.label) || '图片'),
          source,
          isCover: Boolean(item && item.isCover),
          index: 0,
          selected: false,
          status: 'idle',
          error: '',
          el: null
        };
      })
      .filter((item) => /^https:\/\//i.test(item.url));

    // 过滤掉无效 URL 后重新编号，保证序号连续
    cleaned.forEach((item, index) => {
      item.index = index;
    });

    return cleaned;
  }

  async function applyTitle(record) {
    const title = String(record.title || '').trim() || 'B站视频图片';
    els.title.textContent = title;
    els.title.title = title;
    document.title = title + ' - B站图片提取器';
    els.count.textContent = `共 ${state.images.length} 张`;

    let savedPrefix = '';
    try {
      const stored = await chrome.storage.local.get('lastPrefix');
      savedPrefix = String((stored && stored.lastPrefix) || '');
    } catch (error) {
      savedPrefix = '';
    }

    els.prefix.value = savedPrefix || sanitizeName(title).slice(0, 30);
  }

  function renderSkeleton() {
    els.grid.innerHTML = '';
    for (let i = 0; i < 6; i += 1) {
      const card = document.createElement('div');
      card.className = 'card skeleton';
      const thumb = document.createElement('div');
      thumb.className = 'card__thumb shimmer';
      card.appendChild(thumb);
      els.grid.appendChild(card);
    }
  }

  function showEmpty(text) {
    els.topbar.hidden = true;
    els.main.hidden = true;
    els.progress.hidden = true;
    els.lightbox.hidden = true;
    els.empty.hidden = false;
    els.emptyText.textContent = text;
    document.title = 'B站图片提取器';
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    for (const image of state.images) {
      els.grid.appendChild(createCard(image));
    }
    applyFilter();
  }

  function createCard(image) {
    const card = document.createElement('article');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `预览第 ${image.index + 1} 张图片`);

    const thumb = document.createElement('div');
    thumb.className = 'card__thumb';

    const imgEl = document.createElement('img');
    imgEl.className = 'card__img';
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';
    imgEl.alt = image.label;
    imgEl.addEventListener('error', () => card.classList.add('is-broken'));

    const broken = document.createElement('span');
    broken.className = 'card__broken';
    broken.textContent = '加载失败';

    const check = document.createElement('label');
    check.className = 'card__check';
    check.addEventListener('click', (event) => event.stopPropagation());

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = image.selected;
    checkbox.setAttribute('aria-label', `选择第 ${image.index + 1} 张图片`);
    checkbox.addEventListener('change', () => {
      image.selected = checkbox.checked;
      updateSelection();
    });
    check.appendChild(checkbox);

    const source = document.createElement('span');
    source.className = 'card__source';
    if (image.isCover) {
      source.classList.add('is-cover');
      source.textContent = '封面';
    } else if (image.source === 'page-frame') {
      source.textContent = image.label || '首帧';
    } else if (image.source === 'recommend') {
      source.textContent = '推荐';
    } else {
      source.textContent = '页面图片';
    }

    const sizeEl = document.createElement('span');
    sizeEl.className = 'card__size';
    sizeEl.textContent = image.width && image.height ? `${image.width}×${image.height}` : '尺寸未知';

    imgEl.addEventListener('load', () => {
      if (imgEl.naturalWidth && imgEl.naturalHeight) {
        image.width = imgEl.naturalWidth;
        image.height = imgEl.naturalHeight;
        sizeEl.textContent = `${image.width}×${image.height}`;
      }
      card.classList.remove('is-broken');
    });

    const status = document.createElement('span');
    status.className = 'card__status';
    status.hidden = true;

    const overlay = document.createElement('div');
    overlay.className = 'card__overlay';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'card__action';
    previewBtn.textContent = '预览';
    previewBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openLightbox(image);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'card__action card__action--primary';
    downloadBtn.textContent = '下载这张';
    downloadBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadImages([image]);
    });

    overlay.appendChild(previewBtn);
    overlay.appendChild(downloadBtn);

    thumb.appendChild(imgEl);
    thumb.appendChild(broken);
    card.appendChild(thumb);
    card.appendChild(check);
    card.appendChild(source);
    card.appendChild(sizeEl);
    card.appendChild(status);
    card.appendChild(overlay);

    card.addEventListener('click', (event) => {
      if (event.target.closest('.card__check') || event.target.closest('button')) return;
      openLightbox(image);
    });

    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(image);
      }
    });

    image.el = { card, checkbox, sizeEl, status };

    // 所有监听器都绑定之后再设置 src，避免缓存图片的 load 事件被漏掉
    imgEl.src = image.url;

    return card;
  }

  function setImageStatus(image, status, error) {
    image.status = status;
    image.error = error || '';

    const el = image.el;
    if (!el) return;

    el.status.hidden = status === 'idle' || status === 'waiting';
    el.status.dataset.status = status;
    el.status.title = error || '';
    el.status.textContent = {
      waiting: '等待',
      converting: '转换中',
      success: '已下载',
      failed: '失败'
    }[status] || '';
  }

  function matchesFilter(image) {
    if (state.filter === 'cover') return image.isCover;
    if (state.filter === 'page') return image.source === 'page' || image.source === 'page-frame';
    if (state.filter === 'recommend') return image.source === 'recommend';
    return true;
  }

  function getVisibleImages() {
    return state.images.filter(matchesFilter);
  }

  function applyFilter() {
    for (const image of state.images) {
      if (image.el) image.el.card.hidden = !matchesFilter(image);
    }
    els.noMatch.hidden = getVisibleImages().length > 0;
    updateSelection();
  }

  function toggleSelectVisible() {
    const visible = getVisibleImages();
    if (visible.length === 0) return;

    const target = !visible.every((image) => image.selected);
    for (const image of visible) {
      image.selected = target;
      if (image.el) image.el.checkbox.checked = target;
    }
    updateSelection();
  }

  function updateSelection() {
    const selectedCount = state.images.filter((image) => image.selected).length;
    const visible = getVisibleImages();
    const allVisibleSelected = visible.length > 0 && visible.every((image) => image.selected);

    els.downloadSelected.textContent = `下载选中 (${selectedCount})`;
    els.downloadSelected.disabled = state.downloading || selectedCount === 0;
    els.downloadAll.disabled = state.downloading || state.images.length === 0;
    els.selectAll.textContent = allVisibleSelected ? '取消全选' : '全选';
    els.selectAll.disabled = state.downloading || visible.length === 0;
  }

  /* ------------------------------------------------------------------ */
  /* 灯箱                                                                */
  /* ------------------------------------------------------------------ */

  function openLightbox(image) {
    lightboxList = getVisibleImages();
    const pos = lightboxList.findIndex((item) => item.index === image.index);
    if (pos < 0) return;

    lightboxPos = pos;
    els.lightbox.hidden = false;
    document.body.classList.add('no-scroll');
    updateLightbox();
  }

  function updateLightbox() {
    const image = lightboxList[lightboxPos];
    if (!image) return;

    els.lbImage.src = image.url;
    els.lbImage.alt = image.label || '图片';
    els.lbCounter.textContent = `${lightboxPos + 1} / ${lightboxList.length}`;

    const single = lightboxList.length <= 1;
    els.lbPrev.disabled = single;
    els.lbNext.disabled = single;
  }

  function moveLightbox(step) {
    if (lightboxList.length <= 1) return;
    lightboxPos = (lightboxPos + step + lightboxList.length) % lightboxList.length;
    updateLightbox();
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lbImage.removeAttribute('src');
    document.body.classList.remove('no-scroll');
  }

  /* ------------------------------------------------------------------ */
  /* 下载队列                                                            */
  /* ------------------------------------------------------------------ */

  async function downloadImages(list) {
    if (state.downloading) return;

    const targets = list.filter(Boolean);
    if (targets.length === 0) return;

    state.downloading = true;
    state.cancelled = false;
    els.cancelDownload.disabled = false;
    els.failures.hidden = true;
    els.failures.innerHTML = '';
    els.progress.hidden = false;
    setProgressCollapsed(false);

    const total = targets.length;
    let cursor = 0;
    let processed = 0;
    let success = 0;
    const failed = [];

    for (const image of targets) setImageStatus(image, 'idle');
    updateProgress(0, total, '准备中');
    updateSelection();

    const worker = async () => {
      while (!state.cancelled) {
        const queueIndex = cursor;
        cursor += 1;
        if (queueIndex >= total) return;

        const image = targets[queueIndex];
        setImageStatus(image, 'converting');
        updateProgress(processed, total, state.cancelled ? '正在取消' : '正在处理');

        try {
          const pngBlob = await withRetry(() => toPngBlob(image.url), 1);
          if (state.cancelled) {
            setImageStatus(image, 'idle');
            return;
          }
          await saveBlob(pngBlob, buildFileName(image, queueIndex), image);
          setImageStatus(image, 'success');
          success += 1;
        } catch (error) {
          if (state.cancelled) {
            setImageStatus(image, 'idle');
            return;
          }
          const reason = describeError(error);
          console.error('[B站图片提取器] 下载失败', image.url, error);
          setImageStatus(image, 'failed', reason);
          failed.push({ image, reason });
        } finally {
          processed += 1;
          updateProgress(
            processed,
            total,
            state.cancelled ? '正在取消' : '正在处理',
            failed.length
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
    );

    const wasCancelled = state.cancelled;
    state.downloading = false;
    state.cancelled = false;

    let summary;
    if (total > 0 && failed.length === total) {
      summary = `全部失败：${failed.length} / ${total} 张`;
    } else if (wasCancelled) {
      summary = `已取消，完成 ${processed} / ${total}，成功 ${success} 张`;
    } else {
      summary = `完成 ${processed} / ${total}，成功 ${success} 张，失败 ${failed.length} 张`;
    }

    els.progressText.textContent = summary;
    els.progressFill.style.width = `${total > 0 ? Math.round((processed / total) * 100) : 0}%`;
    els.progressBar.setAttribute('aria-valuenow', String(total > 0 ? Math.round((processed / total) * 100) : 0));

    if (failed.length > 0) {
      renderFailures(failed);
      showToast(`有 ${failed.length} 张图片下载失败`);
    } else if (processed > 0 && !wasCancelled) {
      showToast(`已完成 ${processed} 张图片的下载`);
    }

    updateSelection();
  }

  function updateProgress(done, total, label, failedCount) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.width = `${percent}%`;
    els.progressBar.setAttribute('aria-valuenow', String(percent));

    let text = `${label || '正在处理'} ${done} / ${total}`;
    if (failedCount) text += ` · 失败 ${failedCount}`;
    els.progressText.textContent = text;
  }

  /** 折叠 / 展开进度面板，折叠后只保留标题行。 */
  function setProgressCollapsed(collapsed) {
    els.progress.classList.toggle('is-collapsed', collapsed);
    els.progressToggle.textContent = collapsed ? '展开' : '收起';
    els.progressToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function renderFailures(failed) {
    els.failures.hidden = false;
    els.failures.innerHTML = '';
    setProgressCollapsed(false);

    const title = document.createElement('div');
    title.className = 'failures__title';
    title.textContent = `失败 ${failed.length} 张`;

    const list = document.createElement('ul');
    for (const item of failed) {
      const li = document.createElement('li');
      li.textContent = `${item.image.label || '图片'}：${item.reason}`;
      list.appendChild(li);
    }

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--ghost btn--small';
    retry.textContent = '重试失败项';
    retry.addEventListener('click', () => {
      els.failures.hidden = true;
      downloadImages(failed.map((item) => item.image));
    });

    els.failures.appendChild(title);
    els.failures.appendChild(list);
    els.failures.appendChild(retry);
  }

  /* ------------------------------------------------------------------ */
  /* PNG 转换                                                            */
  /* ------------------------------------------------------------------ */

  async function toPngBlob(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        referrer: 'https://www.bilibili.com/',
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('空响应');

      return await decodeToPng(blob);
    } finally {
      clearTimeout(timer);
    }
  }

  async function decodeToPng(blob) {
    // 源本来就是 PNG：直接保存，避免无谓重编码
    if (blob.type === 'image/png' && (await isPngMagic(blob))) return blob;

    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

        if (bitmap.width > MAX_CANVAS || bitmap.height > MAX_CANVAS) {
          throw new Error('图片尺寸超出浏览器画布上限');
        }

        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布上下文');

        ctx.drawImage(bitmap, 0, 0);
        return await canvas.convertToBlob({ type: 'image/png' });
      } catch (error) {
        // 尺寸超限时 <img> 方案同样会失败，直接抛出
        if (String((error && error.message) || '').includes('画布上限')) throw error;
        console.info('[B站图片提取器] createImageBitmap 失败，回退 <img> 方案', error);
      } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      }
    }

    return decodeViaImg(blob);
  }

  function decodeViaImg(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('无法创建画布上下文');

          ctx.drawImage(img, 0, 0);
          canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(objectUrl);
            if (pngBlob) resolve(pngBlob);
            else reject(new Error('PNG 编码失败'));
          }, 'image/png');
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('图片解码失败'));
      };

      img.src = objectUrl;
    });
  }

  async function isPngMagic(blob) {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => head[index] === byte);
  }

  /* ------------------------------------------------------------------ */
  /* 保存                                                                */
  /* ------------------------------------------------------------------ */

  async function saveBlob(blob, filename, image) {
    const blobUrl = URL.createObjectURL(blob);

    if (!chrome.downloads || typeof chrome.downloads.download !== 'function') {
      fallbackAnchorDownload(blobUrl, filename);
      showToast('浏览器下载接口不可用，已改用普通下载');
      setTimeout(() => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (error) {
          // 忽略
        }
      }, 60000);
      return;
    }

    let downloadId;
    try {
      downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      });
    } catch (error) {
      URL.revokeObjectURL(blobUrl);
      throw error;
    }

    if (typeof downloadId !== 'number') {
      URL.revokeObjectURL(blobUrl);
      throw new Error('下载未开始');
    }

    // 等下载状态结束后再释放 Blob URL，否则文件可能为空或损坏
    pendingRevoke.set(downloadId, { url: blobUrl, image });
    setTimeout(() => releasePending(downloadId), 5 * 60 * 1000);
  }

  function releasePending(downloadId) {
    const entry = pendingRevoke.get(downloadId);
    if (!entry) return;

    pendingRevoke.delete(downloadId);
    try {
      URL.revokeObjectURL(entry.url);
    } catch (error) {
      // 忽略释放失败
    }
  }

  function fallbackAnchorDownload(url, filename) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  /* ------------------------------------------------------------------ */
  /* 工具函数                                                            */
  /* ------------------------------------------------------------------ */

  function buildFileName(image, queueIndex) {
    const prefix = sanitizeName(els.prefix.value || 'bilibili').slice(0, 30);
    const sequence = String(queueIndex + 1).padStart(2, '0');

    let tag = '图片';
    if (image.isCover) tag = '封面';
    else if (image.source === 'page-frame') tag = image.label || '首帧';
    else if (image.source === 'recommend') tag = '推荐';

    tag = sanitizeName(tag).slice(0, 20);
    return `${prefix}-${sequence}-${tag}.png`;
  }

  function sanitizeName(input) {
    let value = String(input == null ? '' : input);

    // Windows 非法字符与控制字符
    value = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ');
    value = value.replace(/\s+/g, ' ').trim();
    value = value.replace(/[. ]+$/g, '');

    if (!value) value = 'bilibili';
    if (RESERVED_NAMES.test(value)) value = '_' + value;

    return value;
  }

  async function withRetry(fn, retries) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const message = String((error && error.message) || '');
        // 4xx 重试没有意义（404 / 403 / 防盗链）
        if (/^HTTP 4\d\d/.test(message)) break;
        if (attempt < retries) await sleep(400);
      }
    }

    throw lastError;
  }

  function describeError(error) {
    if (!error) return '未知错误';

    if (error.name === 'AbortError') return '请求超时';

    const message = String(error.message || error);
    if (message === 'HTTP 403') return '403，可能被防盗链拦截';
    if (message === 'HTTP 404') return '404，原图不存在';
    if (message.startsWith('HTTP ')) return message;

    return message.length > 80 ? message.slice(0, 80) + '…' : message;
  }

  function showToast(text) {
    const seq = ++toastSeq;
    clearTimeout(toastTimer);
    els.toast.hidden = false;
    els.toast.textContent = text;
    els.toast.classList.add('is-show');

    toastTimer = setTimeout(() => {
      if (seq !== toastSeq) return;
      els.toast.classList.remove('is-show');
      setTimeout(() => {
        if (seq === toastSeq) els.toast.hidden = true;
      }, 220);
    }, 2500);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
