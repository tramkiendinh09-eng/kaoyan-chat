'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'kaoyan-chat.sqlite');
const BASE = (process.env.KAOYAN_CHAT_URL || 'http://127.0.0.1:18080/chat').replace(/\/+$/, '');
const PASSWORD = 'Test12345';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || readEnvValue('ADMIN_PASSWORD') || 'admin';
const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARLJgwiCMQAcABgQCAqpi7HsAAAAASUVORK5CYII=';

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  let studentNo = '';
  let browser = null;
  try {
    const session = await loginTestStudent();
    studentNo = session.studentNo;
    const cookie = `kc_sid=${encodeURIComponent(session.token)}`;
    const conversations = await seedConversations(cookie);
    seedStudyMemory(studentNo);
    await verifyBackendAutoTitle(cookie);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 720 } });
    await context.addCookies([{ name: 'kc_sid', value: session.token, url: `${BASE}/` }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.stack || err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource') && !msg.text().includes('/cdn-cgi/rum')) errors.push(msg.text());
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400 && !response.url().includes('/api/admin/me') && !response.url().includes('/cdn-cgi/rum')) {
        errors.push(`${status} ${response.url()}`);
      }
    });

    await page.goto(`${BASE}/?verify=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#conversationSearch', { timeout: 10000 });
    await verifyMessageDeepLink(page, conversations[0].id, conversations[0].userMessageId);
    await verifyConversationRouteSync(page);
    await verifySidebarToggle(page);
    await verifyThemeToggle(page);
    await verifyKeyboardShortcuts(page);
    await verifyCommandPalette(page);
    await verifyDraftPersistence(page);
    await verifyAttachmentIsolation(page);
    await verifyUndoableDelete(page);
    await verifyPinnedConversation(page);
    await verifyArchivedConversation(page);
    await verifyStudyMemoryPanel(page);
    await verifyConversationSearch(page);
    await verifyConversationFind(page);
    await verifyMessageOutline(page);
    await verifyQuickPrompts(page);
    await verifyMessageRenderingAndActions(page);
    await verifyLongAnswerCollapse(page);
    await verifySavedMessagesReview(page);
    await verifyJsonImport(page);
    await verifyContinueAnswer(page);
    await verifyStreamingFormulaNoRefresh(page);
    await verifyImagePreview(page);
    await verifyEditMessage(page);
    await verifySmartScroll(page);
    await verifyAutoTitleSync(page);
    await verifyFailedSendRetryAction(page);
    await verifyStopGeneration(page);
    await verifyBranchConversation(page);
    await verifyMobileLayout(page);
    await verifyAdminFeedback(page);
    assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
    await browser.close();
    browser = null;
    console.log(JSON.stringify({
      ok: true,
      studentNo,
      conversations: conversations.map((item) => item.title)
    }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (studentNo) cleanupTestStudent(studentNo);
  }
}

async function loginTestStudent() {
  for (const prefix of ['202702', '2701', '2702']) {
    for (let i = 0; i < 1000; i += 1) {
      const studentNo = `${prefix}${String((Date.now() + i) % 1000).padStart(3, '0')}`;
      const res = await fetchWithRetry(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentNo, password: PASSWORD, passwordConfirm: PASSWORD })
      }, `login ${studentNo}`);
      if (!res.ok) continue;
      const token = decodeURIComponent(((res.headers.get('set-cookie') || '').match(/kc_sid=([^;]+)/) || [])[1] || '');
      if (token) return { studentNo, token };
    }
  }
  throw new Error('No available test student id.');
}

async function seedConversations(cookie) {
  const created = [];
  for (const title of ['回归-概率公式', '回归-线性代数', '回归-英语阅读']) {
    const res = await fetchWithRetry(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title })
    }, `create conversation ${title}`);
    if (!res.ok) throw new Error(`create conversation ${title}: ${res.status} ${await res.text()}`);
    created.push((await res.json()).conversation);
  }

  const db = new DatabaseSync(DB_PATH);
  const now = new Date().toISOString();
  created[0].userMessageId = insertMessage(db, created[0].id, 'user', '用户题目文本：求解 \\(x+1)^2\\)。', [{ name: '用户题图.png', dataUrl: IMAGE_DATA_URL }], now);
  insertMessage(db, created[0].id, 'assistant', [
    '助手解答公式：',
    '',
    '## 展开公式',
    '\\[x^2+2x+1\\]',
    '',
    '## 代码验证',
    '',
    '```js',
    'const x = 1;',
    'console.log(x);',
    '```'
  ].join('\n'), [], new Date(Date.now() + 1000).toISOString(), null, 'GPT-5.5 深度思考 / gpt-5.5');
  insertMessage(db, created[1].id, 'user', '矩阵题', [], new Date(Date.now() + 2000).toISOString());
  insertMessage(db, created[1].id, 'assistant', Array.from({ length: 90 }, (_, i) => `第 ${i + 1} 步：长答案滚动验证。`).join('\n\n'), [], new Date(Date.now() + 3000).toISOString(), 'down');
  db.close();
  return created;
}

function insertMessage(db, conversationId, role, content, attachments, createdAt, feedback = null, modelName = null) {
  const id = `msg_verify_${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare('INSERT INTO messages (id, conversation_id, role, content, attachments_json, created_at, feedback, model_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    conversationId,
    role,
    content,
    JSON.stringify(attachments || []),
    createdAt,
    feedback,
    modelName
  );
  return id;
}

function seedStudyMemory(studentNo) {
  const db = new DatabaseSync(DB_PATH);
  const memory = {
    profile: { target: '目标院校数学一' },
    topics: { '概率统计': 3, '线性代数': 2, '高等数学': 1 },
    recentQuestions: [
      '概率题：随机变量分布函数怎么求',
      '线性代数：矩阵秩与特征值',
      '高等数学：极限等价无穷小'
    ],
    lastUpdatedAt: '2026-06-08T00:00:00.000Z'
  };
  db.prepare('UPDATE students SET memory_json = ? WHERE student_no = ?').run(JSON.stringify(memory), studentNo);
  db.close();
}

function readEnvValue(key) {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const line = text.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
}

async function verifyBackendAutoTitle(cookie) {
  const create = await fetchWithRetry(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '新的答疑' })
  }, 'create auto-title conversation');
  if (!create.ok) throw new Error(`create auto-title conversation: ${create.status} ${await create.text()}`);
  const conversation = (await create.json()).conversation;
  const controller = new AbortController();
  const chat = await fetchWithRetry(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    signal: controller.signal,
    body: JSON.stringify({
      conversationId: conversation.id,
      message: '自动命名测试：求函数极限并说明步骤'
    })
  }, 'auto-title chat');
  if (!chat.ok) throw new Error(`auto-title chat failed: ${chat.status} ${await chat.text()}`);
  const reader = chat.body.getReader();
  const decoder = new TextDecoder();
  let chunk = '';
  try {
    while (!chunk.includes('conversationTitle')) {
      const { value, done } = await reader.read();
      if (done) break;
      chunk += decoder.decode(value, { stream: true });
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  assert(chunk.includes('自动命名测试'), `auto-title meta missing: ${chunk}`);
  await waitFor(async () => {
    const res = await fetchWithRetry(`${BASE}/api/conversations`, { headers: { Cookie: cookie } }, 'list conversations', 2);
    if (!res.ok) return false;
    const rows = (await res.json()).conversations || [];
    return rows.some((item) => item.id === conversation.id && item.title.includes('自动命名测试'));
  }, 'backend auto-title did not persist');
}

async function waitFor(check, message, timeout = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(message);
}

async function fetchWithRetry(url, options = {}, label = 'fetch', attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

async function verifyMessageDeepLink(page, conversationId, messageId) {
  await page.goto(`${BASE}/?c=${encodeURIComponent(conversationId)}&m=${encodeURIComponent(messageId)}&verify=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.waitForFunction((id) => {
    const article = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    return article?.classList.contains('message-highlight') && article.textContent.includes('用户题目文本');
  }, messageId, { timeout: 10000 });
  assert(await page.locator('.conversation-item.active', { hasText: '回归-概率公式' }).count() === 1, 'deep link did not select target conversation');
}

async function verifyConversationRouteSync(page) {
  await page.goto(`${BASE}/?verify=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('c') && document.querySelector('.conversation-item.active')?.textContent?.includes('回归-概率公式'), null, { timeout: 10000 });
  const probabilityUrl = page.url();
  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => document.querySelector('.conversation-item.active')?.textContent?.includes('回归-线性代数') && new URL(location.href).searchParams.get('c'), null, { timeout: 10000 });
  assert(page.url() !== probabilityUrl, 'conversation selection did not update URL');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.conversation-item.active')?.textContent?.includes('回归-概率公式'), null, { timeout: 10000 });
  await page.evaluate(() => { window.__copiedText = ''; window.copyText = async (text) => { window.__copiedText = text; }; });
  await page.locator('.conversation-item', { hasText: '回归-概率公式' }).locator('[data-copy-conversation-link]').click();
  await page.waitForFunction(() => {
    const copied = window.__copiedText || '';
    const params = new URL(copied).searchParams;
    return copied.includes('/chat/?c=') && params.get('c') && !params.get('m');
  }, null, { timeout: 5000 });
  const copiedConversationUrl = await page.evaluate(() => window.__copiedText);
  await page.goto(copiedConversationUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.conversation-item.active')?.textContent?.includes('回归-概率公式'), null, { timeout: 10000 });
}

function cleanupTestStudent(studentNo) {
  try {
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('DELETE FROM students WHERE student_no = ?').run(studentNo);
    db.close();
  } catch (err) {
    console.warn(`[verify-ui] cleanup skipped: ${err.message}`);
  }
}

async function verifySidebarToggle(page) {
  await page.click('#sidebarToggleBtn');
  await page.waitForSelector('.layout.sidebar-collapsed', { timeout: 5000 });
  const collapsed = await page.evaluate(() => ({
    stored: localStorage.getItem('kc_sidebar_collapsed'),
    listDisplay: getComputedStyle(document.querySelector('#conversationList')).display
  }));
  assert(collapsed.stored === '1' && collapsed.listDisplay === 'none', `sidebar collapse failed: ${JSON.stringify(collapsed)}`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#sidebarToggleBtn', { timeout: 10000 });
  assert(await page.locator('.layout.sidebar-collapsed').count() === 1, 'sidebar collapsed state did not persist after reload');
  await page.click('#sidebarToggleBtn');
  await page.waitForSelector('#conversationSearch', { state: 'visible', timeout: 10000 });
  const expanded = await page.evaluate(() => ({
    stored: localStorage.getItem('kc_sidebar_collapsed'),
    collapsed: document.querySelector('.layout')?.classList.contains('sidebar-collapsed')
  }));
  assert(expanded.stored === '0' && !expanded.collapsed, `sidebar expand failed: ${JSON.stringify(expanded)}`);
}

async function verifyThemeToggle(page) {
  await page.evaluate(() => localStorage.setItem('kc_theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#themeToggleBtn', { state: 'attached', timeout: 10000 });
  await openSidebarToolGroup(page, '工具');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
  const light = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('kc_theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    button: document.querySelector('#themeToggleBtn')?.textContent?.trim()
  }));
  assert(light.theme === 'light' && light.stored === 'light' && light.button === '深色', `light theme baseline failed: ${JSON.stringify(light)}`);
  await page.click('#themeToggleBtn');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 });
  const dark = await page.evaluate((lightBg) => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('kc_theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    button: document.querySelector('#themeToggleBtn')?.textContent?.trim(),
    mathCount: document.querySelectorAll('mjx-container').length,
    changed: getComputedStyle(document.body).backgroundColor !== lightBg
  }), light.bg);
  assert(dark.theme === 'dark' && dark.stored === 'dark' && dark.button === '浅色' && dark.changed, `dark theme toggle failed: ${JSON.stringify(dark)}`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#themeToggleBtn', { state: 'attached', timeout: 10000 });
  await openSidebarToolGroup(page, '工具');
  const persisted = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('kc_theme'),
    button: document.querySelector('#themeToggleBtn')?.textContent?.trim()
  }));
  assert(persisted.theme === 'dark' && persisted.stored === 'dark' && persisted.button === '浅色', `dark theme did not persist: ${JSON.stringify(persisted)}`);
  await page.click('#themeToggleBtn');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
  const restored = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('kc_theme'),
    button: document.querySelector('#themeToggleBtn')?.textContent?.trim()
  }));
  assert(restored.theme === 'light' && restored.stored === 'light' && restored.button === '深色', `light theme restore failed: ${JSON.stringify(restored)}`);
}

async function verifyKeyboardShortcuts(page) {
  await page.keyboard.press('Control+Shift+S');
  await page.waitForSelector('.layout.sidebar-collapsed', { timeout: 5000 });
  await page.keyboard.press('Control+K');
  await page.waitForFunction(() => document.activeElement?.id === 'conversationSearch', null, { timeout: 5000 });
  assert(await page.locator('.layout.sidebar-collapsed').count() === 0, 'Ctrl+K did not expand sidebar');
  await page.fill('#messageInput', 'shortcut guard');
  await page.focus('#messageInput');
  await page.keyboard.press('Control+K');
  const focused = await page.evaluate(() => document.activeElement?.id);
  assert(focused === 'messageInput', `Ctrl+K stole focus while typing: ${focused}`);
  await page.fill('#messageInput', '');
}

async function verifyCommandPalette(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });

  await page.keyboard.press('Control+Shift+K');
  await page.waitForFunction(() => {
    const palette = document.querySelector('#commandPalette');
    const input = document.querySelector('#commandPaletteInput');
    const text = palette?.textContent || '';
    return palette
      && !palette.classList.contains('hidden')
      && document.activeElement === input
      && text.includes('新建答疑')
      && text.includes('导出当前会话 MD')
      && text.includes('打开常用模板');
  }, null, { timeout: 5000 });
  await page.fill('#commandPaletteInput', '模板');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const palette = document.querySelector('#commandPalette');
    const panel = document.querySelector('#promptLibraryPanel');
    return palette?.classList.contains('hidden')
      && panel
      && !panel.classList.contains('hidden')
      && document.activeElement === document.querySelector('#customPromptLabel');
  }, null, { timeout: 5000 });

  await page.keyboard.press('Control+Shift+K');
  await page.waitForFunction(() => !document.querySelector('#commandPalette')?.classList.contains('hidden'), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#commandPalette')?.classList.contains('hidden'), null, { timeout: 5000 });

  const mdDownloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+Shift+K');
  await page.fill('#commandPaletteInput', '导出当前会话 MD');
  await page.keyboard.press('Enter');
  const mdDownload = await mdDownloadPromise;
  const markdown = fs.readFileSync(await mdDownload.path(), 'utf8');
  assert(markdown.includes('回归-概率公式') && markdown.includes('用户题目文本'), 'command palette markdown export incomplete');

  await page.evaluate(() => { window.__copiedText = ''; window.copyText = async (text) => { window.__copiedText = text; }; });
  await page.keyboard.press('Control+Shift+K');
  await page.fill('#commandPaletteInput', '复制当前会话链接');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const copied = window.__copiedText || '';
    return copied.includes('/chat/?c=') && new URL(copied).searchParams.get('c');
  }, null, { timeout: 5000 });

  await page.keyboard.press('Control+Shift+K');
  await page.fill('#commandPaletteInput', '搜索会话');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'conversationSearch', null, { timeout: 5000 });
}

async function verifyDraftPersistence(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });
  await page.fill('#messageInput', '概率会话草稿');
  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('矩阵题'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#messageInput')?.value === '', null, { timeout: 10000 });
  await page.fill('#messageInput', '线代会话草稿');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });
  assert(await page.inputValue('#messageInput') === '概率会话草稿', 'probability draft did not restore after switching back');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });
  assert(await page.inputValue('#messageInput') === '概率会话草稿', 'probability draft did not restore after reload');
  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('矩阵题'), null, { timeout: 10000 });
  assert(await page.inputValue('#messageInput') === '线代会话草稿', 'linear algebra draft did not restore after reload');
  await page.fill('#messageInput', '');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForSelector('#messageInput', { timeout: 10000 });
  await page.fill('#messageInput', '');
}

async function verifyAttachmentIsolation(page) {
  const imageBuffer = Buffer.from(IMAGE_DATA_URL.split(',')[1], 'base64');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });
  await page.setInputFiles('#imageInput', { name: 'prob.png', mimeType: 'image/png', buffer: imageBuffer });
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('prob.png'), null, { timeout: 20000 });

  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('矩阵题'), null, { timeout: 10000 });
  await page.waitForFunction(() => !(document.querySelector('#attachmentRow')?.textContent || '').includes('prob.png'), null, { timeout: 10000 });
  await page.setInputFiles('#imageInput', { name: 'linear.png', mimeType: 'image/png', buffer: imageBuffer });
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('linear.png'), null, { timeout: 20000 });

  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('prob.png'), null, { timeout: 20000 });
  assert(!(await page.locator('#attachmentRow').innerText()).includes('linear.png'), 'linear attachment leaked into probability conversation');

  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('linear.png'), null, { timeout: 20000 });
  assert(!(await page.locator('#attachmentRow').innerText()).includes('prob.png'), 'probability attachment leaked into linear conversation');
  await page.click('#clearAttachmentsBtn');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('prob.png'), null, { timeout: 10000 });
  await page.click('#clearAttachmentsBtn');
  await dropImageOnComposer(page, 'dragged.png');
  await page.waitForFunction(() => (document.querySelector('#attachmentRow')?.textContent || '').includes('dragged.png'), null, { timeout: 10000 });
  assert(await page.locator('.composer-inner.drag-over').count() === 0, 'composer drag highlight stayed after drop');
  await page.click('#clearAttachmentsBtn');
}

async function verifyUndoableDelete(page) {
  const englishItem = page.locator('.conversation-item', { hasText: '回归-英语阅读' });
  await englishItem.locator('[data-delete-conversation]').click();
  await page.waitForFunction(() => {
    const toast = document.querySelector('#undoToast');
    return toast && !toast.classList.contains('hidden') && toast.textContent.includes('回归-英语阅读');
  }, null, { timeout: 5000 });
  assert(await page.locator('.conversation-title', { hasText: '回归-英语阅读' }).count() === 0, 'deleted conversation still visible before undo');
  await page.click('#undoToastBtn');
  await page.waitForFunction(() => [...document.querySelectorAll('.conversation-title')].some((node) => node.textContent.includes('回归-英语阅读')), null, { timeout: 5000 });

  await page.locator('.conversation-item', { hasText: '回归-英语阅读' }).locator('[data-delete-conversation]').click();
  await page.waitForFunction(() => document.querySelector('#undoToast')?.classList.contains('hidden'), null, { timeout: 8000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  assert(await page.locator('.conversation-title', { hasText: '回归-英语阅读' }).count() === 0, 'conversation was not deleted after undo window');
}

async function verifyPinnedConversation(page) {
  await page.fill('#conversationSearch', '');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent?.includes('用户题目文本'), null, { timeout: 10000 });
  const topbarActions = await textList(page, '.chat-topbar-actions .topbar-action');
  assert(
    topbarActions.includes('改名')
      && topbarActions.includes('链接')
      && topbarActions.includes('MD')
      && topbarActions.includes('PDF'),
    `topbar conversation actions missing: ${topbarActions.join(',')}`
  );
  page.once('dialog', (dialog) => dialog.accept('回归-概率公式-已改名'));
  await page.click('#topbarRenameBtn');
  await page.waitForFunction(() => {
    const title = document.querySelector('#chatTopbarTitle')?.textContent || '';
    const list = document.querySelector('#conversationList')?.textContent || '';
    const toast = document.querySelector('#appToast')?.textContent || '';
    return title.includes('回归-概率公式-已改名') && list.includes('回归-概率公式-已改名') && toast.includes('会话已重命名');
  }, null, { timeout: 30000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector('#conversationList')?.textContent || '').includes('回归-概率公式-已改名'), null, { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式-已改名' }).click();
  page.once('dialog', (dialog) => dialog.accept('回归-概率公式'));
  await page.click('#topbarRenameBtn');
  await page.waitForFunction(() => {
    const title = document.querySelector('#chatTopbarTitle')?.textContent || '';
    const list = document.querySelector('#conversationList')?.textContent || '';
    return title.includes('回归-概率公式') && list.includes('回归-概率公式') && !list.includes('回归-概率公式-已改名');
  }, null, { timeout: 30000 });
  const probabilityItem = page.locator('.conversation-item', { hasText: '回归-概率公式' });
  await probabilityItem.locator('[data-pin-conversation]').click();
  await page.waitForFunction(() => document.querySelector('.conversation-title')?.textContent?.includes('回归-概率公式'), null, { timeout: 5000 });
  assert(await page.locator('.conversation-item.pinned', { hasText: '回归-概率公式' }).count() === 1, 'pinned conversation missing active style');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.conversation-title')?.textContent?.includes('回归-概率公式'), null, { timeout: 10000 });
  assert((await page.locator('.conversation-item', { hasText: '回归-概率公式' }).locator('[data-pin-conversation]').innerText()).includes('取消置顶'), 'pinned state did not persist');
  await page.locator('.conversation-item', { hasText: '回归-概率公式' }).locator('[data-pin-conversation]').click();
  await page.waitForFunction(() => !document.querySelector('.conversation-item.pinned')?.textContent?.includes('回归-概率公式'), null, { timeout: 5000 });
}

async function verifyArchivedConversation(page) {
  await page.fill('#conversationSearch', '');
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.locator('.conversation-item', { hasText: '回归-线性代数' }).locator('[data-archive-conversation]').click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.conversation-title')].some((node) => node.textContent.includes('回归-线性代数')), null, { timeout: 5000 });
  await page.click('#archiveConversationsBtn');
  await page.waitForFunction(() => {
    const button = document.querySelector('#archiveConversationsBtn');
    const list = document.querySelector('#conversationList')?.textContent || '';
    return button?.classList.contains('active') && list.includes('回归-线性代数') && list.includes('已归档');
  }, null, { timeout: 30000 });
  await page.locator('.conversation-item.archived', { hasText: '回归-线性代数' }).locator('[data-restore-conversation]').click();
  await page.waitForFunction(() => (document.querySelector('#conversationList')?.textContent || '').includes('暂无归档会话'), null, { timeout: 5000 });
  await page.click('#archiveConversationsBtn');
  await page.waitForFunction(() => {
    const button = document.querySelector('#archiveConversationsBtn');
    const list = document.querySelector('#conversationList')?.textContent || '';
    return !button?.classList.contains('active') && list.includes('回归-线性代数') && list.includes('归档');
  }, null, { timeout: 30000 });
}

async function verifyStudyMemoryPanel(page) {
  await page.fill('#conversationSearch', '');
  await page.click('#studyMemoryBtn');
  await page.waitForFunction(() => {
    const button = document.querySelector('#studyMemoryBtn');
    const panel = document.querySelector('.study-memory-panel');
    const text = panel?.textContent || '';
    return button?.classList.contains('active')
      && text.includes('目标院校数学一')
      && text.includes('概率统计')
      && text.includes('线性代数')
      && text.includes('随机变量分布函数');
  }, null, { timeout: 10000 });
  assert(!await page.locator('#savedMessagesBtn.active').count(), 'study memory should close saved review panel');

  await page.click('[data-memory-action="refresh"]');
  await page.waitForFunction(() => {
    const panel = document.querySelector('.study-memory-panel');
    return panel && !(panel.textContent || '').includes('正在读取学习记忆');
  }, null, { timeout: 10000 });

  const mdDownloadPromise = page.waitForEvent('download');
  await page.click('[data-memory-export="md"]');
  const mdDownload = await mdDownloadPromise;
  const markdown = fs.readFileSync(await mdDownload.path(), 'utf8');
  assert(
    markdown.includes('学习记忆')
      && markdown.includes('目标院校数学一')
      && markdown.includes('概率统计：3')
      && markdown.includes('随机变量分布函数'),
    'study memory markdown export incomplete'
  );

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.click('[data-memory-export="json"]');
  const jsonDownload = await jsonDownloadPromise;
  const json = JSON.parse(fs.readFileSync(await jsonDownload.path(), 'utf8'));
  assert(
    json.format === 'kaoyan-chat.study-memory.v1'
      && json.memory?.profile?.target === '目标院校数学一'
      && json.memory?.topics?.['概率统计'] === 3
      && json.memory?.recentQuestions?.some((item) => item.includes('矩阵秩')),
    'study memory json export incomplete'
  );

  await page.click('#studyMemoryBtn');
  await page.waitForFunction(() => !document.querySelector('#studyMemoryBtn')?.classList.contains('active'), null, { timeout: 5000 });
}

async function verifyConversationSearch(page) {
  await page.fill('#conversationSearch', '概率');
  const titles = await textList(page, '.conversation-title');
  assert(titles.length >= 1 && titles.every((title) => title.includes('概率')) && titles.some((title) => title.includes('回归-概率公式')), `conversation search failed: ${titles.join(',')}`);
  await page.fill('#conversationSearch', '用户题目文本');
  await page.waitForSelector('.message-result', { timeout: 10000 });
  const resultText = await page.locator('.message-result').first().innerText();
  assert(resultText.includes('用户题目文本'), `message search result missing snippet: ${resultText}`);
  await page.locator('.message-result').first().click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('.message.user .message-content')]
      .some((node) => (node.textContent || '').includes('用户题目文本'));
  }, null, { timeout: 30000 });
  await page.fill('#conversationSearch', '不存在的会话');
  await page.waitForFunction(() => (document.querySelector('#conversationList')?.textContent || '').includes('未找到会话或消息'), null, { timeout: 10000 });
  await page.fill('#conversationSearch', '');
}

async function verifyConversationFind(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => (document.querySelector('#messages')?.textContent || '').includes('用户题目文本'), null, { timeout: 10000 });
  await page.fill('#conversationFind', 'x');
  await page.waitForFunction(() => {
    const count = document.querySelector('#conversationFindCount')?.textContent || '';
    return count === '1/2' && document.querySelectorAll('.message-find-hit').length === 2 && document.querySelectorAll('.message-find-active').length === 1;
  }, null, { timeout: 5000 });
  const firstActive = await page.locator('.message-find-active').first().getAttribute('data-message-id');
  await page.click('#conversationFindNext');
  await page.waitForFunction((firstId) => {
    const active = document.querySelector('.message-find-active');
    return active?.dataset?.messageId && active.dataset.messageId !== firstId && document.querySelector('#conversationFindCount')?.textContent === '2/2';
  }, firstActive, { timeout: 5000 });
  await page.focus('#conversationFind');
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction((firstId) => {
    const active = document.querySelector('.message-find-active');
    return active?.dataset?.messageId === firstId && document.querySelector('#conversationFindCount')?.textContent === '1/2';
  }, firstActive, { timeout: 5000 });
  await page.fill('#conversationFind', '不存在关键词');
  await page.waitForFunction(() => {
    return document.querySelector('#conversationFindCount')?.textContent === '0/0'
      && document.querySelectorAll('.message-find-active').length === 0
      && document.querySelector('#conversationFindNext')?.disabled === true;
  }, null, { timeout: 5000 });
  await page.click('#conversationFindClear');
  await page.waitForFunction(() => {
    return document.querySelector('#conversationFind')?.value === ''
      && document.querySelector('#conversationFindCount')?.textContent === ''
      && document.querySelectorAll('.message-find-hit').length === 0;
  }, null, { timeout: 5000 });
}

async function verifyMessageOutline(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => {
    const outline = document.querySelector('#messageOutline');
    const text = outline?.textContent || '';
    return outline
      && !outline.classList.contains('hidden')
      && document.querySelectorAll('.message-outline-item').length === 2
      && text.includes('学生')
      && text.includes('助手')
      && text.includes('用户题目文本')
      && text.includes('助手解答公式');
  }, null, { timeout: 10000 });
  const assistantId = await page.locator('.message.assistant').first().getAttribute('data-message-id');
  await page.locator(`.message-outline-item[data-outline-message="${assistantId}"]`).click();
  await page.waitForFunction((messageId) => {
    const article = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    return article?.classList.contains('message-highlight');
  }, assistantId, { timeout: 5000 });
  await page.click('#sidebarToggleBtn');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#messageOutline')).display === 'none', null, { timeout: 5000 });
  await page.click('#sidebarToggleBtn');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#messageOutline')).display !== 'none', null, { timeout: 5000 });
}

async function verifyQuickPrompts(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForSelector('#messageInput', { timeout: 10000 });
  assert(await page.locator('.quick-prompt').count() >= 5, 'quick prompt buttons missing');
  await page.fill('#messageInput', '');
  await page.locator('[data-quick-prompt="note"]').click();
  await page.waitForFunction(() => {
    const input = document.querySelector('#messageInput');
    return document.activeElement === input
      && input?.value.includes('错题笔记')
      && input.value.includes('考点、易错点、正确思路');
  }, null, { timeout: 5000 });
  await page.locator('[data-quick-prompt="similar"]').click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return value.includes('错题笔记')
      && value.includes('同类题')
      && value.includes('\n\n请基于这道题');
  }, null, { timeout: 5000 });
  const stored = await page.evaluate(() => {
    const conversationId = new URL(location.href).searchParams.get('c');
    const key = Object.keys(localStorage).find((item) => item.startsWith('kc_draft_') && item.endsWith(`:${conversationId}`));
    return key ? localStorage.getItem(key) || '' : '';
  });
  assert(stored.includes('错题笔记') && stored.includes('同类题'), 'quick prompt draft was not saved');
  await page.fill('#messageInput', '/');
  await page.waitForFunction(() => {
    const menu = document.querySelector('#slashPromptMenu');
    return menu && !menu.classList.contains('hidden') && menu.querySelectorAll('.slash-prompt-item').length >= 5;
  }, null, { timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    const menu = document.querySelector('#slashPromptMenu');
    return value.includes('请只讲本题最关键的一步')
      && menu?.classList.contains('hidden');
  }, null, { timeout: 5000 });
  await page.fill('#messageInput', '/note');
  await page.waitForFunction(() => {
    const items = [...document.querySelectorAll('#slashPromptMenu .slash-prompt-item')];
    return items.length === 1 && items[0]?.dataset?.slashPrompt === 'note';
  }, null, { timeout: 5000 });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return document.activeElement === document.querySelector('#messageInput')
      && value.includes('错题笔记')
      && value.includes('考点、易错点、正确思路');
  }, null, { timeout: 5000 });
  const slashStored = await page.evaluate(() => {
    const conversationId = new URL(location.href).searchParams.get('c');
    const key = Object.keys(localStorage).find((item) => item.startsWith('kc_draft_') && item.endsWith(`:${conversationId}`));
    return key ? localStorage.getItem(key) || '' : '';
  });
  assert(slashStored.includes('错题笔记'), 'slash prompt draft was not saved');
  await page.fill('#messageInput', '/');
  await page.waitForFunction(() => {
    const menu = document.querySelector('#slashPromptMenu');
    return menu && !menu.classList.contains('hidden');
  }, null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const input = document.querySelector('#messageInput');
    const menu = document.querySelector('#slashPromptMenu');
    return input?.value === '/' && menu?.classList.contains('hidden');
  }, null, { timeout: 5000 });

  const customPromptText = '请把我的错题压缩成三条复习提醒。';
  await page.fill('#messageInput', customPromptText);
  await page.click('#savePromptBtn');
  await page.waitForFunction((text) => {
    const panel = document.querySelector('#promptLibraryPanel');
    const toast = document.querySelector('#appToast')?.textContent || '';
    return panel
      && !panel.classList.contains('hidden')
      && (panel.textContent || '').includes('复习提醒')
      && toast.includes('模板已保存');
  }, customPromptText, { timeout: 5000 });
  await page.fill('#messageInput', '');
  await page.locator('[data-use-custom-prompt]', { hasText: '复习提醒' }).click();
  await page.waitForFunction((text) => {
    const input = document.querySelector('#messageInput');
    return document.activeElement === input && input?.value.includes(text);
  }, customPromptText, { timeout: 5000 });
  await page.fill('#messageInput', '/提醒');
  await page.waitForFunction(() => {
    const menu = document.querySelector('#slashPromptMenu');
    return menu
      && !menu.classList.contains('hidden')
      && (menu.textContent || '').includes('自定义')
      && (menu.textContent || '').includes('复习提醒');
  }, null, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction((text) => (document.querySelector('#messageInput')?.value || '').includes(text), customPromptText, { timeout: 5000 });
  await page.locator('[data-delete-custom-prompt]').first().click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('#promptLibraryPanel');
    const toast = document.querySelector('#appToast')?.textContent || '';
    return panel
      && !(panel.textContent || '').includes('复习提醒')
      && (panel.textContent || '').includes('暂无自定义模板')
      && toast.includes('模板已删除');
  }, null, { timeout: 5000 });
  const customPromptsStored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('kc_custom_prompts_'));
    return key ? localStorage.getItem(key) || '' : '';
  });
  assert(customPromptsStored === '[]', `custom prompt was not removed from storage: ${customPromptsStored}`);
  await page.fill('#messageInput', '');
}

async function verifyMessageRenderingAndActions(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  const selectBox = await page.locator('#providerSelect').boundingBox();
  assert(selectBox && selectBox.x < 320, `model select should stay in sidebar, got ${JSON.stringify(selectBox)}`);
  const topbarSelectBox = await page.locator('#providerSelectTop').boundingBox();
  assert(topbarSelectBox && topbarSelectBox.x > 320, `top model select should stay in sticky header, got ${JSON.stringify(topbarSelectBox)}`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(100);
  const topbarBox = await page.locator('#chatTopbar').boundingBox();
  assert(topbarBox && topbarBox.y >= -1 && topbarBox.y < 2, `chat topbar is not sticky at viewport top: ${JSON.stringify(topbarBox)}`);
  const sidebarBox = await page.locator('.sidebar').boundingBox();
  assert(
    sidebarBox && sidebarBox.y >= -1 && sidebarBox.y < 2 && sidebarBox.height <= 721,
    `desktop sidebar should stay fixed while scrolling: ${JSON.stringify(sidebarBox)}`
  );
  assert(await page.locator('#topbarRenameBtn:not([disabled])').count() === 1, 'topbar rename action should be enabled');
  assert(await page.locator('#topbarCopyLinkBtn:not([disabled])').count() === 1, 'topbar copy-link action should be enabled');
  assert(await page.locator('#topbarExportMdBtn:not([disabled])').count() === 1, 'topbar markdown export should be enabled');
  assert(await page.locator('#topbarExportPdfBtn:not([disabled])').count() === 1, 'topbar pdf export should be enabled');
  await page.evaluate(() => { window.__copiedText = ''; window.copyText = async (text) => { window.__copiedText = text; }; });
  await page.click('#topbarCopyLinkBtn');
  await page.waitForFunction(() => {
    const copied = window.__copiedText || '';
    return copied.includes('/chat/?c=') && new URL(copied).searchParams.get('c');
  }, null, { timeout: 5000 });
  const topbarDownloadPromise = page.waitForEvent('download');
  await page.click('#topbarExportMdBtn');
  const topbarDownload = await topbarDownloadPromise;
  const topbarMarkdown = fs.readFileSync(await topbarDownload.path(), 'utf8');
  assert(topbarMarkdown.includes('回归-概率公式') && topbarMarkdown.includes('用户题目文本'), 'topbar markdown export incomplete');
  await page.evaluate(() => {
    window.__windowOpenCalled = false;
    window.open = () => {
      window.__windowOpenCalled = true;
      throw new Error('PDF export should download directly without window.open');
    };
  });
  const topbarPdfPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#topbarExportPdfBtn');
  await assertPdfDownload(await topbarPdfPromise, 'topbar pdf');
  assert(await page.evaluate(() => window.__windowOpenCalled === false), 'topbar pdf used window.open instead of direct download');
  await page.waitForFunction(() => document.querySelectorAll('mjx-container').length >= 2, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    return ![...document.querySelectorAll('.message-content')]
      .some((node) => /\\\[|\\\]|\\\(|\\\)|\$\$/.test(node.textContent || ''));
  }, null, { timeout: 10000 });
  assert(!await hasRawMath(page), 'raw math delimiter is visible');
  const assistantMeta = await page.locator('.message.assistant .message-meta').first().innerText();
  assert(assistantMeta.includes('模型：GPT-5.5 深度思考 / gpt-5.5') && assistantMeta.includes('时间：'), `assistant message meta missing: ${assistantMeta}`);
  const sectionLinks = await textList(page, '.message.assistant .answer-section-link');
  assert(sectionLinks.includes('展开公式') && sectionLinks.includes('代码验证'), `answer section nav missing: ${sectionLinks.join(', ')}`);
  await page.locator('.message.assistant [data-answer-section="1"]').click();
  await page.waitForFunction(() => {
    const active = document.querySelector('.message.assistant .answer-section-heading.answer-section-active');
    return active?.textContent?.includes('代码验证');
  }, null, { timeout: 5000 });
  assert(await page.locator('.code-copy-button').count() === 1, 'code copy button missing');
  await page.evaluate(() => { window.__copiedText = ''; window.copyText = async (text) => { window.__copiedText = text; }; });
  await page.click('.code-copy-button');
  await page.waitForFunction(() => window.__copiedText.includes('const x = 1'), null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const toast = document.querySelector('#appToast');
    return toast && !toast.classList.contains('hidden') && toast.textContent.includes('已复制');
  }, null, { timeout: 5000 });
  assert(await page.locator('.message.assistant .math-source-display').count() >= 1, 'copyable display math wrapper missing');
  await page.locator('.message.assistant .math-source-display').first().click();
  await page.waitForFunction(() => window.__copiedText.includes('\\[x^2+2x+1\\]'), null, { timeout: 5000 });
  await page.locator('.message.user [data-copy-message]').click();
  await page.waitForFunction(() => window.__copiedText.includes('用户题目文本'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.message.user [data-copy-message]')?.disabled === false, null, { timeout: 3000 });
  await clickMessageMoreAction(page, '.message.user', '[data-copy-message-link]');
  await page.waitForFunction(() => window.__copiedText.includes('/chat/?c=') && window.__copiedText.includes('&m='), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.message.user [data-copy-message-link]')?.disabled === false, null, { timeout: 3000 });
  await page.evaluate(() => { window.copyText = async () => { throw new Error('clipboard_denied'); }; });
  await page.locator('.message.user [data-copy-message]').click();
  await page.waitForFunction(() => {
    const button = document.querySelector('.message.user [data-copy-message]');
    const status = document.querySelector('#sendStatus');
    const toast = document.querySelector('#appToast');
    return button?.textContent?.includes('复制失败')
      && status?.textContent?.includes('复制失败')
      && toast?.textContent?.includes('复制失败')
      && toast.classList.contains('error');
  }, null, { timeout: 5000 });

  const toolGroups = await textList(page, '.sidebar-tool-group summary');
  assert(
    toolGroups.includes('当前会话')
      && toolGroups.includes('复盘报告')
      && toolGroups.includes('全部会话')
      && toolGroups.includes('工具'),
    `sidebar tool groups missing: ${toolGroups.join(',')}`
  );
  const currentToolGroupWasOpen = await page.locator('.sidebar-tool-group', { hasText: '当前会话' }).evaluate((node) => node.open);
  await page.locator('.sidebar-tool-group', { hasText: '当前会话' }).locator('summary').click();
  await page.waitForFunction((wasOpen) => document.querySelector('.sidebar-tool-group')?.open !== wasOpen, currentToolGroupWasOpen, { timeout: 5000 });
  await page.locator('.sidebar-tool-group', { hasText: '当前会话' }).locator('summary').click();
  await page.waitForFunction((wasOpen) => document.querySelector('.sidebar-tool-group')?.open === wasOpen, currentToolGroupWasOpen, { timeout: 5000 });
  await page.evaluate(() => {
    document.querySelectorAll('.sidebar-tool-group').forEach((group) => {
      group.open = true;
    });
  });

  const downloadPromise = page.waitForEvent('download');
  await clickMessageMoreAction(page, '.message.user', '[data-export-format="md"]');
  const download = await downloadPromise;
  const markdown = fs.readFileSync(await download.path(), 'utf8');
  assert(markdown.includes('## 学生') && markdown.includes('用户题目文本') && markdown.includes('data:image/png'), 'user message markdown export incomplete');
  await page.waitForFunction(() => {
    const toast = document.querySelector('#appToast');
    return toast && !toast.classList.contains('hidden') && toast.textContent.includes('单条消息 MD 已导出');
  }, null, { timeout: 5000 });
  const singleJsonDownloadPromise = page.waitForEvent('download');
  await clickMessageMoreAction(page, '.message.assistant', '[data-export-format="json"]');
  const singleJsonDownload = await singleJsonDownloadPromise;
  const singleJson = JSON.parse(fs.readFileSync(await singleJsonDownload.path(), 'utf8'));
  assert(
    singleJson.format === 'kaoyan-chat.conversation.v1'
      && singleJson.messages.length === 1
      && singleJson.messages[0].role === 'assistant'
      && singleJson.messages[0].content.includes('助手解答公式')
      && /^\d+$/.test(singleJson.student.studentNo || ''),
    'single message json export incomplete'
  );
  const conversationDownloadPromise = page.waitForEvent('download');
  await page.click('#exportMdBtn');
  const conversationDownload = await conversationDownloadPromise;
  const conversationMarkdown = fs.readFileSync(await conversationDownload.path(), 'utf8');
  assert(conversationMarkdown.includes('模型：GPT-5.5 深度思考 / gpt-5.5') && conversationMarkdown.includes('时间：'), 'conversation markdown export missing message meta');
  const conversationJsonDownloadPromise = page.waitForEvent('download');
  await page.click('#exportJsonBtn');
  const conversationJsonDownload = await conversationJsonDownloadPromise;
  const conversationJson = JSON.parse(fs.readFileSync(await conversationJsonDownload.path(), 'utf8'));
  assert(
    conversationJson.format === 'kaoyan-chat.conversation.v1'
      && conversationJson.conversation.title.includes('回归-概率公式')
      && conversationJson.messages.some((item) => item.attachments?.[0]?.dataUrl?.startsWith('data:image/png'))
      && conversationJson.messages.some((item) => item.model_name?.includes('GPT-5.5')),
    'conversation json export incomplete'
  );
  const conversationCsvDownloadPromise = page.waitForEvent('download');
  await page.click('#exportCsvBtn');
  const conversationCsvDownload = await conversationCsvDownloadPromise;
  const conversationCsv = fs.readFileSync(await conversationCsvDownload.path(), 'utf8');
  assert(
    conversationCsv.includes('"conversation_title","conversation_id","role","content","attachments","model","feedback","saved","created_at"')
      && conversationCsv.includes('回归-概率公式')
      && conversationCsv.includes('用户题目文本')
      && conversationCsv.includes('用户题图.png')
      && conversationCsv.includes('GPT-5.5 深度思考 / gpt-5.5'),
    'conversation csv export incomplete'
  );
  const reviewDownloadPromise = page.waitForEvent('download');
  await page.click('#exportReviewMdBtn');
  const reviewDownload = await reviewDownloadPromise;
  const reviewMarkdown = fs.readFileSync(await reviewDownload.path(), 'utf8');
  assert(
    reviewMarkdown.includes('会话复盘')
      && reviewMarkdown.includes('## 复盘摘要')
      && reviewMarkdown.includes('## 重点问题')
      && reviewMarkdown.includes('用户题目文本')
      && reviewMarkdown.includes('\\[x^2+2x+1\\]')
      && reviewMarkdown.includes('## 复习建议'),
    'conversation review markdown export incomplete'
  );
  const allDownloadPromise = page.waitForEvent('download');
  await page.click('#exportAllMdBtn');
  const allDownload = await allDownloadPromise;
  const allMarkdown = fs.readFileSync(await allDownload.path(), 'utf8');
  assert(
    allMarkdown.includes('回归-概率公式')
      && allMarkdown.includes('回归-线性代数')
      && allMarkdown.includes('用户题目文本')
      && allMarkdown.includes('长答案滚动验证')
      && allMarkdown.includes('data:image/png')
      && allMarkdown.includes('模型：GPT-5.5 深度思考 / gpt-5.5'),
    'all conversation markdown export incomplete'
  );
  const allJsonDownloadPromise = page.waitForEvent('download');
  await page.click('#exportAllJsonBtn');
  const allJsonDownload = await allJsonDownloadPromise;
  const allJson = JSON.parse(fs.readFileSync(await allJsonDownload.path(), 'utf8'));
  assert(
    allJson.format === 'kaoyan-chat.archive.v1'
      && allJson.source === 'all-conversations'
      && allJson.conversations.some((record) => record.conversation.title === '回归-概率公式')
      && allJson.conversations.some((record) => record.messages.some((item) => item.content.includes('长答案滚动验证'))),
    'all conversation json export incomplete'
  );
  const allCsvDownloadPromise = page.waitForEvent('download');
  await page.click('#exportAllCsvBtn');
  const allCsvDownload = await allCsvDownloadPromise;
  const allCsv = fs.readFileSync(await allCsvDownload.path(), 'utf8');
  assert(
    allCsv.includes('回归-概率公式')
      && allCsv.includes('回归-线性代数')
      && allCsv.includes('用户题目文本')
      && allCsv.includes('长答案滚动验证'),
    'all conversation csv export incomplete'
  );
  const reviewPdfPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#exportReviewPdfBtn');
  await assertPdfDownload(await reviewPdfPromise, 'conversation review pdf');
  const singlePdfPromise = page.waitForEvent('download', { timeout: 60000 });
  await clickMessageMoreAction(page, '.message.assistant', '[data-export-format="pdf"]');
  await assertPdfDownload(await singlePdfPromise, 'single assistant pdf');
  const allPdfPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#exportAllPdfBtn');
  await assertPdfDownload(await allPdfPromise, 'all conversations pdf');
  const userActions = await textList(page, '.message.user .message-action');
  assert(userActions.includes('编辑'), 'user edit action missing');
  assert(userActions.includes('追问'), 'user quote follow-up action missing');
  assert(userActions.includes('收藏'), 'user save action missing');
  const assistantActions = await textList(page, '.message.assistant .message-action');
  assert(assistantActions.includes('追问'), 'assistant quote follow-up action missing');
  assert(assistantActions.includes('收藏'), 'assistant save action missing');
  assert(assistantActions.includes('重新生成'), 'assistant retry action missing');
  assert(assistantActions.includes('继续回答'), 'assistant continue action missing');
  assert(assistantActions.includes('分支'), 'assistant branch action missing');
  assert(await page.locator('.message.assistant [data-export-format="json"]').count() >= 1, 'assistant json export action missing');
  assert(assistantActions.includes('有用') && assistantActions.includes('需改'), 'assistant feedback actions missing');
  const followUps = await textList(page, '.message.assistant .follow-up-suggestion');
  assert(
    followUps.includes('讲关键')
      && followUps.includes('换种讲法')
      && followUps.includes('同类题')
      && followUps.includes('错题笔记'),
    `assistant follow-up suggestions missing: ${followUps.join(', ')}`
  );
  await page.fill('#messageInput', '');
  await page.locator('.message.assistant [data-follow-up-prompt="method"]').click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return value.includes('请换一种更直观的方法重新讲一遍') && document.activeElement === document.querySelector('#messageInput');
  }, null, { timeout: 5000 });
  const storedFollowUp = await page.evaluate(() => {
    const conversationId = new URL(location.href).searchParams.get('c');
    const key = Object.keys(localStorage).find((item) => item.startsWith('kc_draft_') && item.endsWith(`:${conversationId}`));
    return key ? localStorage.getItem(key) || '' : '';
  });
  assert(storedFollowUp.includes('换一种更直观的方法'), 'follow-up suggestion draft was not saved');
  await page.evaluate(() => { window.__copiedText = ''; window.copyText = async (text) => { window.__copiedText = text; }; });
  await page.fill('#messageInput', '');
  await selectTextInMessage(page, '.message.assistant .message-content', '助手解答公式');
  await page.waitForFunction(() => {
    const toolbar = document.querySelector('#selectionToolbar');
    const rect = toolbar?.getBoundingClientRect();
    return toolbar
      && !toolbar.classList.contains('hidden')
      && rect.left >= 0
      && rect.right <= window.innerWidth
      && rect.top >= 0
      && rect.bottom <= window.innerHeight;
  }, null, { timeout: 5000 });
  await page.locator('#selectionToolbar [data-selection-action="copy"]').click();
  await page.waitForFunction(() => window.__copiedText.includes('助手解答公式'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#selectionToolbar')?.classList.contains('hidden'), null, { timeout: 5000 });
  await page.fill('#messageInput', '');
  await selectTextInMessage(page, '.message.assistant .message-content', '助手解答公式');
  await page.waitForFunction(() => !document.querySelector('#selectionToolbar')?.classList.contains('hidden'), null, { timeout: 5000 });
  await page.locator('#selectionToolbar [data-selection-action="quote"]').click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return value.includes('我选中的这段内容')
      && value.includes('> 助手解答公式')
      && value.includes('我的问题是：')
      && document.querySelector('#selectionToolbar')?.classList.contains('hidden');
  }, null, { timeout: 5000 });
  await page.fill('#messageInput', '');
  await page.locator('.message.assistant [data-quote-message]').first().click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return value.includes('助手回复')
      && value.includes('\\[x^2+2x+1\\]')
      && value.includes('我的问题是：');
  }, null, { timeout: 5000 });
  const storedQuote = await page.evaluate(() => {
    const conversationId = new URL(location.href).searchParams.get('c');
    const key = Object.keys(localStorage).find((item) => item.startsWith('kc_draft_') && item.endsWith(`:${conversationId}`));
    return key ? localStorage.getItem(key) || '' : '';
  });
  assert(storedQuote.includes('助手回复') && storedQuote.includes('我的问题是：'), 'quote follow-up draft was not saved');
  await page.fill('#messageInput', '');
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('.message.user .message-content'), NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.includes('用户题目文本')) node = walker.nextNode();
    if (!node) throw new Error('user message text node missing');
    const start = node.nodeValue.indexOf('用户题目文本');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + '用户题目文本'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('.message.user [data-quote-message]').first().click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#messageInput')?.value || '';
    return value.includes('我选中的这段内容') && value.includes('> 用户题目文本') && !value.includes('求解');
  }, null, { timeout: 5000 });
  await page.fill('#messageInput', '');
  await page.locator('.message.assistant [data-save-message]').first().click();
  await page.waitForFunction(() => {
    const article = document.querySelector('.message.assistant');
    const button = article?.querySelector('[data-save-message]');
    const meta = article?.querySelector('.message-meta')?.textContent || '';
    return article?.classList.contains('saved')
      && button?.classList.contains('active')
      && button?.textContent?.includes('已收藏')
      && meta.includes('已收藏');
  }, null, { timeout: 5000 });
  const savedDownloadPromise = page.waitForEvent('download');
  await clickMessageMoreAction(page, '.message.assistant', '[data-export-format="md"]');
  const savedDownload = await savedDownloadPromise;
  const savedMarkdown = fs.readFileSync(await savedDownload.path(), 'utf8');
  assert(savedMarkdown.includes('已收藏') && savedMarkdown.includes('助手解答公式'), 'saved message markdown export missing saved meta');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => {
    const article = document.querySelector('.message.assistant');
    return article?.classList.contains('saved')
      && article.querySelector('[data-save-message]')?.textContent?.includes('已收藏')
      && (article.querySelector('.message-meta')?.textContent || '').includes('已收藏');
  }, null, { timeout: 10000 });
  await clickMessageMoreAction(page, '.message.assistant', '[data-feedback-value="up"]');
  await page.waitForFunction(() => document.querySelector('.message.assistant [data-feedback-value="up"]')?.classList.contains('active'), null, { timeout: 5000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('.message.assistant [data-feedback-value="up"]')?.classList.contains('active'), null, { timeout: 10000 });
  await clickMessageMoreAction(page, '.message.assistant', '[data-feedback-value="up"]');
  await page.waitForFunction(() => !document.querySelector('.message.assistant [data-feedback-value="up"]')?.classList.contains('active'), null, { timeout: 5000 });
}

async function verifyLongAnswerCollapse(page) {
  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => (document.querySelector('.message.assistant .message-content')?.textContent || '').includes('第 90 步'), null, { timeout: 10000 });
  const actionTexts = await textList(page, '.message.assistant .message-action');
  assert(actionTexts.includes('收起'), `long answer collapse action missing: ${actionTexts.join(',')}`);
  const expandedHeight = await page.locator('.message.assistant .message-content').first().evaluate((node) => node.getBoundingClientRect().height);
  await page.locator('.message.assistant [data-toggle-collapse-message]').click();
  await page.waitForFunction(() => {
    const article = document.querySelector('.message.assistant');
    const button = article?.querySelector('[data-toggle-collapse-message]');
    const content = article?.querySelector('.message-content');
    return article?.classList.contains('message-collapsed')
      && button?.textContent?.includes('展开')
      && button?.getAttribute('aria-expanded') === 'false'
      && content?.getBoundingClientRect().height <= 310;
  }, null, { timeout: 5000 });
  const collapsedHeight = await page.locator('.message.assistant .message-content').first().evaluate((node) => node.getBoundingClientRect().height);
  assert(collapsedHeight < expandedHeight, `collapsed height did not shrink: ${collapsedHeight} >= ${expandedHeight}`);

  const collapsedDownloadPromise = page.waitForEvent('download');
  await clickMessageMoreAction(page, '.message.assistant', '[data-export-format="md"]');
  const collapsedDownload = await collapsedDownloadPromise;
  const collapsedMarkdown = fs.readFileSync(await collapsedDownload.path(), 'utf8');
  assert(collapsedMarkdown.includes('第 90 步：长答案滚动验证。'), 'collapsed message export lost full content');

  await page.locator('.message.assistant [data-toggle-collapse-message]').click();
  await page.waitForFunction(() => {
    const article = document.querySelector('.message.assistant');
    const button = article?.querySelector('[data-toggle-collapse-message]');
    return !article?.classList.contains('message-collapsed')
      && button?.textContent?.includes('收起')
      && button?.getAttribute('aria-expanded') === 'true';
  }, null, { timeout: 5000 });
  const restoredHeight = await page.locator('.message.assistant .message-content').first().evaluate((node) => node.getBoundingClientRect().height);
  assert(restoredHeight > collapsedHeight * 1.5, `expanded height did not restore: ${restoredHeight} vs ${collapsedHeight}`);
}

async function verifySavedMessagesReview(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('.message.assistant.saved [data-save-message]')?.textContent?.includes('已收藏'), null, { timeout: 10000 });
  const savedMessageId = await page.locator('.message.assistant.saved').first().getAttribute('data-message-id');
  await page.click('#savedMessagesBtn');
  await page.waitForFunction((messageId) => {
    const button = document.querySelector('#savedMessagesBtn');
    const list = document.querySelector('#conversationList');
    return button?.classList.contains('active')
      && (list?.textContent || '').includes('已收藏')
      && document.querySelector(`[data-result-message-id="${CSS.escape(messageId)}"]`);
  }, savedMessageId, { timeout: 10000 });
  const savedResultText = await page.locator(`[data-result-message-id="${savedMessageId}"]`).innerText();
  assert(savedResultText.includes('回归-概率公式') && savedResultText.includes('助手解答公式'), `saved result missing content: ${savedResultText}`);
  const savedReviewDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-saved="md"]').click();
  const savedReviewDownload = await savedReviewDownloadPromise;
  const savedReviewMarkdown = fs.readFileSync(await savedReviewDownload.path(), 'utf8');
  assert(
    savedReviewMarkdown.includes('复习收藏')
      && savedReviewMarkdown.includes('回归-概率公式')
      && savedReviewMarkdown.includes('助手解答公式')
      && savedReviewMarkdown.includes('已收藏')
      && !savedReviewMarkdown.includes('矩阵题'),
    'saved review markdown export incomplete'
  );
  const savedJsonDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-saved="json"]').click();
  const savedJsonDownload = await savedJsonDownloadPromise;
  const savedJson = JSON.parse(fs.readFileSync(await savedJsonDownload.path(), 'utf8'));
  assert(
    savedJson.format === 'kaoyan-chat.archive.v1'
      && savedJson.source === 'saved-messages'
      && savedJson.conversations.length === 1
      && savedJson.conversations[0].conversation.title === '回归-概率公式'
      && savedJson.conversations[0].messages.some((item) => item.saved === 1 && item.content.includes('助手解答公式'))
      && !JSON.stringify(savedJson).includes('矩阵题'),
    'saved review json export incomplete'
  );
  const savedCsvDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-saved="csv"]').click();
  const savedCsvDownload = await savedCsvDownloadPromise;
  const savedCsv = fs.readFileSync(await savedCsvDownload.path(), 'utf8');
  assert(
    savedCsv.includes('"conversation_title","conversation_id","role","content","attachments","model","feedback","saved","created_at"')
      && savedCsv.includes('回归-概率公式')
      && savedCsv.includes('助手解答公式')
      && savedCsv.includes('GPT-5.5 深度思考 / gpt-5.5')
      && !savedCsv.includes('矩阵题'),
    'saved review csv export incomplete'
  );
  const savedPdfPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('[data-export-saved="pdf"]').click();
  await assertPdfDownload(await savedPdfPromise, 'saved review pdf');
  await page.locator(`[data-result-message-id="${savedMessageId}"]`).click();
  await page.waitForFunction((messageId) => {
    const article = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    return article?.classList.contains('message-highlight') && article.classList.contains('saved');
  }, savedMessageId, { timeout: 10000 });
  await page.click('#savedMessagesBtn');
  await page.waitForFunction(() => !document.querySelector('#savedMessagesBtn')?.classList.contains('active'), null, { timeout: 5000 });
}

async function verifyJsonImport(page) {
  const payload = {
    app: 'kaoyan-chat',
    format: 'kaoyan-chat.conversation.v1',
    conversation: {
      title: 'JSON恢复测试',
      created_at: '2026-06-08T00:00:00.000Z',
      updated_at: '2026-06-08T00:00:01.000Z'
    },
    messages: [
      {
        role: 'user',
        content: '导入题目：求 \\(u+v\\)。',
        attachments: [{ name: '导入题图.png', dataUrl: IMAGE_DATA_URL }],
        created_at: '2026-06-08T00:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '导入答案：\n\\[u+v\\]',
        model_name: 'GPT-5.5 深度思考 / gpt-5.5',
        feedback: 'up',
        saved: 1,
        created_at: '2026-06-08T00:00:01.000Z'
      }
    ]
  };
  await page.setInputFiles('#importJsonInput', {
    name: 'kaoyan-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf8')
  });
  await page.waitForFunction(() => {
    const toast = document.querySelector('#appToast');
    return toast && !toast.classList.contains('hidden') && toast.textContent.includes('已导入 1 个会话，2 条消息');
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const activeTitle = document.querySelector('.conversation-item.active .conversation-title')?.textContent || '';
    const assistant = document.querySelector('article.message.assistant');
    return activeTitle.includes('导入-JSON恢复测试')
      && document.querySelectorAll('article.message').length === 2
      && document.querySelector('.message-images [data-preview-image]')
      && assistant?.classList.contains('saved')
      && assistant.querySelector('[data-feedback-value="up"]')?.classList.contains('active')
      && assistant.querySelectorAll('mjx-container').length >= 1
      && !/\\\[|\\\]|\\\(|\\\)|\$\$/.test(assistant.querySelector('.message-content')?.textContent || '');
  }, null, { timeout: 10000 });
  const importedActions = await textList(page, '.message.assistant .message-action');
  assert(importedActions.includes('JSON') && importedActions.includes('已收藏'), `imported assistant actions incomplete: ${importedActions.join(',')}`);
}

async function verifyContinueAnswer(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.message.assistant .message-action')].some((node) => node.textContent.includes('继续回答')), null, { timeout: 10000 });
  await page.evaluate((imageDataUrl) => {
    window.__continueRealFetch = window.fetch.bind(window);
    window.__continueMock = null;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const urlText = String(url);
      if (urlText.endsWith('/api/chat/continue')) {
        const body = JSON.parse(init.body || '{}');
        window.__continueMock = {
          conversationId: body.conversationId,
          messageId: body.messageId
        };
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
            send('meta', { conversationId: body.conversationId, continueOf: body.messageId });
            setTimeout(() => send('delta', { text: '续写公式：\n' }), 20);
            setTimeout(() => send('delta', { text: '\\[y=2\\]' }), 60);
            setTimeout(() => {
              send('done', {
                conversationId: body.conversationId,
                continueOf: body.messageId,
                assistantMessageId: 'msg_verify_continue_assistant',
                assistantCreatedAt: '2026-06-08T00:00:00.000Z',
                assistantModelName: 'GPT-5.5 深度思考 / gpt-5.5'
              });
              controller.close();
            }, 120);
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      if (window.__continueMock && urlText.includes(`/api/conversations/${window.__continueMock.conversationId}/messages`)) {
        return Promise.resolve(new Response(JSON.stringify({
          conversation: { id: window.__continueMock.conversationId, title: '回归-概率公式', model_id: null },
          messages: [
            { id: 'msg_verify_continue_user', role: 'user', content: '用户题目文本：求解 \\(x+1)^2\\)。', attachments: [{ name: '用户题图.png', dataUrl: imageDataUrl }] },
            { id: window.__continueMock.messageId, role: 'assistant', content: '助手解答公式：\n\\[x^2+2x+1\\]', attachments: [], model_name: 'GPT-5.5 深度思考 / gpt-5.5', created_at: '2026-06-08T00:00:00.000Z' },
            { id: 'msg_verify_continue_assistant', role: 'assistant', content: '续写公式：\n\\[y=2\\]', attachments: [], model_name: 'GPT-5.5 深度思考 / gpt-5.5', created_at: '2026-06-08T00:00:01.000Z' }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return window.__continueRealFetch(input, init);
    };
  }, IMAGE_DATA_URL);

  try {
    await page.locator('.message.assistant [data-continue-message]:not([disabled])').first().click();
    await page.waitForFunction(() => {
      const last = document.querySelector('article.message.assistant:last-of-type .message-content');
      return last
        && (last.textContent || '').includes('续写公式')
        && last.querySelectorAll('mjx-container').length >= 1
        && !/\\\[|\\\]|\\\(|\\\)|\$\$/.test(last.textContent || '');
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#sendBtn')?.disabled === false, null, { timeout: 10000 });
    assert(!/data is not defined|发送失败/.test(await page.locator('#messages').innerText()), 'continue stream finished with a false failure');
    const actions = await textList(page, 'article.message.assistant:last-of-type .message-action');
    assert(actions.includes('复制') && actions.includes('重新生成') && actions.includes('继续回答') && actions.includes('链接'), `continued assistant actions incomplete: ${actions.join(',')}`);
    const mock = await page.evaluate(() => window.__continueMock);
    assert(mock?.conversationId && mock?.messageId && !String(mock.messageId).startsWith('local_'), `continue request did not target saved assistant: ${JSON.stringify(mock)}`);
  } finally {
    await page.evaluate(() => {
      if (window.__continueRealFetch) window.fetch = window.__continueRealFetch;
      window.__continueMock = null;
    }).catch(() => {});
  }
}

async function verifyStreamingFormulaNoRefresh(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.evaluate(() => {
    window.__streamFormulaRealFetch = window.fetch.bind(window);
    window.__streamFormulaStarted = false;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const urlText = String(url);
      if (urlText.endsWith('/api/chat')) {
        window.__streamFormulaStarted = true;
        const body = JSON.parse(init.body || '{}');
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
            send('meta', {
              conversationId: body.conversationId,
              userMessageId: 'msg_verify_stream_user',
              conversationTitle: '流式公式测试'
            });
            setTimeout(() => send('delta', { text: '流式公式：\n' }), 20);
            setTimeout(() => send('delta', { text: '\\[a^2+b^2=c^2\\]' }), 60);
            setTimeout(() => {
              send('done', {
                conversationId: body.conversationId,
                userMessageId: 'msg_verify_stream_user',
                assistantMessageId: 'msg_verify_stream_assistant',
                assistantCreatedAt: '2026-06-08T00:00:00.000Z',
                assistantModelName: 'GPT-5.5 深度思考 / gpt-5.5'
              });
              controller.close();
            }, 4200);
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      if (window.__streamFormulaStarted && (urlText.endsWith('/api/conversations') || /\/api\/conversations\/[^/]+\/messages$/.test(urlText))) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(window.__streamFormulaRealFetch(input, init)), 1500);
        });
      }
      return window.__streamFormulaRealFetch(input, init);
    };
  });

  try {
    await page.click('#newConversationBtn');
    await page.waitForFunction(() => (document.querySelector('#messages')?.textContent || '').includes('今天想攻克哪道题'), null, { timeout: 10000 });
    await page.fill('#messageInput', '流式公式测试');
    await page.click('#sendBtn');
    await page.waitForFunction(() => {
      const article = document.querySelector('article.message.assistant:last-of-type');
      const content = article?.querySelector('.message-content');
      const thinking = article?.querySelector('.think-text')?.textContent || '';
      return content
        && !thinking.includes('完成')
        && content.querySelectorAll('mjx-container').length >= 1
        && !/\\\[|\\\]|\\\(|\\\)|\$\$/.test(content.textContent || '');
    }, null, { timeout: 7000 });
    await page.waitForFunction(() => {
      const article = document.querySelector('article.message.assistant:last-of-type');
      return (article?.querySelector('.think-text')?.textContent || '').includes('完成');
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const content = document.querySelector('article.message.assistant:last-of-type .message-content');
      return content
        && content.querySelectorAll('mjx-container').length >= 1
        && !/\\\[|\\\]|\\\(|\\\)|\$\$/.test(content.textContent || '');
    }, null, { timeout: 10000 });
    const actions = await textList(page, 'article.message.assistant:last-of-type .message-action');
    assert(actions.includes('复制') && actions.includes('重新生成') && actions.includes('继续回答') && actions.includes('链接'), `streamed assistant actions incomplete: ${actions.join(',')}`);
    await page.waitForFunction(() => document.querySelector('#sendBtn')?.disabled === false, null, { timeout: 10000 });
    assert(!/data is not defined|发送失败/.test(await page.locator('#messages').innerText()), 'normal stream finished with a false failure');
  } finally {
    await page.evaluate(() => {
      if (window.__streamFormulaRealFetch) window.fetch = window.__streamFormulaRealFetch;
      window.__streamFormulaStarted = false;
    }).catch(() => {});
  }
}

async function verifyImagePreview(page) {
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForSelector('.message-images [data-preview-image]', { timeout: 10000 });
  await page.click('.message-images [data-preview-image]');
  await page.waitForFunction(() => !document.querySelector('#imagePreview')?.classList.contains('hidden'), null, { timeout: 5000 });
  const title = await page.locator('#imagePreviewTitle').innerText();
  assert(title.includes('用户题图'), `image preview title mismatch: ${title}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#imagePreview')?.classList.contains('hidden'), null, { timeout: 5000 });
}

async function verifyEditMessage(page) {
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__editMock = null;
    window.__editMockMode = 'success';
    window.__savedEditMessage = '用户题目文本：求解 \\(x+1)^2\\)。';
    window.__savedEditAnswer = '助手解答公式：\\n\\[x^2+2x+1\\]';
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const urlText = String(url);
      if (urlText.endsWith('/api/chat/edit')) {
        const body = JSON.parse(init.body || '{}');
        window.__editMock = {
          conversationId: body.conversationId,
          messageId: body.messageId,
          message: body.message
        };
        if (window.__editMockMode === 'success') {
          window.__savedEditMessage = body.message;
          window.__savedEditAnswer = '编辑后的回答\\n\\[z=1\\]';
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
            send('meta', { conversationId: body.conversationId, userMessageId: body.messageId });
            if (window.__editMockMode === 'abort') {
              send('delta', { text: '编辑停止中的临时回答' });
              return;
            }
            send('delta', { text: '编辑后的回答\\n\\[z=1\\]' });
            send('done', { conversationId: body.conversationId });
            controller.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      if (window.__editMock && urlText.includes(`/api/conversations/${window.__editMock.conversationId}/messages`)) {
        return Promise.resolve(new Response(JSON.stringify({
          conversation: { id: window.__editMock.conversationId, title: '回归-概率公式', model_id: null },
          messages: [
            { id: window.__editMock.messageId, role: 'user', content: window.__savedEditMessage, attachments: [] },
            { id: 'msg_verify_edit_assistant', role: 'assistant', content: window.__savedEditAnswer, attachments: [] }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  });

  await page.locator('.message.user [data-edit-message]').first().click();
  await page.waitForSelector('.message-edit-input', { timeout: 5000 });
  await page.fill('.message-edit-input', '编辑后的题目：计算 \\(z+1\\)');
  await page.locator('[data-submit-edit-message]').click();
  await page.waitForFunction(() => (document.querySelector('#sendBtn')?.disabled === false), null, { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector('.message.user .message-content')?.textContent || '').includes('编辑后的题目'), null, { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector('.message.assistant .message-content')?.textContent || '').includes('编辑后的回答'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('mjx-container').length >= 1, null, { timeout: 10000 });
  assert(!/data is not defined|发送失败|修改并重问失败/.test(await page.locator('#messages').innerText()), 'edit stream finished with a false failure');

  await page.evaluate(() => { window.__editMockMode = 'abort'; });
  await page.locator('.message.user [data-edit-message]').first().click();
  await page.waitForSelector('.message-edit-input', { timeout: 5000 });
  await page.fill('.message-edit-input', '不应保留的临时编辑');
  await page.locator('[data-submit-edit-message]').click();
  await page.waitForSelector('#stopBtn:not(.hidden)', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#sendBtn')?.disabled === false, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('.message.user .message-content')?.textContent || '';
    return text.includes('编辑后的题目') && !text.includes('不应保留的临时编辑');
  }, null, { timeout: 10000 });
}

async function verifySmartScroll(page) {
  await page.locator('.conversation-title', { hasText: '回归-线性代数' }).click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#messages')?.textContent || '';
    return text.includes('矩阵题') && text.includes('第 90 步');
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => window.scrollY > 100, null, { timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollMessages && window.scrollMessages());
  await page.waitForTimeout(250);
  const pinned = await page.evaluate(() => ({
    scrollY: window.scrollY,
    buttonHidden: document.querySelector('#scrollBottomBtn')?.classList.contains('hidden')
  }));
  assert(pinned.scrollY === 0 && pinned.buttonHidden === false, `smart scroll failed: ${JSON.stringify(pinned)}`);
  await page.click('#scrollBottomBtn');
  await page.waitForTimeout(250);
  const nearBottom = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 180);
  assert(nearBottom, 'scroll bottom button did not reach bottom');
}

async function verifyAutoTitleSync(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!String(url).endsWith('/api/chat')) return realFetch(input, init);
      const body = JSON.parse(init.body || '{}');
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          send('meta', {
            conversationId: body.conversationId,
            userMessageId: 'msg_verify_auto_title_user',
            conversationTitle: '自动命名测试：求函数极限'
          });
          send('delta', { text: '自动命名回答。' });
          send('done', { conversationId: body.conversationId });
          controller.close();
        }
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  });
  const beforeNewConversationId = await page.evaluate(() => new URL(location.href).searchParams.get('c') || '');
  await page.click('#newConversationBtn');
  await page.waitForFunction((previousId) => {
    const currentId = new URL(location.href).searchParams.get('c') || '';
    const activeTitle = document.querySelector('.conversation-item.active .conversation-title')?.textContent || '';
    return currentId && currentId !== previousId && activeTitle.includes('新的答疑');
  }, beforeNewConversationId, { timeout: 30000 });
  await page.fill('#messageInput', '自动命名测试：求函数极限');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.conversation-title')].some((node) => node.textContent.includes('自动命名测试：求函数极限')), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#messageInput')?.value === '', null, { timeout: 5000 });
  assert(!/data is not defined|发送失败/.test(await page.locator('#messages').innerText()), 'auto-title stream finished with a false failure');
  const historyStored = await page.evaluate(() => {
    const studentNo = document.querySelector('.student-meta')?.textContent?.match(/\d+/)?.[0] || 'guest';
    const value = localStorage.getItem(`kc_composer_history_${studentNo}`) || '[]';
    return JSON.parse(value);
  });
  assert(Array.isArray(historyStored) && historyStored[0] === '自动命名测试：求函数极限', 'composer history did not persist latest send');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#messageInput', { timeout: 10000 });
  await page.focus('#messageInput');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('#messageInput')?.value === '自动命名测试：求函数极限', null, { timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('#messageInput')?.value === '', null, { timeout: 5000 });
}

async function verifyFailedSendRetryAction(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__failedRetryMock = { chatCalls: 0, retryCalls: 0, conversationId: '', retryBody: null };
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const urlText = String(url);
      if (urlText.endsWith('/api/chat')) {
        const body = JSON.parse(init.body || '{}');
        window.__failedRetryMock.chatCalls += 1;
        window.__failedRetryMock.conversationId = body.conversationId;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            send('meta', {
              conversationId: body.conversationId,
              userMessageId: 'msg_verify_failed_user',
              conversationTitle: '失败重试测试'
            });
            send('error', { message: '模拟上游失败' });
            send('done', { conversationId: body.conversationId, userMessageId: 'msg_verify_failed_user' });
            controller.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      if (urlText.endsWith('/api/chat/retry')) {
        const body = JSON.parse(init.body || '{}');
        window.__failedRetryMock.retryCalls += 1;
        window.__failedRetryMock.retryBody = body;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            send('meta', { conversationId: body.conversationId, userMessageId: body.userMessageId });
            send('delta', { text: '重试成功\n\\[r=1\\]' });
            send('done', {
              conversationId: body.conversationId,
              userMessageId: body.userMessageId,
              assistantMessageId: 'msg_verify_failed_retry_assistant',
              assistantCreatedAt: '2026-06-08T00:00:00.000Z',
              assistantModelName: 'GPT-5.5 深度思考 / gpt-5.5'
            });
            controller.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      const mock = window.__failedRetryMock;
      if (mock?.retryBody && urlText.includes(`/api/conversations/${mock.conversationId}/messages`)) {
        return Promise.resolve(new Response(JSON.stringify({
          conversation: { id: mock.conversationId, title: '失败重试测试', model_id: null },
          messages: [
            { id: 'msg_verify_failed_user', role: 'user', content: '失败后重试测试', attachments: [] },
            { id: 'msg_verify_failed_retry_assistant', role: 'assistant', content: '重试成功\n\\[r=1\\]', attachments: [], model_name: 'GPT-5.5 深度思考 / gpt-5.5', created_at: '2026-06-08T00:00:00.000Z' }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  });

  const beforeNewConversationId = await page.evaluate(() => new URL(location.href).searchParams.get('c') || '');
  await page.click('#newConversationBtn');
  await page.waitForFunction((previousId) => {
    const currentId = new URL(location.href).searchParams.get('c') || '';
    const activeTitle = document.querySelector('.conversation-item.active .conversation-title')?.textContent || '';
    return currentId && currentId !== previousId && activeTitle.includes('新的答疑');
  }, beforeNewConversationId, { timeout: 30000 });
  await page.fill('#messageInput', '失败后重试测试');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => {
    const last = document.querySelector('article.message.assistant:last-of-type');
    return (last?.textContent || '').includes('模拟上游失败')
      && last.querySelector('[data-retry-message]:not([disabled])')
      && document.querySelector('#sendBtn')?.disabled === false;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
  await page.locator('article.message.assistant').last().locator('[data-retry-message]:not([disabled])').first().click();
  await page.waitForFunction(() => {
    const last = document.querySelector('article.message.assistant:last-of-type');
    return (last?.textContent || '').includes('重试成功')
      && last.querySelectorAll('mjx-container').length >= 1
      && !/模拟上游失败|data is not defined|发送失败/.test(last?.textContent || '');
  }, null, { timeout: 30000 });
  const retryMock = await page.evaluate(() => window.__failedRetryMock);
  assert(retryMock.chatCalls === 1 && retryMock.retryCalls === 1, `failed retry call counts wrong: ${JSON.stringify(retryMock)}`);
  assert(retryMock.retryBody?.userMessageId === 'msg_verify_failed_user', `failed retry did not target failed user message: ${JSON.stringify(retryMock.retryBody)}`);
}

async function verifyStopGeneration(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!String(url).endsWith('/api/chat')) return realFetch(input, init);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
          send('meta', { conversationId: 'conv_verify_stop' });
          send('delta', { text: '停止测试\\n\\[a^2+b^2=c^2\\]' });
        }
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  });
  await page.fill('#messageInput', '停止生成测试');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('#stopBtn:not(.hidden)', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (document.querySelector('.message.assistant:last-of-type .message-content')?.textContent || '').includes('已停止生成'), null, { timeout: 5000 });
  const stopped = await page.evaluate(() => ({
    sendDisabled: document.querySelector('#sendBtn')?.disabled,
    stopHidden: document.querySelector('#stopBtn')?.classList.contains('hidden')
  }));
  assert(!stopped.sendDisabled && stopped.stopHidden, `stop generation state failed: ${JSON.stringify(stopped)}`);
}

async function verifyBranchConversation(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
  await page.locator('.conversation-title', { hasText: '回归-概率公式' }).click();
  await page.waitForFunction(() => document.querySelector('.message.assistant [data-branch-message]:not([disabled])'), null, { timeout: 10000 });
  const originalConversationId = await page.evaluate(() => new URL(location.href).searchParams.get('c'));
  const originalAssistantId = await page.locator('.message.assistant').first().getAttribute('data-message-id');
  await clickMessageMoreAction(page, '.message.assistant', '[data-branch-message]:not([disabled])');
  await page.waitForFunction((originalId) => {
    const active = document.querySelector('.conversation-item.active');
    const currentId = new URL(location.href).searchParams.get('c');
    return active?.textContent?.includes('分支') && currentId && currentId !== originalId;
  }, originalConversationId, { timeout: 10000 });
  await page.waitForFunction((assistantId) => {
    return assistantId
      && !document.querySelector(`[data-message-id="${CSS.escape(assistantId)}"]`)
      && document.querySelectorAll('article.message').length === 2;
  }, originalAssistantId, { timeout: 10000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('#messages')?.textContent || '';
    return text.includes('用户题目文本') && text.includes('助手解答公式') && !text.includes('矩阵题');
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('mjx-container').length >= 2, null, { timeout: 10000 });
  const branchState = await page.evaluate(() => ({
    title: document.querySelector('.conversation-item.active .conversation-title')?.textContent || '',
    articleCount: document.querySelectorAll('article.message').length,
    mathCount: document.querySelectorAll('mjx-container').length
  }));
  assert(branchState.title.includes('分支'), `branch title missing: ${JSON.stringify(branchState)}`);
  assert(branchState.articleCount === 2, `branch should copy through selected assistant only: ${JSON.stringify(branchState)}`);
  assert(branchState.mathCount >= 2, `branch math did not render: ${JSON.stringify(branchState)}`);
}

async function verifyMobileLayout(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.removeItem('kc_sidebar_collapsed'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#messageInput', { timeout: 10000 });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    sidebarCollapsed: document.querySelector('.layout')?.classList.contains('sidebar-collapsed'),
    sidebarHeight: document.querySelector('.sidebar')?.getBoundingClientRect().height || 0,
    inputVisible: Boolean(document.querySelector('#messageInput')?.getBoundingClientRect().height),
    sendVisible: Boolean(document.querySelector('#sendBtn')?.getBoundingClientRect().height),
    columns: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns
  }));
  assert(metrics.scrollWidth <= metrics.viewportWidth + 2, `mobile layout overflows: ${JSON.stringify(metrics)}`);
  assert(metrics.sidebarCollapsed && metrics.sidebarHeight < 90, `fresh mobile sidebar should be compact: ${JSON.stringify(metrics)}`);
  assert(metrics.inputVisible && metrics.sendVisible, `mobile composer missing: ${JSON.stringify(metrics)}`);
  assert(!metrics.columns.includes('288px'), `mobile sidebar did not collapse to one column: ${JSON.stringify(metrics)}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#conversationSearch', { timeout: 10000 });
}

async function verifyAdminFeedback(page) {
  const login = await requestWithRetry(() => page.request.post(`${BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
    timeout: 60000
  }), 'admin api login');
  assert(login.ok(), `admin api login failed: ${login.status()} ${await login.text()}`);
  await page.goto(`${BASE}/admin?verify=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#feedbackList') || document.querySelector('#adminPassword'), null, { timeout: 30000 });
  if (await page.locator('#adminPassword').count()) {
    await page.fill('#adminPassword', ADMIN_PASSWORD);
    await page.locator('#adminLoginForm button[type="submit"]').click();
  }
  await page.waitForSelector('#feedbackList', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => {
    const stats = document.querySelector('#adminStats')?.textContent || '';
    const list = document.querySelector('#feedbackList')?.textContent || '';
    return stats.includes('需改') && list.includes('回归-线性代数') && list.includes('需改');
  }, null, { timeout: 30000 });
  const feedbackText = await page.locator('#feedbackList').innerText();
  assert(feedbackText.includes('第 1 步') || feedbackText.includes('长答案滚动验证'), `admin feedback excerpt missing: ${feedbackText}`);
}

async function requestWithRetry(run, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

async function dropImageOnComposer(page, name) {
  await page.evaluate(({ dataUrl, filename }) => {
    const target = document.querySelector('.composer-inner');
    if (!target) throw new Error('composer target missing');
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0));
    const file = new File([bytes], filename, { type: 'image/png' });
    const transfer = {
      types: ['Files'],
      files: [file],
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      dropEffect: 'copy'
    };
    for (const eventName of ['dragenter', 'dragover', 'drop']) {
      const event = new DragEvent(eventName, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
    }
  }, { dataUrl: IMAGE_DATA_URL, filename: name });
}

async function hasRawMath(page) {
  return page.evaluate(() => [...document.querySelectorAll('.message-content')].some((node) => /\\\[|\\\]|\\\(|\\\)|\$\$/.test(node.textContent || '')));
}

async function textList(page, selector) {
  return page.$$eval(selector, (nodes) => nodes.map((node) => node.textContent.trim()).filter(Boolean));
}

async function assertPdfDownload(download, label) {
  const filename = download.suggestedFilename();
  assert(/\.pdf$/i.test(filename), `${label} filename should end with .pdf: ${filename}`);
  const filePath = await download.path();
  const buffer = fs.readFileSync(filePath);
  assert(buffer.length > 1200, `${label} pdf is too small: ${buffer.length}`);
  assert(buffer.slice(0, 4).toString('utf8') === '%PDF', `${label} did not download a PDF file`);
}

async function openSidebarToolGroup(page, label) {
  const group = page.locator('.sidebar-tool-group', { hasText: label }).first();
  if (await group.count()) await group.evaluate((node) => { node.open = true; });
}

async function openMessageMore(page, messageSelector, index = -1) {
  const detailsSelector = `${messageSelector} .message-more`;
  await page.waitForSelector(detailsSelector, { timeout: 10000 });
  await page.waitForFunction(({ detailsSelector: selector, targetIndex }) => {
    const nodes = [...document.querySelectorAll(selector)];
    const targets = targetIndex < 0 ? nodes : [nodes[targetIndex]].filter(Boolean);
    if (!targets.length) return false;
    for (const node of targets) node.open = true;
    return targets.every((node) => (
      node.open
        && [...node.querySelectorAll('button')].some((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
    ));
  }, { detailsSelector, targetIndex: index }, { timeout: 10000 });
}

async function clickMessageMoreAction(page, messageSelector, actionSelector, index = -1) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await openMessageMore(page, messageSelector, index);
      await page.locator(`${messageSelector} .message-more[open] ${actionSelector}`).first().click({ timeout: 5000 });
      return;
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(250 + attempt * 150);
    }
  }
  throw lastError;
}

async function selectTextInMessage(page, selector, text) {
  await page.evaluate(({ selector: targetSelector, text: targetText }) => {
    const root = document.querySelector(targetSelector);
    if (!root) throw new Error(`selection root missing: ${targetSelector}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.includes(targetText)) node = walker.nextNode();
    if (!node) throw new Error(`selection text missing: ${targetText}`);
    const start = node.nodeValue.indexOf(targetText);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + targetText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { selector, text });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
