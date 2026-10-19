# B站图片提取器 · 官方宣传页

静态单页官网，用于介绍「B站图片提取器」浏览器扩展。纯 HTML / CSS / JavaScript，无构建步骤、无第三方依赖、无外部网络请求。

## 目录

```text
billibili_plugin_web/
├── index.html          # 单页结构与全部中文文案
├── styles.css          # 设计变量、布局、暗色模式、响应式
├── main.js             # 移动导航、导航高亮、滚动入场、年份
├── assets/
│   └── favicon.svg     # 站点图标
└── README.md
```

## 本地预览

直接双击 `index.html` 即可在浏览器中打开，所有功能在 `file://` 下可用。

也可以启动一个本地静态服务器：

```powershell
# 在 billibili_plugin_web 目录下
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 页面内容

- Hero：产品定位、核心卖点与浏览器 / 悬浮按钮示意图。
- 产品介绍：三步使用流程。
- 核心功能：封面、首帧、页面大图、筛选、PNG 下载、隐私。
- 界面预览：纯 HTML/CSS 模拟结果页，不依赖截图。
- 安装步骤：Edge / Chrome 加载解压缩扩展。
- 常见问题：收费、隐私、PNG 格式、视频抽帧、抓取失败、浏览器支持。
- 页脚：版本、兼容信息与「非官方产品」声明。

## 自定义

- 品牌色、圆角、阴影集中在 `styles.css` 顶部的 `:root` 变量中，修改 `--pink`、`--pink-deep`、`--accent` 即可整体换色。
- 暗色模式由 `prefers-color-scheme: dark` 自动切换，对应变量在同一文件的媒体查询中。
- 文案直接写在 `index.html` 中，没有模板或数据文件。

## 部署

将整个 `billibili_plugin_web` 目录上传到任意静态托管服务即可（GitHub Pages、Cloudflare Pages、Vercel、对象存储等）。不需要 Node.js 或构建命令。

## 说明

- 站点不加载远程字体、图片、统计脚本或 CDN 资源。
- 所有图标与界面示意图均由内联 SVG / CSS 绘制。
- 页面与哔哩哔哩官方无关，仅用于介绍同目录体系下的第三方扩展。
