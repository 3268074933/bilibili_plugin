# B 站视频封面 / 图片提取下载插件 —— AI 编程提示词

> 用法：把本文件全文作为一次任务发给 AI 编程助手（Cursor、Claude Code、Copilot Agent 等），可直接产出可加载到 Edge 的完整扩展。
> 目标产物：Manifest V3 扩展。B 站视频页右下角常驻「获取图片」按钮；点击后抓取当前视频封面与页面大图；在新标签页网格展示；勾选后下载为 PNG。
> 版本：1.0

---

## 零、角色设定

你现在同时扮演两个角色：

1. **资深浏览器扩展工程师**：精通 Chromium / Edge 的 Manifest V3，熟悉内容脚本的运行环境隔离、Shadow DOM 样式隔离、Service Worker 生命周期、`chrome.storage`、`chrome.downloads`、`chrome.tabs`、`declarativeNetRequest`、扩展页面的 CSP 限制。
2. **注重细节的前端工程师**：能做出视觉精致、交互顺滑、状态完整（加载 / 空 / 失败 / 成功）的界面，关注暗色模式、可访问性、按钮反馈与文案。

### 你的工作方式

1. 先复述你对需求的理解（不超过 10 行），确认抓取目标、页面范围、下载格式。
2. 给出完整文件树。
3. 逐个文件输出**完整代码**，每个文件单独标注路径。禁止出现「此处省略」「其余同上」「省略若干行」。
4. 最后输出自测步骤与已知取舍。

### 你的硬性约束

- 只用原生 HTML / CSS / JavaScript（ES2020+）。不引入 React、Vue、Vite、Webpack、npm 依赖；不使用任何远程 CDN 脚本（Manifest V3 禁止远程代码，违反会导致扩展被拒或无法加载）。
- 所有文件必须完整、可直接运行、可完全离线工作。
- 不收集、不上传任何用户数据；不申请与功能无关的权限。
- 界面文案与代码注释全部使用中文。
- 规格没有写死的细节，选最简单可靠的实现，并在注释里写明取舍。
- 不确定的 API 行为不要凭记忆编造：优先用保守写法（特性检测 + 降级），并在注释里标注降级路径。

---

## 一、项目目标

### 1.1 一句话目标

在 B 站视频页右下角提供一个「获取图片」按钮，点击后提取**当前视频的封面**与**页面中的大图**，在扩展内新标签页里以网格展示，允许用户勾选任意图片并全部下载为 PNG。

### 1.2 用户流程

1. 用户打开任意 B 站视频页（形如 `https://www.bilibili.com/video/BV1xx411c7xx/`）。
2. 页面右下角出现悬浮按钮「获取图片」。
3. 点击后按钮进入「正在获取…」状态，同时完成：读取视频元信息、抓取封面、扫描页面大图、去重排序。
4. 抓取完成，扩展自动打开新标签页展示图片网格；按钮回到「获取图片」。
5. 用户勾选图片（可全选），点击「下载选中」或「下载全部」。
6. 图片被逐张转换并下载为真正的 PNG 文件，界面显示进度与结果。

### 1.3 非目标（明确不要做）

- **不做视频抽帧**：本插件提取的是视频封面图与页面上的静态图片，不是从视频流里截取画面。
- **不做批量爬取**：只处理当前打开的这一个视频页，不遍历 UP 主投稿、不遍历分页。
- **不做跨站通用抓图**：不匹配淘宝、京东、拼多多等电商站点，也不默认匹配 B 站以外的所有网站。
- **不做账号相关功能**：不登录、不读取 Cookie、不调用需要登录态的接口、不下载视频文件与音频。
- **不上传任何数据**：不向自建服务器发送图片、URL、视频标题。

---

## 二、技术栈与运行环境

| 项 | 要求 |
|---|---|
| 扩展标准 | Manifest V3 |
| 目标浏览器 | Microsoft Edge（Chromium 内核），同时兼容 Chrome |
| 最低版本 | `minimum_chrome_version: "109"`（需要 `OffscreenCanvas`、`createImageBitmap`、`AbortSignal.timeout`） |
| 语言 | 原生 JavaScript（ES2020+），`"type": "module"` 的 Service Worker |
| 构建 | 无构建步骤，源码即产物 |
| 依赖 | 零第三方依赖，零网络 CDN 资源 |
| 存储 | `chrome.storage.session` 传递抓取结果，`chrome.storage.local` 保存用户偏好 |
| 下载 | `chrome.downloads.download` + `Blob URL`，统一输出 PNG |
| 样式隔离 | 内容脚本使用 Shadow DOM；扩展页使用独立 CSS |

### 2.1 设计取向（参考）

整体工程做法参考「右下角常驻悬浮挂件」类项目（例如 DeepSeek 余额小鲸鱼挂件）的成熟经验：

- 原生 JS 单文件注入，无构建、无依赖，改动即可生效；
- `window` 标记 + DOM id 双重幂等，SPA 换页不产生重复节点；
- Shadow DOM 隔离宿主页面样式，内部样式用 constructed stylesheet；
- 右下角悬浮、状态机驱动文案、配置持久化、失败降级；
- 把踩坑结论写进代码注释与 README，方便后续维护。

不要照搬其 DSH 插件架构（那是宿主专用方案），本项目的宿主是标准 Manifest V3 扩展。

---

## 三、目录结构（严格按此输出）

```text
shoping_plugin/
├── manifest.json
├── background/
│   └── service-worker.js        # 消息路由、元信息请求、写 session、开新标签页
├── content/
│   ├── content.js               # 挂载按钮、扫描与抓取、SPA 兼容
│   └── content.css              # 注入 Shadow DOM 的按钮样式（也可用 constructed stylesheet 内联）
├── viewer/
│   ├── viewer.html              # 新标签页：网格、勾选、下载
│   ├── viewer.css
│   └── viewer.js                # 读取数据、PNG 转换、下载队列、灯箱
├── icons/                       # 可选：扩展图标（见 4.3 的说明）
└── README.md                    # 安装与使用说明
```

说明：`content/content.css` 如果选择用 `adoptedStyleSheets` 内联，可以不要这个文件，但要在文件树与说明里保持一致，不能出现「文件树里有、正文没输出」的情况。

---

## 四、manifest.json

### 4.1 字段要求

- `manifest_version: 3`。
- `permissions` 只申请：`["storage", "downloads"]`。
  - `chrome.tabs.create` **不需要** `tabs` 权限，不要多申请。
  - 若确实要用 `chrome.tabs.query` 读取标签页 URL 才需要 `tabs`，本方案不用。
- `host_permissions` 限定为 B 站与图片 CDN：`https://*.bilibili.com/*`、`https://*.hdslb.com/*`、`https://*.biliimg.com/*`、`https://*.bilivideo.com/*`。
- `content_scripts.matches` 只匹配 `https://www.bilibili.com/video/*`，`all_frames: false`，`run_at: "document_idle"`。
- `background.service_worker` 指向 `background/service-worker.js`。
- `action` 只设置 `default_title`，点击工具栏图标不要弹窗（避免多一个入口造成状态不一致）。
- 扩展页面默认 CSP 禁止内联脚本：`viewer.html` 只能外链 `viewer.js`，不得写 `onclick` 等内联事件。

### 4.2 参考骨架

```json
{
  "manifest_version": 3,
  "name": "B站图片提取器",
  "version": "1.0.0",
  "description": "从 B 站视频页提取视频封面与页面大图，勾选后下载为 PNG。",
  "minimum_chrome_version": "109",
  "permissions": ["storage", "downloads"],
  "host_permissions": [
    "https://*.bilibili.com/*",
    "https://*.hdslb.com/*",
    "https://*.biliimg.com/*",
    "https://*.bilivideo.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.bilibili.com/video/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "action": {
    "default_title": "B站图片提取器"
  }
}
```

### 4.3 图标说明

AI 通常无法直接产出二进制 PNG 图标。处理方式：

- 优先**省略** `icons` 与 `action.default_icon` 字段，扩展仍可正常加载，浏览器显示默认图标。
- 不要为了让图标存在而写一个假的 `.png` 文件（内容不是 PNG 会导致加载失败）。
- `README.md` 里写清楚：如需自定义图标，自行放入 `icons/icon16.png`、`32`、`48`、`128` 并在 `manifest.json` 中补齐字段。
- 页面内按钮图标一律用**内联 SVG**，不用图片文件。

---

## 五、内容脚本：右下角悬浮按钮

### 5.1 挂载与样式隔离

- 宿主元素 id 固定为 `bili-image-picker-root`。
- 幂等判断分两层，职责不同，不要混用：
  1. **脚本入口**（模块顶层）判断 `window.__biliImagePickerLoaded`，命中则整段脚本直接 return，防止同一个页面被注入两次；
  2. **`mount()` 内部**只判断 `document.getElementById('bili-image-picker-root')`，命中则 return。
  定时器与 MutationObserver 触发的重挂必须调用 `mount()`，不能因为第 1 层的 window 标记而跳过。
- 宿主元素设置 `position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;`，并用 `attachShadow({ mode: 'open' })` 承载内部 UI，彻底隔离 B 站的全局 CSS。
- 宿主元素本身写 `all: initial;` 再覆盖定位属性，防止继承 B 站的 `font-family`、`line-height`、`color` 等。
- 样式注入优先用 `new CSSStyleSheet()` + `shadow.adoptedStyleSheets`；若构造样式表失败，回退到 shadow 内插入 `<style>`。两条路径必须都实现。

### 5.2 视觉规格

- 尺寸：高度 44px，左右内边距 18px，圆角 22px（胶囊）。
- 配色：背景 `linear-gradient(135deg, #fb7299 0%, #fc9bb3 100%)`，文字 `#ffffff`，B 站粉作为主色。
- 字体：`system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`，字号 14px，字重 600。
- 阴影：`0 6px 18px rgba(251, 114, 153, 0.35)`。
- 内容：左侧 16×16 内联 SVG 图标（向下箭头落入托盘或图片堆叠图形），右侧文字「获取图片」，间距 8px。
- 交互：
  - hover：`translateY(-2px)`，阴影加深，180ms 过渡；
  - active：`scale(0.96)`；
  - `:focus-visible`：2px 白色内描边 + 2px 粉色外描边，保证键盘可见；
  - `prefers-reduced-motion: reduce` 时关闭位移与旋转动画。
- 按钮始终显式设置文字与背景色，不依赖 `color-scheme` 继承，B 站暗色模式下也必须清晰可读。

### 5.3 状态机

只允许四个状态，禁止并发点击：

| 状态 | 按钮文字 | 行为 |
|---|---|---|
| `idle` | 获取图片 | 可点击 |
| `scanning` | 正在获取… | `disabled`，左侧图标换成旋转动画（`aria-busy="true"`） |
| `done` | 已获取 N 张 | 只显示 1.6 秒，然后自动回到 `idle`；期间不可点击 |
| `error` | 获取图片 | 与 `idle` 相同，仅额外弹一次轻提示 |

- 点击处理函数开头必须判断 `state === 'scanning'` 并直接 return。
- 抓取失败或结果为空时，必须回到 `idle`，不能卡在 `scanning`。
- 整个点击流程用 `try/catch/finally` 包裹，`finally` 里恢复状态。

### 5.4 轻提示（不弹 alert）

- 在 shadow 内部创建一个提示条，位于按钮上方 12px，圆角 10px，深色半透明背景（`rgba(24, 25, 28, 0.92)`），白字 13px，最多两行。
- 显示 2.5 秒后淡出移除；同一时间只保留一条。
- 失败文案示例：「没有找到可下载的图片」「获取失败，请刷新页面后重试」「请先打开一个 B 站视频页」。

### 5.5 SPA 与页面重绘兼容

B 站是单页应用，切换视频时 URL 变化但页面不整页刷新；播放器与推荐区也会重绘并移除外部节点。

- 每 1000ms 检查一次 `location.href`：
  - URL 变化 → 更新 `lastHref`，必要时重新挂载；
  - URL 未变但宿主节点不存在 → 重新挂载。
- 额外用 `MutationObserver` 观察 `document.body` 的 `childList`（`subtree: true`），节流 500ms，只在宿主节点丢失时重挂。
- 只处理 `https://www.bilibili.com/video/*` 且路径能匹配出 BV 号；非视频页直接不挂载。
- 页面卸载时不需要手动清理定时器（整页销毁），但 SPA 换页时不能累积新的定时器：定时器与 observer 必须在模块顶层只创建一次。

### 5.6 全屏播放器处理

处于全屏的元素之外的节点不会被渲染，因此全屏时按钮会消失。

- 监听 `fullscreenchange`：进入全屏时，把宿主节点 `appendChild` 到 `document.fullscreenElement` 内；退出全屏时移回 `document.body`。
- 全屏元素可能是 `<video>` 本身（无法插入子节点）。先判断 `fullscreenElement instanceof HTMLElement && fullscreenElement.tagName !== 'VIDEO'`；不满足时保持原位（此时按钮不可见，但不要报错）。
- 全屏时按钮位置改为 `right: 24px; bottom: 96px`，避免压住播放器控制条。
- 移动节点后要重新确保 `z-index` 生效（`position: fixed` 在 fullscreen 元素内仍然相对视口定位）。

### 5.7 可选增强（第二阶段，可做可不做，不要影响主流程）

- 按钮可拖拽：`pointerdown` + `setPointerCapture`，位移小于 3px 判定为点击。
- 拖拽结束后按中心点是否落在视口左/右 1/4、上/下 1/4 决定吸附边，用 `left/top` 像素定位（不要用 `right/bottom` 切换，CSS 无法对 `auto` 插值，会跳变）。
- 位置写入 `chrome.storage.local` 的 `buttonPos`，下次挂载时恢复。
- 如果实现拖拽，必须保证默认位置仍是右下角，且点击与拖拽互不误触。

---

## 六、抓取规格

### 6.1 数据来源优先级

按顺序收集，前一级失败或被风控时降级到下一级：

1. **B 站 Web 接口**（由 Service Worker 发起，避免内容脚本的跨域限制）
   `GET https://api.bilibili.com/x/web-interface/view?bvid=<BV号>`
   - 成功响应形如 `{ "code": 0, "data": { "bvid": "...", "title": "...", "pic": "http://i0.hdslb.com/bfs/archive/xxx.jpg", "pages": [{ "page": 1, "part": "P1", "first_frame": "http://i0.hdslb.com/bfs/storyboard/..." }] } }`。
   - 取 `data.title` 作为结果页标题，`data.pic` 作为封面，`data.pages[].first_frame` 作为各分 P 首帧（可选，标为「P1 首帧」）。
   - `code !== 0`、HTTP 非 200、超时（8 秒）、JSON 解析失败都视为失败。
   - 请求带 `credentials: 'omit'`；网络错误或 5xx 重试 1 次（间隔 500ms），4xx 不重试。
2. **页面 meta**：`meta[itemprop="image"]`、`meta[property="og:image"]`、`meta[name="twitter:image"]` 的 `content`。
3. **播放器封面**：`video[poster]` 的 `poster` 属性。
4. **DOM 大图扫描**（见 6.3）。

要求：接口失败不能让整个流程失败，必须在控制台用 `console.info` 记录降级原因，并以 DOM 结果继续。

### 6.2 封面判定

- 规范化后与 `data.pic` 或 meta 封面 URL 相同的图片，标记 `isCover: true`，标签固定为「封面」。
- 封面永远排在结果第一位，即使它的像素面积不是最大。
- 分 P 首帧标记 `source: 'page-frame'`，标签为「P{n} 首帧」，排在封面之后、普通页面图之前。

### 6.3 DOM 大图扫描

```js
// 参考实现，尺寸判定与去重逻辑必须与本节文字一致
const MIN_W = 400;
const MIN_H = 200;

function scanDomImages() {
  const items = [];
  for (const img of document.images) {
    // 1. 尺寸：优先用已加载的真实尺寸，未加载时退回布局尺寸（1px 占位图视为未加载）
    const rect = img.getBoundingClientRect();
    const naturalW = img.naturalWidth > 2 ? img.naturalWidth : 0;
    const naturalH = img.naturalHeight > 2 ? img.naturalHeight : 0;
    const w = naturalW || Math.round(rect.width);
    const h = naturalH || Math.round(rect.height);
    if (w < MIN_W || h < MIN_H) continue;
    if (w / h > 8) continue; // 极端长条通常是分隔线/装饰

    // 2. 取最可信的 URL：已加载用 currentSrc/src；未加载（如 1px 占位图）优先 data-src
    const loaded = img.naturalWidth > 2;
    let url = loaded ? (img.currentSrc || img.src) : '';
    if (!url) url = img.dataset.src || img.dataset.original || '';
    if (!url) url = img.currentSrc || img.src || '';
    if (!url && img.srcset) url = largestFromSrcset(img.srcset);
    if (!url) continue;

    // 3. 排除头像、表情、图标
    if (img.closest('[class*="avatar"], [class*="face"], [class*="emoji"], [class*="icon"]')) continue;

    items.push({ url, width: w, height: h, label: '页面图片', source: 'page' });
  }
  return items;
}

function largestFromSrcset(srcset) {
  // srcset 形如 "a.jpg 320w, b.jpg 640w, c.jpg 1280w"，必须按描述符取最大，不能只取最后一个
  const list = srcset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [url, descriptor = ''] = s.split(/\s+/);
      const width = /^\d+w$/.test(descriptor) ? parseInt(descriptor, 10) : 0;
      return { url, width };
    });
  list.sort((a, b) => b.width - a.width);
  return list[0] ? list[0].url : '';
}
```

补充要求：

- 必须兼容 `<picture>`（`currentSrc` 已能拿到最终地址即可）。
- URL 为 `data:`、`blob:`、`chrome-extension:` 的一律跳过。
- 必须包含 `img[data-src]` 的懒加载图：`src` 可能是 1px 占位图，此时优先取 `data-src`。
- 可选：扫描 `background-image`（解析 `getComputedStyle(el).backgroundImage` 中的 `url("...")`），只保留布局尺寸达标且域名属于 CDN 的项，标记 `source: 'page'`。
- 推荐位、评论区、UP 主头像都可能命中阈值：不要用脆弱的类名白名单去猜，改为给结果打来源标签，让用户在结果页筛选（见 8.2）。
  - 若元素命中 `[class*="recommend"], [class*="video-card"], [class*="video-page-card"]`，标记 `source: 'recommend'`，标签「推荐」。
  - 标签只影响展示与筛选，不影响下载。

### 6.4 URL 规范化（所有来源统一走同一函数）

```js
function normalizeImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let u = raw.trim();
  if (u.startsWith('data:') || u.startsWith('blob:')) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  else if (!/^https:\/\//i.test(u)) return ''; // 相对路径等一律丢弃

  // 去掉 B 站 CDN 的缩放/格式后缀，例如 @1280w_720h_1c.webp、@440w_248h_1c
  u = u.replace(/@[^/]*$/, '');
  // 去掉 hash
  u = u.replace(/#.*$/, '');
  return u;
}
```

- 只保留域名为 `hdslb.com`、`biliimg.com`、`bilivideo.com` 或其子域名的图片；判断用 `new URL(u).hostname`，做后缀匹配而不是 `includes`（防止 `evil-hdslb.com` 绕过）。
- 去重键 = 规范化后的 URL；同一张图不同尺寸后缀要合并成一条，保留最大尺寸的那条记录。
- `http://` 一律升级为 `https://`，避免扩展页混合内容被拦截。

### 6.5 排序

1. 封面（`isCover`）第一；
2. 分 P 首帧按 P 序号升序；
3. 其余按像素面积 `width * height` 降序；
4. 面积相同按 URL 字典序，保证结果稳定，方便调试。

### 6.6 数据结构（传给结果页的唯一格式）

```js
{
  id: "m3k9x2ab",              // 由 Service Worker 生成
  bvid: "BV1xx411c7xx",
  title: "视频标题",
  pageUrl: "https://www.bilibili.com/video/BV1xx411c7xx/",
  createdAt: 1730000000000,
  images: [
    {
      url: "https://i0.hdslb.com/bfs/archive/xxx.jpg",
      width: 1920,
      height: 1080,
      label: "封面",
      source: "cover",         // cover | page-frame | page | recommend
      isCover: true
    }
  ]
}
```

- `width/height` 允许为 0（未加载的懒加载图），结果页加载后要回填真实尺寸并更新角标。
- 任何字段缺失都要有兜底，结果页不能因为 `label` 为空而渲染出 `undefined`。

### 6.7 抓取失败策略

- 接口失败 → 静默降级，不打扰用户。
- 所有来源都为空 → 按钮恢复 `idle`，轻提示「没有找到可下载的图片」。
- 单张图片 URL 异常 → 跳过该张，不中断整体流程。
- 结果页要能区分「数据过期」与「视频确实没有图片」，文案不同。

---

## 七、数据传递

### 7.1 消息协议

内容脚本 → Service Worker：

```js
// 请求视频元信息
{ type: 'FETCH_VIDEO_META', bvid: 'BV1xx411c7xx' }

// 打开结果页
{ type: 'OPEN_GALLERY', payload: { bvid, title, pageUrl, images } }
```

Service Worker 响应：

```js
// FETCH_VIDEO_META
{ ok: true, title, cover, pages: [{ page, part, firstFrame }] }
// 或
{ ok: false, error: 'TIMEOUT' | 'HTTP_412' | 'NETWORK' | 'PARSE' }

// OPEN_GALLERY
{ ok: true, id }
```

- `chrome.runtime.onMessage` 中执行异步逻辑时必须 `return true`，否则消息通道会提前关闭。
- Service Worker 里所有 `fetch` 都带 `AbortSignal.timeout(8000)`，并用 `try/catch` 包住。
- 内容脚本调用 `chrome.runtime.sendMessage` 时用 `await` 并 `try/catch`；扩展被重新加载后旧页面会报 `Extension context invalidated`，此时提示用户刷新页面。

### 7.2 存储与打开新页面

```js
// Service Worker
const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const key = 'gallery:' + id;
await chrome.storage.session.set({ [key]: { ...payload, id, createdAt: Date.now() } });
await chrome.tabs.create({ url: chrome.runtime.getURL('viewer/viewer.html') + '?id=' + id });
```

- 只把 URL 与元数据写进 `session`，不要把图片二进制写进去（配额只有约 10MB）。
- 不要把图片列表塞进 URL 查询参数（长度限制 + 中文转义问题）。
- `chrome.storage.session` 默认对扩展页面与 Service Worker 可见，浏览器关闭后自动清空；结果页刷新后仍能读到，不要在首次读取后立刻删除。
- 可在 Service Worker 中顺便清理超过 60 条的旧 `gallery:*` 键，避免长期占用配额。

### 7.3 结果页读取

```js
const id = new URLSearchParams(location.search).get('id');
if (!id) { renderEmpty('缺少数据标识，请回到 B 站视频页重新获取'); return; }
const key = 'gallery:' + id;
const data = (await chrome.storage.session.get(key))[key];
if (!data) { renderEmpty('数据已过期，请回到 B 站视频页重新点击「获取图片」'); return; }
```

---

## 八、结果页 viewer.html

### 8.1 页面结构

```text
<header class="topbar">
  <div class="meta">视频标题（单行省略，title 属性放全文） + 共 N 张</div>
  <div class="filters">全部 / 封面 / 页面图片 / 推荐</div>
  <div class="actions">
    <input id="prefix" placeholder="文件名前缀">
    <button id="selectAll">全选</button>
    <button id="downloadSelected" class="primary">下载选中 (0)</button>
    <button id="downloadAll">下载全部</button>
  </div>
</header>
<main id="grid" class="grid"></main>
<div id="progress" class="progress" hidden>...</div>
<div id="lightbox" class="lightbox" hidden>...</div>
<div id="toast" class="toast" hidden></div>
```

- 顶栏 `position: sticky; top: 0`，白底 + 细分割线；暗色模式切换为深色底，不能出现白底白字。
- 页面 `<html lang="zh-CN">`，`<meta charset="utf-8">`，`<meta name="color-scheme" content="light dark">`。
- 无内联脚本、无内联 `onclick`（扩展页 CSP 会拦截）。

### 8.2 网格与筛选

- 网格：`display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;`，页面最大宽度 1440px 居中，左右 24px 内边距。
- 卡片：
  - 16:9 缩略图容器，`object-fit: cover`，圆角 12px，背景 `#f3f4f6`（暗色 `#1f2126`）；
  - 左上角圆形勾选框，默认不选中（避免误下全部）；
  - 右下角尺寸角标，例如 `1920×1080`，未知时显示「尺寸未知」，图片加载成功后回填；
  - 左下角来源标签：封面（粉色实心）、首帧、推荐（灰色描边）；
  - hover 显示遮罩与两个按钮：「预览」「下载这张」；
  - `loading="lazy"` 用于缩略图，`decoding="async"`。
- 筛选按钮是一组单选 chip：全部 / 封面 / 页面图片 / 推荐。切换只改变可见卡片，**不清空已勾选项**；「下载选中」统计的是全部已勾选，而不是当前筛选可见项，文案里要写清楚。
- 缩略图加载失败：显示破图占位、灰显卡片，但勾选框仍可用（下载时走转换流程，可能成功）。

### 8.3 灯箱

- 点击缩略图或「预览」打开：全屏遮罩 `rgba(0,0,0,0.82)`，图片 `max-width: 92vw; max-height: 88vh; object-fit: contain`。
- 顶部显示 `3 / 12` 与关闭按钮；左右切换按钮 + 键盘 `ArrowLeft` / `ArrowRight`；`Esc` 或点击遮罩关闭。
- 若当前筛选生效，左右切换只在可见项之间循环。
- 打开时禁止背景滚动（`document.body.style.overflow = 'hidden'`），关闭时恢复。

### 8.4 下载任务与进度

- 「下载选中 (N)」在 N 为 0 时 `disabled`；勾选变化时实时更新数字。
- 「下载全部」= 当前全部图片（不受筛选影响），执行前用 `confirm` 提示张数（原生 `confirm` 在扩展页可用）。
- 点击后立即进入下载态：禁用所有下载按钮、显示进度条 `正在处理 3 / 12`，每张卡片右上角显示状态（等待 / 转换中 / 成功 / 失败）。
- 完成后面板显示汇总：「成功 10 张，失败 2 张」，失败项列出文件名与原因，并提供「重试失败项」。
- 转换过程中允许用户取消：设置 `cancelled` 标记，队列检查到后停止派发新任务；已开始的任务自行结束。取消后文案为「已取消，完成 x / y」。
- 进度面板可折叠，但不能遮挡网格操作。

### 8.5 文件名

- 默认前缀：视频标题清洗后的结果，截断到 30 个字符；用户可编辑，编辑内容实时保存到 `chrome.storage.local` 的 `lastPrefix`（下次打开结果页恢复）。
- 单个文件名：`<前缀>-<两位序号>-<标签>.png`，例如 `【某视频】-01-封面.png`。
- 标签取值：封面 / P1首帧 / 图片 / 推荐；同一标签重复时靠序号区分。
- 清洗规则：
  - 删除 `\ / : * ? " < > |` 以及 `\u0000-\u001f` 控制字符；
  - 合并连续空白为单个空格；
  - 去掉首尾空格与结尾的点；
  - Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1`～`COM9`、`LPT1`～`LPT9`）加下划线前缀；
  - 清洗后为空则回退为 `bilibili`。
- 不创建子目录（`filename` 不带 `/`），避免下载目录权限与路径问题。
- 调用 `chrome.downloads.download({ conflictAction: 'uniquify', saveAs: false })`，同名文件自动加序号。

### 8.6 状态与文案

必须实现以下状态，不能只做「有数据」一种：

| 场景 | 表现 |
|---|---|
| 读取中 | 骨架屏（6 个灰色卡片） |
| 数据过期 / id 缺失 | 居中插图 + 说明 + 「返回 B 站」按钮（`chrome.tabs.create` 打开 `https://www.bilibili.com`） |
| 图片为空 | 「这个页面没有找到可下载的图片」 |
| 部分缩略图失败 | 卡片灰显 + 「加载失败」，不阻塞其他图片 |
| 下载全部失败 | 汇总面板 + 重试按钮，不能只弹一个 toast |

---

## 九、PNG 转换与下载

### 9.1 为什么必须重编码

B 站图片多为 JPEG / WebP / AVIF，且跨域图片不能直接通过 `<a download>` 保存；扩展页虽然有 `host_permissions` 可以 `fetch` 到二进制，但下载文件名与格式仍由内容决定。因此：

- 源文件已经是真正的 PNG（`Content-Type: image/png` 且首字节为 PNG magic）时，可以直接保存原 Blob，避免无谓重编码；
- 其他格式统一走 Canvas 重编码为 PNG；
- 重编码会丢失 EXIF 等元数据，也可能让文件体积变大，这是「统一输出 PNG」的必然代价，不要向用户承诺无损。

### 9.2 转换流程（结果页执行）

```js
async function toPngBlob(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      referrer: 'https://www.bilibili.com/',
      credentials: 'omit',
      cache: 'force-cache',
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('空响应');
    // 不要只凭 blob.type 拒绝：部分 CDN 会返回 application/octet-stream，交给解码器判断更可靠

    // 已经是 PNG：直接返回原始数据
    if (blob.type === 'image/png' && (await isPngMagic(blob))) return blob;

    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      if (bitmap.width > 16384 || bitmap.height > 16384) {
        throw new Error('图片尺寸超出浏览器画布上限');
      }
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布上下文');
      ctx.drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      bitmap.close(); // 逐张释放，避免大图堆积
    }
  } finally {
    clearTimeout(timer);
  }
}

async function isPngMagic(blob) {
  const buf = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => buf[i] === b);
}
```

- 必须用 `imageOrientation: 'from-image'`，否则带 EXIF 旋转的手机图会变成横躺。
- 画布尺寸使用 `bitmap.width/height`，不要乘 `devicePixelRatio`，也不要缩放，保证输出像素与原图一致。
- 若 `createImageBitmap` 失败，降级为 `<img>` + `canvas.toBlob('image/png')`（先设置 `crossOrigin = 'anonymous'`，失败则直接报错）。
- `OffscreenCanvas` 不可用时同样走 `<img>` + `canvas` 降级。
- 统一在扩展页面（viewer）执行，**不要放到 Service Worker**：MV3 的 Service Worker 里没有 `URL.createObjectURL`，且 DOM 画布不可用。

### 9.3 下载流程

```js
const blobUrl = URL.createObjectURL(pngBlob);
const downloadId = await chrome.downloads.download({
  url: blobUrl,
  filename: fileName,
  conflictAction: 'uniquify',
  saveAs: false
});
// 不要立刻 revoke：下载尚未完成时释放会导致文件损坏
pendingRevoke.set(downloadId, blobUrl);
```

- 并发上限 3（同时最多 3 个 `fetch + 转换 + 下载`），用简单的任务队列实现，不要 `Promise.all` 一次性打满。
- 单张失败重试 1 次；重试仍失败则记录原因（HTTP 状态 / 超时 / 画布失败），继续下一张。
- `chrome.downloads.onChanged` 监听 `state` 变为 `complete` 或 `interrupted` 时 `URL.revokeObjectURL` 并删除记录；兜底在 `beforeunload` 与 5 分钟定时器里统一释放。
- 下载被用户或策略中断（`interrupted`）时，状态标为失败并显示 `error` 字段，不能假装成功。
- 若 `chrome.downloads` 不可用（权限被移除），降级为 `<a download>` 点击保存，并在界面提示。

### 9.4 防盗链与 403

按顺序尝试：

1. `fetch` 带 `referrer: 'https://www.bilibili.com/'`（这是 `RequestInit` 支持的正规字段；不要尝试设置 `Referer` 请求头，它属于 forbidden header，浏览器会忽略）。
2. 仍返回 403 时，判定该 CDN 校验来源。此时有两种处理，按优先级：
   - 在 `manifest.json` 增加 `declarativeNetRequest` 权限，并添加静态规则为 `hdslb.com` 的 `xmlhttprequest` 请求补 `Referer: https://www.bilibili.com/`：

     ```json
     [
       {
         "id": 1,
         "priority": 1,
         "action": {
           "type": "modifyHeaders",
           "requestHeaders": [
             { "header": "Referer", "operation": "set", "value": "https://www.bilibili.com/" }
           ]
         },
         "condition": {
           "urlFilter": "||hdslb.com/",
           "resourceTypes": ["xmlhttprequest"]
         }
       }
     ]
     ```

     并在 `manifest.json` 中加上 `"declarative_net_request": { "rule_resources": [{ "id": "bili_referer", "enabled": true, "path": "rules/referer.json" }] }`。若采用此方案，目录树要补上 `rules/referer.json`。
   - 不增加权限时，跳过该图并标注「403，需登录/防盗链」，不要卡住整个队列。
3. 缩略图（`<img>`）不走上述流程，直接加载；失败就显示占位，不影响下载。

> 注意：`declarativeNetRequest` 的规则会作用于扩展发起的请求。加规则前先确认 `host_permissions` 已包含目标域名，否则规则不生效。

---

## 十、健壮性与踩坑清单（逐条落实）

1. **跨域 fetch 的位置**：内容脚本受页面 CORS 限制，B 站接口与图片抓取一律由 Service Worker 或扩展页面发起，内容脚本只负责 DOM 扫描。
2. **注入幂等**：`window` 标记 + DOM id 双重判断，否则 SPA 跳转会出现两个按钮、两套定时器。
3. **SPA 换页不刷新**：只靠 `DOMContentLoaded` 会漏挂，必须做 URL 轮询 + 节点存在性检查。
4. **Shadow DOM**：`all: initial` 只放在宿主元素上；内部样式通过 `adoptedStyleSheets` 注入，避免被 B 站 `*` 选择器污染。
5. **扩展页 CSP**：不能有内联 `<script>`、内联事件属性、`eval`、远程脚本；`viewer.js` 必须外链。
6. **Blob URL 生命周期**：立即 `revokeObjectURL` 会导致下载文件为空或损坏；必须等下载状态结束。
7. **图片 URL 后缀**：`@1280w_720h_1c.webp` 等后缀不是真实文件名，必须剥离后才能取到原图；剥离后仍要校验域名。
8. **URL 判断**：用 `new URL()` + `hostname` 后缀匹配，不要用 `includes('hdslb.com')`，防止被相似域名欺骗。
9. **懒加载**：已加载时用 `currentSrc` / `src`；未加载（`naturalWidth <= 2`）时优先 `data-src`，再退回 `srcset` 最大候选。
10. **尺寸未知**：结果页加载后回填真实尺寸；未知尺寸不能显示 `NaN×NaN`。
11. **大图内存**：逐张 `bitmap.close()`，并发不超过 3，禁止把全部 Blob 缓存到数组里。
12. **超时**：接口 8 秒、图片 20 秒；超时统一走 `AbortController`，不要用 Promise.race 留下悬挂请求。
13. **中文与特殊字符**：文件名清洗、标题截断、`encodeURIComponent` 处理 BV 号与查询参数。
14. **暗色模式**：`prefers-color-scheme: dark` 下顶栏、卡片、进度条、灯箱都要有对应色值；按钮在 B 站暗色页面也必须可读。
15. **全屏**：全屏元素之外的节点不渲染，必须把宿主节点搬进 `document.fullscreenElement`（该元素是 `<video>` 时保持原位）。
16. **重复点击**：`scanning` 状态下禁用按钮并直接 return，避免打开多个结果页。
17. **数据过期**：结果页刷新后 `session` 数据仍应存在；浏览器重启后给出明确的重取指引。
18. **空结果**：不能白屏，必须有插图 + 文案 + 返回按钮。
19. **不申请多余权限**：`tabs.create` 不需要 `tabs` 权限；`storage`、`downloads` 已足够。
20. **图标缺失**：省略 `icons` 字段比放一个假 PNG 更安全。

---

## 十一、验收清单（自测必须逐条通过）

1. 在 Edge 中打开 `edge://extensions`，开启开发者模式，「加载解压缩的扩展」选择项目根目录，无报错、无警告（权限相关警告除外）。
2. 打开任意 BV 视频页，右下角出现「获取图片」按钮，样式不被 B 站页面污染。
3. 点击按钮：先进入「正在获取…」，随后自动打开新标签页；按钮恢复为「获取图片」。
4. 结果页第一张是封面，带「封面」标签；其余图片按面积从大到小排列，无重复 URL。
5. 勾选 3 张 → 「下载选中 (3)」→ 下载目录出现 3 个 `.png` 文件，用看图工具确认格式确为 PNG、尺寸与原图一致。
6. 「下载全部」在确认后执行，进度条从 0 递增到总数，失败项有原因与「重试失败项」。
7. 在视频页内点击推荐视频（SPA 跳转）后，按钮仍然存在且只存在一个；在新视频上点击能抓到新封面。
8. 刷新结果页，图片列表仍能恢复；直接访问 `viewer.html`（无 id）显示明确的空状态。
9. 全屏播放时按钮仍可见，退出全屏后回到右下角。
10. 系统切换到暗色模式后，按钮、结果页、灯箱文字均可读。
11. 断网后点击按钮：有失败提示，按钮不卡在「正在获取…」，控制台无未捕获异常。
12. 连续快速点击 5 次按钮：只打开一个结果页。

---

## 十二、输出格式与自检

### 12.1 输出顺序

1. 需求理解（≤ 10 行）。
2. 文件树。
3. 逐个文件完整代码，每个文件用 `### 路径` 开头，代码块标注语言。
4. 「如何加载到 Edge」三步说明。
5. 「已知取舍与可能的坑」列表（≤ 8 条）。

### 12.2 禁止事项

- 禁止伪代码、`// ...` 省略、只给关键函数。
- 禁止引入任何 npm 包、构建工具、CSS 框架、图标字体。
- 禁止远程加载 JS / CSS / 字体 / 图片。
- 禁止使用 `eval`、`new Function`、内联脚本。
- 禁止申请 `<all_urls>` 或与功能无关的权限。
- 禁止把图片二进制写入 `chrome.storage`。
- 禁止在 Service Worker 里调用 `URL.createObjectURL` 或 DOM API。

### 12.3 交付前自检

- 每个文件都能在文件树中找到，路径大小写一致。
- `manifest.json` 是合法 JSON，无尾逗号。
- 所有 `chrome.*` 调用都有错误处理（`try/catch` 或 `.catch`）。
- 所有异步消息监听都 `return true`。
- 所有下载路径都有 `finally` 释放资源。
- 所有用户可见文案为中文，无 `undefined`、`null`、`NaN` 泄漏。
- 空结果、失败、过期三种状态都有对应 UI。
