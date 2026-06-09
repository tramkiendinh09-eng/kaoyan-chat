# Kaoyan Chat

考研答疑 Web 应用，部署在 `/chat`。

## 当前能力

- 学生用学号登录，SQLite 保存学生、会话、消息、长期记忆、知识片段和反馈。
- 管理员后台 `/chat/admin` 配置 OpenAI-compatible、Anthropic/Claude、Gemini 中转。
- 支持 SSE 流式输出、停止生成、重新生成、继续回答、编辑后重问、分支会话。
- 支持 Markdown + MathJax 公式渲染；流式公式会在生成过程中触发补偿渲染，不依赖刷新页面。
- 支持图片上传、粘贴、拖拽、预览，并隔离每个会话的附件草稿。
- 支持复制消息、复制公式源码、复制深链、收藏、反馈、当前会话查找、全局搜索、命令面板。
- 支持一键导出当前会话 MD/PDF/JSON/CSV、全部会话 MD/PDF/JSON/CSV、复盘报告 MD/PDF、收藏复盘 MD/PDF/JSON/CSV，PDF 会优先使用 Pandoc + XeLaTeX 排版并直接下载，失败时回退到浏览器 PDF。
- 前端按 ChatGPT、Claude、Gemini 的网页端习惯重做了空状态、输入框、侧栏、粘性顶部栏、消息动作区和移动端首屏。

## 前端参考

实现时参考了这些开源聊天前端的布局和交互取舍：

- Chatbot UI: https://github.com/mckaywrigley/chatbot-ui
- LibreChat: https://github.com/danny-avila/LibreChat
- HuggingFace Chat UI: https://github.com/huggingface/chat-ui

本项目仍保持原生 JS/CSS 结构，没有引入 React/Vite 构建链。

## 启动

```bash
node server.js
```

后台初始密码见 `.env` 的 `ADMIN_PASSWORD`。

## 部署

完整部署步骤见 [DEPLOY.md](DEPLOY.md)。仓库不会提交 `.env`、SQLite 数据库、上传附件或 `node_modules`；迁移到新服务器时请单独复制 `data/` 和 `uploads/`。

## 验证

```bash
npm run check
npm run verify:ui
KAOYAN_CHAT_URL="https://sub2.fengqingyun03.ccwu.cc/chat" npm run verify:ui
```

`scripts/verify-ui.js` 会覆盖登录、路由、侧栏、主题、命令面板、草稿、附件、搜索、消息目录、数学公式无刷新渲染、复制、重试、继续回答、编辑后停止、分支、收藏、反馈、MD/PDF/JSON/CSV 导出、移动端布局和管理员反馈。
