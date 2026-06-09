const BASE = '/chat';
const API = `${BASE}/api`;
const DRAFT_PREFIX = 'kc_draft_';
const COMPOSER_HISTORY_PREFIX = 'kc_composer_history_';
const COMPOSER_HISTORY_LIMIT = 30;
const CUSTOM_PROMPTS_PREFIX = 'kc_custom_prompts_';
const CUSTOM_PROMPT_LIMIT = 24;
const CUSTOM_PROMPT_TEXT_LIMIT = 1600;
const DELETE_UNDO_MS = 5000;
const QUICK_PROMPTS = [
  { id: 'steps', label: '分步骤', text: '请按「思路 → 关键公式 → 计算步骤 → 易错点」分步骤讲解。' },
  { id: 'key', label: '只讲关键', text: '请只讲本题最关键的一步，以及为什么这样想。' },
  { id: 'similar', label: '同类题', text: '请基于这道题再出 1 道同类题，并给出答案。' },
  { id: 'note', label: '错题笔记', text: '请整理成错题笔记：考点、易错点、正确思路、可复习公式。' },
  { id: 'check', label: '检查答案', text: '请检查我的解法是否正确，并指出第一处需要修改的地方。' }
];
const FOLLOW_UP_PROMPTS = [
  { id: 'key', label: '讲关键', text: '请针对刚才这道题，只讲最关键的一步和为什么。' },
  { id: 'method', label: '换种讲法', text: '请换一种更直观的方法重新讲一遍，并少用跳步。' },
  { id: 'similar', label: '同类题', text: '请基于刚才这道题再出 1 道同类题，并给出完整答案。' },
  { id: 'note', label: '错题笔记', text: '请把刚才这道题整理成错题笔记：考点、易错点、正确思路、可复习公式。' }
];

const state = {
  student: null,
  conversations: [],
  conversationQuery: '',
  messageSearch: { query: '', loading: false, results: [], error: '' },
  savedMessages: { open: false, loading: false, results: [], error: '' },
  studyMemory: { open: false, loading: false, error: '' },
  promptLibraryOpen: false,
  commandPalette: { open: false, query: '', index: 0 },
  customPrompts: [],
  showArchived: false,
  slashPromptMenu: { open: false, query: '', index: 0, matches: [] },
  selectionToolbar: { open: false, messageId: '', role: '', text: '', left: 0, top: 0, placement: 'above' },
  composerHistory: { items: [], index: -1, draft: '' },
  conversationFindQuery: '',
  conversationFindIndex: -1,
  sidebarCollapsed: loadStoredSidebarCollapsed(),
  theme: loadStoredTheme(),
  currentConversationId: null,
  currentConversationTitle: '答疑会话',
  currentMessages: [],
  providers: [],
  currentProviderId: null,
  sending: false,
  autoScroll: true,
  abortController: null,
  attachmentDrafts: new Map(),
  pendingDeletes: new Map(),
  activeUndoDeleteId: null,
  attachments: []
};

applyTheme(state.theme);

const streamingRenderTimers = new WeakMap();
const mathRecoveryAttempts = new WeakMap();
const messageContents = new Map();
let messageSearchTimer = null;
let mathJaxReadyPromise = null;
let mathJaxTypesetQueue = Promise.resolve();
let composerDragDepth = 0;
let selectionToolbarFrame = 0;
let appToastTimer = 0;
const localRetrySources = new Map();

window.addEventListener('kc:mathjax-ready', handleMathJaxReady);

document.addEventListener('DOMContentLoaded', () => {
  if (location.pathname.endsWith('/admin')) initAdmin();
  else initChat();
});

async function initChat() {
  renderAppLoading();
  try {
    const me = await api('/me');
    state.student = me.student;
    state.composerHistory = { items: loadComposerHistory(), index: -1, draft: '' };
    state.customPrompts = loadCustomPrompts();
    if (state.student?.needsPasswordSetup) {
      renderStudentPasswordSetup();
      return;
    }
    await Promise.all([loadProviders(), loadConversations()]);
    renderChatShell();
    const routeTarget = initialRouteTarget();
    const targetConversation = routeTarget.conversationId && state.conversations.some((item) => item.id === routeTarget.conversationId)
      ? routeTarget.conversationId
      : state.conversations[0]?.id;
    if (targetConversation) await selectConversation(targetConversation, { highlightMessageId: routeTarget.messageId, replaceRoute: true });
    else renderMessages([]);
    bindRouteEvents();
  } catch {
    renderStudentLogin();
  }
}

function renderAppLoading() {
  el('#app').innerHTML = '<div class="app-loading">正在载入答疑...</div>';
}

function renderStudentLogin() {
  el('#app').innerHTML = `
    <main class="login-page">
      <form class="login-card" id="studentLoginForm">
        <h1>考研答疑</h1>
        <p>请输入学号和密码。首次登录请设置密码并再次确认。</p>
        <div class="form-field">
          <label for="studentNo">学号</label>
          <input class="input" id="studentNo" autocomplete="username" placeholder="例如 2702142 或 202702001" required />
        </div>
        <div class="form-field">
          <label for="studentPassword">密码</label>
          <input class="input" id="studentPassword" type="password" autocomplete="current-password" minlength="6" maxlength="128" required />
        </div>
        <div class="form-field">
          <label for="studentPasswordConfirm">确认密码</label>
          <input class="input" id="studentPasswordConfirm" type="password" autocomplete="new-password" minlength="6" maxlength="128" placeholder="首次登录填写" />
        </div>
        <button class="btn primary" type="submit">进入答疑</button>
        <div class="status" id="loginStatus"></div>
      </form>
    </main>`;
  el('#studentLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = el('#loginStatus');
    status.textContent = '正在登录...';
    status.className = 'status';
    try {
      await api('/login', {
        method: 'POST',
        body: {
          studentNo: el('#studentNo').value.trim(),
          password: el('#studentPassword').value,
          passwordConfirm: el('#studentPasswordConfirm').value
        }
      });
      await initChat();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status error';
    }
  });
}

function renderStudentPasswordSetup() {
  el('#app').innerHTML = `
    <main class="login-page">
      <form class="login-card" id="studentPasswordForm">
        <h1>设置登录密码</h1>
        <p>学号 ${escapeHtml(state.student?.studentNo || '')} 需要先设置密码，之后才能进入答疑和读取历史记忆。</p>
        <div class="form-field">
          <label for="newStudentPassword">密码</label>
          <input class="input" id="newStudentPassword" type="password" autocomplete="new-password" minlength="6" maxlength="128" required />
        </div>
        <div class="form-field">
          <label for="newStudentPasswordConfirm">确认密码</label>
          <input class="input" id="newStudentPasswordConfirm" type="password" autocomplete="new-password" minlength="6" maxlength="128" required />
        </div>
        <button class="btn primary" type="submit">保存并进入</button>
        <button class="btn ghost" id="passwordSetupLogoutBtn" type="button">退出</button>
        <div class="status" id="passwordSetupStatus"></div>
      </form>
    </main>`;
  el('#passwordSetupLogoutBtn')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST', body: {} });
    state.student = null;
    renderStudentLogin();
  });
  el('#studentPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = el('#passwordSetupStatus');
    status.textContent = '正在保存...';
    status.className = 'status';
    try {
      await api('/password', {
        method: 'POST',
        body: {
          password: el('#newStudentPassword').value,
          passwordConfirm: el('#newStudentPasswordConfirm').value
        }
      });
      await initChat();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status error';
    }
  });
}

function renderChatShell() {
  const student = state.student;
  el('#app').innerHTML = `
    <div class="layout ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="brand-row">
            <h1 class="brand-title">考研答疑</h1>
            <div class="brand-actions">
              <button class="sidebar-toggle" id="sidebarToggleBtn" type="button" aria-expanded="${state.sidebarCollapsed ? 'false' : 'true'}" title="${state.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}">${state.sidebarCollapsed ? '展开' : '收起'}</button>
              <button class="btn" id="newConversationBtn" type="button">新建</button>
            </div>
          </div>
          <div class="student-meta">${student ? `学号：${escapeHtml(student.studentNo)}` : '未登录'}</div>
          <select class="model-select sidebar-model-select" id="providerSelect" data-provider-select="true"></select>
          <input class="input sidebar-search" id="conversationSearch" placeholder="搜索会话或消息" value="${escapeAttr(state.conversationQuery)}" />
          <div class="conversation-find">
            <input class="input conversation-find-input" id="conversationFind" placeholder="查找当前会话" value="${escapeAttr(state.conversationFindQuery)}" />
            <div class="conversation-find-actions">
              <button class="conversation-find-button" id="conversationFindPrev" type="button">上一个</button>
              <button class="conversation-find-button" id="conversationFindNext" type="button">下一个</button>
              <button class="conversation-find-button" id="conversationFindClear" type="button">清空</button>
              <span class="conversation-find-count" id="conversationFindCount"></span>
            </div>
          </div>
          <button class="saved-messages-toggle ${state.savedMessages.open ? 'active' : ''}" id="savedMessagesBtn" type="button" aria-pressed="${state.savedMessages.open ? 'true' : 'false'}">${state.savedMessages.open ? '关闭复习收藏' : '复习收藏'}</button>
          <button class="archive-conversations-toggle ${state.showArchived ? 'active' : ''}" id="archiveConversationsBtn" type="button" aria-pressed="${state.showArchived ? 'true' : 'false'}">${state.showArchived ? '返回当前会话' : '归档会话'}</button>
          <button class="study-memory-toggle ${state.studyMemory.open ? 'active' : ''}" id="studyMemoryBtn" type="button" aria-pressed="${state.studyMemory.open ? 'true' : 'false'}">${state.studyMemory.open ? '关闭学习记忆' : '学习记忆'}</button>
          <div class="message-outline hidden" id="messageOutline"></div>
        </div>
        <div class="conversation-list" id="conversationList"></div>
        <div class="sidebar-footer">
          <details class="sidebar-tool-group">
            <summary>当前会话</summary>
            <div class="sidebar-tool-grid">
              <button class="btn ghost" id="exportMdBtn" type="button">MD</button>
              <button class="btn ghost" id="exportPdfBtn" type="button">PDF</button>
              <button class="btn ghost" id="exportJsonBtn" type="button">JSON</button>
              <button class="btn ghost" id="exportCsvBtn" type="button">CSV</button>
            </div>
          </details>
          <details class="sidebar-tool-group">
            <summary>复盘报告</summary>
            <div class="sidebar-tool-grid">
              <button class="btn ghost" id="exportReviewMdBtn" type="button">MD</button>
              <button class="btn ghost" id="exportReviewPdfBtn" type="button">PDF</button>
            </div>
          </details>
          <details class="sidebar-tool-group">
            <summary>全部会话</summary>
            <div class="sidebar-tool-grid">
              <button class="btn ghost" id="exportAllMdBtn" type="button">MD</button>
              <button class="btn ghost" id="exportAllPdfBtn" type="button">PDF</button>
              <button class="btn ghost" id="exportAllJsonBtn" type="button">JSON</button>
              <button class="btn ghost" id="exportAllCsvBtn" type="button">CSV</button>
            </div>
          </details>
          <details class="sidebar-tool-group">
            <summary>工具</summary>
            <div class="sidebar-tool-grid">
              <input class="hidden" id="importJsonInput" type="file" accept="application/json,.json" />
              <button class="btn ghost" id="importJsonBtn" type="button">导入 JSON</button>
              <button class="btn ghost" id="themeToggleBtn" type="button" title="${state.theme === 'dark' ? '切换浅色' : '切换深色'}">${state.theme === 'dark' ? '浅色' : '深色'}</button>
              <a class="btn ghost" href="${BASE}/admin">后台</a>
              <button class="btn ghost" id="logoutBtn" type="button">退出</button>
            </div>
          </details>
        </div>
      </aside>
      <main class="main ${state.currentMessages.length ? '' : 'chat-empty'}">
        <header class="chat-topbar" id="chatTopbar">
          <div class="chat-topbar-title" id="chatTopbarTitle">${escapeHtml(currentConversationDisplayTitle())}</div>
          <div class="chat-topbar-controls">
            <div class="chat-topbar-actions" aria-label="当前会话操作">
              <button class="topbar-action" id="topbarRenameBtn" type="button">改名</button>
              <button class="topbar-action" id="topbarCopyLinkBtn" type="button">链接</button>
              <button class="topbar-action" id="topbarExportMdBtn" type="button">MD</button>
              <button class="topbar-action" id="topbarExportPdfBtn" type="button">PDF</button>
            </div>
            <select class="model-select topbar-model-select" id="providerSelectTop" data-provider-select="true" aria-label="选择模型"></select>
          </div>
        </header>
        <section class="messages" id="messages"></section>
        <button class="scroll-bottom hidden" id="scrollBottomBtn" type="button">到底部</button>
        <section class="composer">
          <div class="composer-inner">
            <div class="attachment-row" id="attachmentRow"></div>
            <div class="quick-prompts" id="quickPrompts">
              ${QUICK_PROMPTS.map((item) => `<button class="quick-prompt" data-quick-prompt="${escapeAttr(item.id)}" type="button">${escapeHtml(item.label)}</button>`).join('')}
            </div>
            <div class="prompt-library ${state.promptLibraryOpen ? '' : 'hidden'}" id="promptLibraryPanel" aria-label="常用模板">
              ${renderPromptLibraryPanel()}
            </div>
            <div class="slash-prompt-menu hidden" id="slashPromptMenu" role="listbox" aria-label="快捷模板"></div>
            <textarea id="messageInput" placeholder="输入题目、截图说明或你的疑问"></textarea>
            <div class="composer-actions">
              <div class="left-actions">
                <input class="hidden" id="imageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple />
                <button class="btn" id="attachBtn" type="button">图片</button>
                <button class="btn ghost" id="promptLibraryBtn" type="button" aria-expanded="${state.promptLibraryOpen ? 'true' : 'false'}">模板</button>
                <button class="btn ghost" id="savePromptBtn" type="button">存模板</button>
                <button class="btn ghost" id="clearAttachmentsBtn" type="button">清空附件</button>
              </div>
              <div class="right-actions">
                <span class="status" id="sendStatus"></span>
                <button class="btn ghost hidden" id="stopBtn" type="button">停止</button>
                <button class="btn primary" id="sendBtn" type="button">发送</button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
    <div class="image-preview hidden" id="imagePreview" role="dialog" aria-modal="true" aria-label="图片预览">
      <button class="image-preview-backdrop" id="imagePreviewBackdrop" type="button" aria-label="关闭图片预览"></button>
      <div class="image-preview-panel">
        <div class="image-preview-header">
          <div class="image-preview-title" id="imagePreviewTitle">图片预览</div>
          <button class="image-preview-close" id="imagePreviewClose" type="button">关闭</button>
        </div>
        <img id="imagePreviewImg" alt="" />
      </div>
    </div>
    <div class="undo-toast hidden" id="undoToast" role="status" aria-live="polite">
      <span id="undoToastText"></span>
      <button class="undo-toast-action" id="undoToastBtn" type="button">撤销</button>
    </div>
    <div class="app-toast hidden" id="appToast" role="status" aria-live="polite"></div>
    <div class="selection-toolbar hidden" id="selectionToolbar" role="toolbar" aria-label="选中文本操作">
      <button class="selection-toolbar-button" data-selection-action="copy" type="button">复制</button>
      <button class="selection-toolbar-button primary" data-selection-action="quote" type="button">追问</button>
    </div>
    <div class="command-palette ${state.commandPalette.open ? '' : 'hidden'}" id="commandPalette" role="dialog" aria-modal="true" aria-label="命令面板">
      <button class="command-palette-backdrop" data-command-palette-close type="button" aria-label="关闭命令面板"></button>
      <div class="command-palette-panel">
        <input class="command-palette-input" id="commandPaletteInput" placeholder="搜索命令" value="${escapeAttr(state.commandPalette.query)}" autocomplete="off" />
        <div class="command-palette-list" id="commandPaletteList" role="listbox">
          ${renderCommandPaletteItems()}
        </div>
      </div>
    </div>`;

  bindChatEvents();
  renderConversationList();
  renderProviderSelect();
  restoreCurrentComposer();
}

function bindChatEvents() {
  el('#sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
  el('#newConversationBtn')?.addEventListener('click', createConversation);
  el('#logoutBtn')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST', body: {} });
    state.student = null;
    renderStudentLogin();
  });
  document.querySelectorAll('[data-provider-select="true"]').forEach((select) => {
    select.addEventListener('change', handleProviderSelectChange);
  });
  el('#conversationSearch')?.addEventListener('input', (event) => {
    state.conversationQuery = event.currentTarget.value.trim();
    renderConversationList();
    scheduleMessageSearch(state.conversationQuery);
  });
  el('#conversationFind')?.addEventListener('input', handleConversationFindInput);
  el('#conversationFind')?.addEventListener('keydown', handleConversationFindKeydown);
  el('#conversationFindPrev')?.addEventListener('click', () => stepConversationFind(-1));
  el('#conversationFindNext')?.addEventListener('click', () => stepConversationFind(1));
  el('#conversationFindClear')?.addEventListener('click', clearConversationFind);
  el('#savedMessagesBtn')?.addEventListener('click', toggleSavedMessages);
  el('#archiveConversationsBtn')?.addEventListener('click', toggleArchivedConversations);
  el('#studyMemoryBtn')?.addEventListener('click', toggleStudyMemory);
  el('#messageOutline')?.addEventListener('click', handleMessageOutlineClick);
  el('#topbarRenameBtn')?.addEventListener('click', () => renameConversation(state.currentConversationId));
  el('#topbarCopyLinkBtn')?.addEventListener('click', (event) => copyConversationLink(state.currentConversationId, event.currentTarget));
  el('#topbarExportMdBtn')?.addEventListener('click', () => exportConversation('md'));
  el('#topbarExportPdfBtn')?.addEventListener('click', () => exportConversation('pdf'));
  el('#sendBtn')?.addEventListener('click', sendMessage);
  el('#stopBtn')?.addEventListener('click', stopGeneration);
  el('#exportMdBtn')?.addEventListener('click', () => exportConversation('md'));
  el('#exportPdfBtn')?.addEventListener('click', () => exportConversation('pdf'));
  el('#exportJsonBtn')?.addEventListener('click', () => exportConversation('json'));
  el('#exportCsvBtn')?.addEventListener('click', () => exportConversation('csv'));
  el('#exportReviewMdBtn')?.addEventListener('click', () => exportConversationReview('md'));
  el('#exportReviewPdfBtn')?.addEventListener('click', () => exportConversationReview('pdf'));
  el('#exportAllMdBtn')?.addEventListener('click', () => exportAllConversations('md'));
  el('#exportAllPdfBtn')?.addEventListener('click', () => exportAllConversations('pdf'));
  el('#exportAllJsonBtn')?.addEventListener('click', () => exportAllConversations('json'));
  el('#exportAllCsvBtn')?.addEventListener('click', () => exportAllConversations('csv'));
  el('#importJsonBtn')?.addEventListener('click', () => el('#importJsonInput')?.click());
  el('#importJsonInput')?.addEventListener('change', handleImportJson);
  el('#themeToggleBtn')?.addEventListener('click', toggleTheme);
  el('#scrollBottomBtn')?.addEventListener('click', () => scrollMessages(true));
  window.removeEventListener('scroll', handleWindowScroll);
  window.addEventListener('scroll', handleWindowScroll, { passive: true });
  el('#messageInput')?.addEventListener('keydown', (event) => {
    if (handleSlashPromptKeydown(event)) return;
    if (handleComposerHistoryKeydown(event)) return;
    if (event.key === 'Escape' && state.sending) {
      event.preventDefault();
      stopGeneration();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
      event.preventDefault();
      sendMessage();
    }
  });
  el('#messageInput')?.addEventListener('input', (event) => {
    resetComposerHistoryNavigation();
    saveDraftForConversation(state.currentConversationId, event.currentTarget.value);
    autoResizeTextarea(event.currentTarget);
    updateSlashPromptMenu(event.currentTarget);
  });
  const composerInner = el('.composer-inner');
  composerInner?.addEventListener('paste', handlePaste);
  composerInner?.addEventListener('dragenter', handleComposerDragEnter);
  composerInner?.addEventListener('dragover', handleComposerDragOver);
  composerInner?.addEventListener('dragleave', handleComposerDragLeave);
  composerInner?.addEventListener('drop', handleComposerDrop);
  el('#attachBtn')?.addEventListener('click', () => el('#imageInput').click());
  el('#imageInput')?.addEventListener('change', handleImages);
  el('#clearAttachmentsBtn')?.addEventListener('click', () => {
    state.attachments = [];
    saveCurrentAttachments();
    renderAttachments();
  });
  el('#messages')?.addEventListener('click', handleMessageActionClick);
  el('#messages')?.addEventListener('mouseup', scheduleSelectionToolbarUpdate);
  el('#messages')?.addEventListener('touchend', scheduleSelectionToolbarUpdate);
  el('#quickPrompts')?.addEventListener('click', handleQuickPromptClick);
  el('#promptLibraryBtn')?.addEventListener('click', togglePromptLibrary);
  el('#savePromptBtn')?.addEventListener('click', saveCurrentPromptAsCustom);
  el('#promptLibraryPanel')?.addEventListener('click', handlePromptLibraryClick);
  el('#promptLibraryPanel')?.addEventListener('submit', handlePromptLibrarySubmit);
  el('#slashPromptMenu')?.addEventListener('mousedown', handleSlashPromptMouseDown);
  el('#selectionToolbar')?.addEventListener('mousedown', handleSelectionToolbarMouseDown);
  el('#selectionToolbar')?.addEventListener('click', handleSelectionToolbarClick);
  el('#commandPalette')?.addEventListener('mousedown', handleCommandPaletteMouseDown);
  el('#commandPalette')?.addEventListener('click', handleCommandPaletteClick);
  el('#commandPaletteInput')?.addEventListener('input', handleCommandPaletteInput);
  el('#commandPaletteInput')?.addEventListener('keydown', handleCommandPaletteKeydown);
  el('#attachmentRow')?.addEventListener('click', handleImagePreviewClick);
  el('#imagePreviewClose')?.addEventListener('click', closeImagePreview);
  el('#imagePreviewBackdrop')?.addEventListener('click', closeImagePreview);
  el('#undoToastBtn')?.addEventListener('click', () => undoDeleteConversation(state.activeUndoDeleteId));
  document.removeEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('keydown', handleGlobalKeydown);
  document.removeEventListener('selectionchange', scheduleSelectionToolbarUpdate);
  document.addEventListener('selectionchange', scheduleSelectionToolbarUpdate);
  document.removeEventListener('mousedown', handleSelectionToolbarDocumentMouseDown);
  document.addEventListener('mousedown', handleSelectionToolbarDocumentMouseDown);
  window.removeEventListener('resize', closeSelectionToolbar);
  window.addEventListener('resize', closeSelectionToolbar);
  window.removeEventListener('beforeunload', saveCurrentDraft);
  window.addEventListener('beforeunload', saveCurrentDraft);
  renderUndoToast();
  renderSelectionToolbar();
}

function toggleSidebar() {
  saveCurrentComposer();
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('kc_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');
  renderChatShell();
  renderMessages(state.currentMessages);
}

function toggleTheme() {
  saveCurrentComposer();
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('kc_theme', state.theme);
  } catch {}
  applyTheme(state.theme);
  renderChatShell();
  renderMessages(state.currentMessages);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function handleProviderSelectChange(event) {
  state.currentProviderId = Number(event.currentTarget.value) || null;
  renderProviderSelect();
}

function initialRouteTarget() {
  const params = new URLSearchParams(location.search);
  return {
    conversationId: params.get('c') || params.get('conversation') || '',
    messageId: params.get('m') || params.get('message') || ''
  };
}

function bindRouteEvents() {
  window.removeEventListener('popstate', handleRoutePopState);
  window.addEventListener('popstate', handleRoutePopState);
}

async function handleRoutePopState() {
  if (state.sending) return;
  const target = initialRouteTarget();
  const id = target.conversationId || state.conversations[0]?.id || '';
  if (!id || id === state.currentConversationId) {
    if (target.messageId) focusMessage(target.messageId);
    return;
  }
  if (!state.conversations.some((conversation) => conversation.id === id)) return;
  await selectConversation(id, { highlightMessageId: target.messageId, replaceRoute: true });
}

function updateConversationRoute(conversationId, options = {}) {
  if (!conversationId || location.pathname.endsWith('/admin')) return;
  const current = initialRouteTarget();
  if (current.conversationId === conversationId && !current.messageId) return;
  const url = conversationRouteUrl(conversationId);
  const stateData = { conversationId };
  if (options.replace) history.replaceState(stateData, '', url);
  else history.pushState(stateData, '', url);
}

function conversationRouteUrl(conversationId, messageId = '') {
  const url = new URL(`${location.origin}${BASE}/`);
  url.searchParams.set('c', conversationId);
  if (messageId) url.searchParams.set('m', messageId);
  return url.toString();
}

async function loadProviders() {
  const data = await api('/providers');
  state.providers = data.providers || [];
  const defaultProvider = state.providers.find((p) => p.is_default) || state.providers[0];
  state.currentProviderId = defaultProvider?.id || null;
}

async function loadConversations() {
  const data = await api(`/conversations${state.showArchived ? '?archived=1' : ''}`);
  state.conversations = sortConversations(data.conversations || []);
  renderConversationList();
}

async function createConversation(options = {}) {
  saveCurrentComposer();
  const data = await api('/conversations', { method: 'POST', body: { title: '新的答疑', providerId: state.currentProviderId } });
  state.conversations = sortConversations([data.conversation, ...state.conversations]);
  state.currentConversationId = data.conversation.id;
  state.currentConversationTitle = data.conversation.title || '新的答疑';
  state.currentMessages = [];
  updateConversationRoute(state.currentConversationId);
  updateChatTopbarTitle();
  renderConversationList();
  renderMessages([]);
  if (!options.preserveComposer) restoreCurrentComposer();
}

async function selectConversation(id, options = {}) {
  saveCurrentComposer();
  state.currentConversationId = id;
  updateConversationRoute(id, { replace: options.replaceRoute });
  renderConversationList();
  restoreCurrentComposer();
  await refreshCurrentConversationMessages(options);
  restoreCurrentComposer();
}

async function refreshCurrentConversationMessages(options = {}) {
  const conversationId = state.currentConversationId;
  if (!conversationId) return;
  const data = await api(`/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (state.currentConversationId !== conversationId) return;
  state.currentConversationTitle = data.conversation.title || '答疑会话';
  if (data.conversation.model_id) state.currentProviderId = data.conversation.model_id;
  updateChatTopbarTitle();
  renderProviderSelect();
  await renderMessages(data.messages || []);
  if (options.highlightMessageId) focusMessage(options.highlightMessageId);
}

function renderConversationList() {
  const list = el('#conversationList');
  if (!list) return;
  updateSavedMessagesToggle();
  updateArchiveConversationsToggle();
  updateStudyMemoryToggle();
  const query = normalizeSearchText(state.conversationQuery);
  const conversations = filteredConversations();
  const sections = [];
  if (state.studyMemory.open) {
    sections.push(renderStudyMemoryPanel());
  }
  if (state.savedMessages.open) {
    sections.push(`
	      <div class="saved-review-header">
	        <span>复习收藏</span>
	        <div class="saved-review-actions">
	          <button class="conversation-action" data-export-saved="md" type="button">收藏 MD</button>
	          <button class="conversation-action" data-export-saved="pdf" type="button">收藏 PDF</button>
	          <button class="conversation-action" data-export-saved="json" type="button">收藏 JSON</button>
	          <button class="conversation-action" data-export-saved="csv" type="button">收藏 CSV</button>
	        </div>
	      </div>`);
    if (state.savedMessages.loading) {
      sections.push(`<div class="status">正在加载复习收藏...</div>`);
    } else if (state.savedMessages.error) {
      sections.push(`<div class="status error">${escapeHtml(state.savedMessages.error)}</div>`);
    } else if (state.savedMessages.results.length) {
      sections.push(`
        <div class="message-result-list saved-result-list">
          ${state.savedMessages.results.map((item) => renderMessageSearchResult(item, '')).join('')}
        </div>`);
    } else {
      sections.push(`<div class="status">还没有收藏的消息。</div>`);
    }
  }
  if (conversations.length) sections.push(conversations.map(renderConversationItem).join(''));
  else if (!query && !state.savedMessages.open && !state.studyMemory.open) {
    sections.push(`<div class="status">${state.showArchived ? '暂无归档会话。' : '暂无会话，点击“新建”开始。'}</div>`);
  }
  if (query.length >= 2) {
    if (state.messageSearch.loading && state.messageSearch.query === state.conversationQuery) {
      sections.push(`<div class="status">正在搜索消息...</div>`);
    } else if (state.messageSearch.error) {
      sections.push(`<div class="status error">${escapeHtml(state.messageSearch.error)}</div>`);
    } else if (state.messageSearch.results.length) {
      sections.push(`
        <div class="message-result-list">
          ${state.messageSearch.results.map((item) => renderMessageSearchResult(item, state.conversationQuery)).join('')}
        </div>`);
    }
  }
  if (!sections.length) {
    list.innerHTML = `<div class="status">${query ? '未找到会话或消息。' : '暂无会话，点击“新建”开始。'}</div>`;
    return;
  }
  list.innerHTML = sections.join('');
  list.querySelectorAll('[data-select-conversation]').forEach((button) => {
    button.addEventListener('click', () => selectConversation(button.dataset.selectConversation));
  });
  list.querySelectorAll('[data-select-search-result]').forEach((button) => {
    button.addEventListener('click', () => selectSearchResult(button.dataset.selectSearchResult, button.dataset.resultMessageId));
  });
  list.querySelectorAll('[data-export-saved]').forEach((button) => {
    button.addEventListener('click', () => exportSavedMessages(button.dataset.exportSaved || 'md'));
  });
  list.querySelectorAll('[data-memory-action="refresh"]').forEach((button) => {
    button.addEventListener('click', () => refreshStudyMemory());
  });
  list.querySelectorAll('[data-memory-export]').forEach((button) => {
    button.addEventListener('click', () => exportStudyMemory(button.dataset.memoryExport || 'md'));
  });
  list.querySelectorAll('[data-rename-conversation]').forEach((button) => {
    button.addEventListener('click', () => renameConversation(button.dataset.renameConversation));
  });
  list.querySelectorAll('[data-pin-conversation]').forEach((button) => {
    button.addEventListener('click', () => toggleConversationPin(button.dataset.pinConversation));
  });
  list.querySelectorAll('[data-archive-conversation]').forEach((button) => {
    button.addEventListener('click', () => setConversationArchived(button.dataset.archiveConversation, true));
  });
  list.querySelectorAll('[data-restore-conversation]').forEach((button) => {
    button.addEventListener('click', () => setConversationArchived(button.dataset.restoreConversation, false));
  });
  list.querySelectorAll('[data-copy-conversation-link]').forEach((button) => {
    button.addEventListener('click', () => copyConversationLink(button.dataset.copyConversationLink, button));
  });
  list.querySelectorAll('[data-delete-conversation]').forEach((button) => {
    button.addEventListener('click', () => deleteConversation(button.dataset.deleteConversation));
  });
}

function updateSavedMessagesToggle() {
  const button = el('#savedMessagesBtn');
  if (!button) return;
  button.classList.toggle('active', Boolean(state.savedMessages.open));
  button.setAttribute('aria-pressed', state.savedMessages.open ? 'true' : 'false');
  button.textContent = state.savedMessages.open ? '关闭复习收藏' : '复习收藏';
}

function updateArchiveConversationsToggle() {
  const button = el('#archiveConversationsBtn');
  if (!button) return;
  button.classList.toggle('active', Boolean(state.showArchived));
  button.setAttribute('aria-pressed', state.showArchived ? 'true' : 'false');
  button.textContent = state.showArchived ? '返回当前会话' : '归档会话';
}

function updateStudyMemoryToggle() {
  const button = el('#studyMemoryBtn');
  if (!button) return;
  button.classList.toggle('active', Boolean(state.studyMemory.open));
  button.setAttribute('aria-pressed', state.studyMemory.open ? 'true' : 'false');
  button.textContent = state.studyMemory.open ? '关闭学习记忆' : '学习记忆';
}

function renderStudyMemoryPanel() {
  const memory = normalizedStudyMemory();
  const topics = studyMemoryTopicEntries(memory);
  const profileEntries = Object.entries(memory.profile || {})
    .filter(([, value]) => String(value || '').trim())
    .slice(0, 6);
  const recentQuestions = Array.isArray(memory.recentQuestions) ? memory.recentQuestions.slice(-8).reverse() : [];
  const updatedAt = memory.lastUpdatedAt ? formatTime(memory.lastUpdatedAt) : '尚未更新';
  return `
    <section class="study-memory-panel" aria-label="学习记忆">
      <div class="study-memory-header">
        <span>学习记忆</span>
        <div class="study-memory-actions">
          <button class="conversation-action" data-memory-action="refresh" type="button" ${state.studyMemory.loading ? 'disabled' : ''}>刷新</button>
          <button class="conversation-action" data-memory-export="md" type="button">MD</button>
          <button class="conversation-action" data-memory-export="json" type="button">JSON</button>
        </div>
      </div>
      <div class="study-memory-meta">更新：${escapeHtml(updatedAt)}</div>
      ${state.studyMemory.loading ? '<div class="status">正在读取学习记忆...</div>' : ''}
      ${state.studyMemory.error ? `<div class="status error">${escapeHtml(state.studyMemory.error)}</div>` : ''}
      <div class="study-memory-section">
        <div class="study-memory-section-title">画像</div>
        ${profileEntries.length
          ? `<div class="study-memory-profile">${profileEntries.map(([key, value]) => `<span>${escapeHtml(studyMemoryProfileLabel(key))}：${escapeHtml(value)}</span>`).join('')}</div>`
          : '<div class="study-memory-empty">暂无画像信息。</div>'}
      </div>
      <div class="study-memory-section">
        <div class="study-memory-section-title">高频主题</div>
        ${topics.length
          ? `<div class="study-memory-topics">${topics.map(([topic, count]) => `<span class="study-memory-topic">${escapeHtml(topic)} <b>${Number(count) || 0}</b></span>`).join('')}</div>`
          : '<div class="study-memory-empty">暂无主题记录。</div>'}
      </div>
      <div class="study-memory-section">
        <div class="study-memory-section-title">最近问题</div>
        ${recentQuestions.length
          ? `<ol class="study-memory-questions">${recentQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>`
          : '<div class="study-memory-empty">暂无最近问题。</div>'}
      </div>
    </section>`;
}

function renderPromptLibraryPanel() {
  const customPrompts = state.customPrompts || [];
  return `
    <div class="prompt-library-header">
      <span>常用模板</span>
      <button class="prompt-library-close" data-prompt-library-close type="button">收起</button>
    </div>
    <form class="prompt-library-form" id="customPromptForm">
      <input class="input prompt-library-name" id="customPromptLabel" maxlength="28" placeholder="名称" />
      <textarea class="prompt-library-text" id="customPromptText" maxlength="${CUSTOM_PROMPT_TEXT_LIMIT}" placeholder="模板内容"></textarea>
      <button class="btn primary" type="submit">保存</button>
    </form>
    <div class="custom-prompt-list">
      ${customPrompts.length
        ? customPrompts.map(renderCustomPromptItem).join('')
        : '<div class="custom-prompt-empty">暂无自定义模板。</div>'}
    </div>`;
}

function commandPaletteCommands() {
  const hasConversation = Boolean(state.currentConversationId);
  const hasMessages = Boolean((state.currentMessages || []).length);
  return [
    {
      id: 'new-conversation',
      label: '新建答疑',
      detail: '创建一个新的考研答疑会话',
      keywords: 'new chat conversation 新建 会话',
      shortcut: 'N',
      run: () => createConversation()
    },
    {
      id: 'focus-search',
      label: '搜索会话或消息',
      detail: '聚焦左侧搜索框',
      keywords: 'search conversation message 搜索 消息',
      shortcut: 'Ctrl K',
      run: () => focusConversationSearch()
    },
    {
      id: 'find-current',
      label: '查找当前会话',
      detail: '在当前回答上下文里查找文字',
      keywords: 'find current message 查找 当前会话',
      disabled: !hasMessages,
      run: () => focusConversationFind()
    },
    {
      id: 'focus-composer',
      label: '回到输入框',
      detail: '继续输入题目或追问',
      keywords: 'composer input prompt 输入',
      run: () => focusComposer()
    },
    {
      id: 'open-prompts',
      label: '打开常用模板',
      detail: '管理和套用自定义 prompt 模板',
      keywords: 'prompt library template 模板 常用',
      run: () => openPromptLibraryFromCommand()
    },
    {
      id: 'save-prompt',
      label: '保存当前输入为模板',
      detail: '把输入框内容保存到常用模板',
      keywords: 'save prompt template 保存 模板',
      run: () => saveCurrentPromptAsCustom()
    },
    {
      id: 'export-md',
      label: '导出当前会话 MD',
      detail: '一键保存当前答疑为 Markdown',
      keywords: 'export markdown md 导出',
      disabled: !hasMessages,
      run: () => exportConversation('md')
    },
    {
      id: 'export-pdf',
      label: '导出当前会话 PDF',
      detail: '直接下载当前答疑 PDF',
      keywords: 'export pdf print 导出',
      disabled: !hasMessages,
      run: () => exportConversation('pdf')
    },
    {
      id: 'copy-link',
      label: '复制当前会话链接',
      detail: '复制可直达当前会话的链接',
      keywords: 'copy link url 分享 链接',
      disabled: !hasConversation,
      run: () => copyCurrentConversationLinkFromCommand()
    },
    {
      id: 'saved-review',
      label: state.savedMessages.open ? '关闭复习收藏' : '打开复习收藏',
      detail: '查看已收藏的重点回答',
      keywords: 'saved review 收藏 复习',
      run: () => toggleSavedMessages()
    },
    {
      id: 'study-memory',
      label: state.studyMemory.open ? '关闭学习记忆' : '打开学习记忆',
      detail: '查看画像、主题和最近问题',
      keywords: 'memory study 学习记忆',
      run: () => toggleStudyMemory()
    },
    {
      id: 'toggle-theme',
      label: state.theme === 'dark' ? '切换浅色模式' : '切换深色模式',
      detail: '切换当前界面主题',
      keywords: 'theme dark light 主题 深色 浅色',
      run: () => toggleTheme()
    },
    {
      id: 'scroll-bottom',
      label: '滚动到底部',
      detail: '回到最新回答和输入区',
      keywords: 'scroll bottom latest 底部 最新',
      run: () => scrollMessages(true)
    },
    {
      id: 'stop-generation',
      label: '停止生成',
      detail: '中断当前模型输出',
      keywords: 'stop generation abort 停止',
      disabled: !state.sending,
      run: () => stopGeneration()
    }
  ];
}

function filteredCommandPaletteCommands() {
  const query = normalizeSearchText(state.commandPalette.query);
  const commands = commandPaletteCommands();
  if (!query) return commands;
  return commands.filter((command) => normalizeSearchText(`${command.label} ${command.detail} ${command.keywords || ''}`).includes(query));
}

function renderCommandPaletteItems() {
  const commands = filteredCommandPaletteCommands();
  if (!commands.length) return '<div class="command-palette-empty">没有匹配的命令。</div>';
  const activeIndex = clamp(state.commandPalette.index, 0, commands.length - 1);
  state.commandPalette.index = activeIndex;
  return commands.map((command, index) => `
    <button class="command-palette-item ${index === activeIndex ? 'active' : ''}" data-command-id="${escapeAttr(command.id)}" type="button" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}" ${command.disabled ? 'disabled' : ''}>
      <span class="command-palette-main">
        <b>${escapeHtml(command.label)}</b>
        <small>${escapeHtml(command.detail)}</small>
      </span>
      ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ''}
    </button>`).join('');
}

function renderCommandPalette() {
  const palette = el('#commandPalette');
  if (!palette) return;
  palette.classList.toggle('hidden', !state.commandPalette.open);
  const input = el('#commandPaletteInput');
  if (input && input.value !== state.commandPalette.query) input.value = state.commandPalette.query;
  const list = el('#commandPaletteList');
  if (list) list.innerHTML = renderCommandPaletteItems();
}

function openCommandPalette(initialQuery = '') {
  state.commandPalette = { open: true, query: initialQuery, index: 0 };
  renderCommandPalette();
  requestAnimationFrame(() => {
    const input = el('#commandPaletteInput');
    input?.focus();
    input?.select();
  });
}

function closeCommandPalette() {
  if (!state.commandPalette.open) return;
  state.commandPalette = { open: false, query: '', index: 0 };
  renderCommandPalette();
}

function handleCommandPaletteMouseDown(event) {
  if (event.target.closest('.command-palette-panel')) return;
  event.preventDefault();
}

function handleCommandPaletteClick(event) {
  if (event.target.closest('[data-command-palette-close]')) {
    closeCommandPalette();
    return;
  }
  const button = event.target.closest('[data-command-id]');
  if (!button || button.disabled) return;
  runCommandPaletteCommand(button.dataset.commandId || '');
}

function handleCommandPaletteInput(event) {
  state.commandPalette.query = event.currentTarget.value;
  state.commandPalette.index = 0;
  renderCommandPalette();
}

function handleCommandPaletteKeydown(event) {
  const commands = filteredCommandPaletteCommands();
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    if (commands.length) state.commandPalette.index = (state.commandPalette.index + delta + commands.length) % commands.length;
    renderCommandPalette();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const command = commands[state.commandPalette.index];
    if (command && !command.disabled) runCommandPaletteCommand(command.id);
  }
}

async function runCommandPaletteCommand(id) {
  const command = commandPaletteCommands().find((item) => item.id === id);
  if (!command || command.disabled) return;
  closeCommandPalette();
  try {
    await command.run();
  } catch (err) {
    setTransientStatus(`${command.label}失败：${err.message}`, true);
  }
}

function renderCustomPromptItem(prompt) {
  return `
    <div class="custom-prompt-item" data-custom-prompt-item="${escapeAttr(prompt.id)}">
      <button class="custom-prompt-main" data-use-custom-prompt="${escapeAttr(prompt.id)}" type="button">
        <span>${escapeHtml(prompt.label)}</span>
        <small>${escapeHtml(cleanExcerpt(prompt.text, 120))}</small>
      </button>
      <button class="custom-prompt-delete" data-delete-custom-prompt="${escapeAttr(prompt.id)}" type="button">删除</button>
    </div>`;
}

function renderPromptLibrary() {
  const panel = el('#promptLibraryPanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !state.promptLibraryOpen);
  panel.innerHTML = renderPromptLibraryPanel();
  const button = el('#promptLibraryBtn');
  if (button) button.setAttribute('aria-expanded', state.promptLibraryOpen ? 'true' : 'false');
}

function togglePromptLibrary() {
  state.promptLibraryOpen = !state.promptLibraryOpen;
  renderPromptLibrary();
  if (state.promptLibraryOpen) requestAnimationFrame(() => el('#customPromptLabel')?.focus());
}

function handlePromptLibraryClick(event) {
  const closeButton = event.target.closest('[data-prompt-library-close]');
  if (closeButton) {
    state.promptLibraryOpen = false;
    renderPromptLibrary();
    el('#messageInput')?.focus();
    return;
  }
  const useButton = event.target.closest('[data-use-custom-prompt]');
  if (useButton) {
    const prompt = customPromptById(useButton.dataset.useCustomPrompt || '');
    if (!prompt) return;
    appendToComposer(prompt.text);
    flashButtonText(useButton, '已添加');
    closeSlashPromptMenu();
    return;
  }
  const deleteButton = event.target.closest('[data-delete-custom-prompt]');
  if (deleteButton) {
    deleteCustomPrompt(deleteButton.dataset.deleteCustomPrompt || '');
  }
}

function handlePromptLibrarySubmit(event) {
  event.preventDefault();
  const labelInput = el('#customPromptLabel');
  const textInput = el('#customPromptText');
  addCustomPrompt(labelInput?.value || '', textInput?.value || '');
  if (labelInput) labelInput.value = '';
  if (textInput) textInput.value = '';
  requestAnimationFrame(() => labelInput?.focus());
}

function saveCurrentPromptAsCustom() {
  const text = el('#messageInput')?.value || '';
  if (!text.trim()) {
    state.promptLibraryOpen = true;
    renderPromptLibrary();
    setTransientStatus('先输入模板内容，或在面板里手动填写。', true);
    requestAnimationFrame(() => el('#customPromptText')?.focus());
    return;
  }
  addCustomPrompt('', text);
  state.promptLibraryOpen = true;
  renderPromptLibrary();
}

function addCustomPrompt(label, text) {
  const normalizedText = String(text || '').trim().slice(0, CUSTOM_PROMPT_TEXT_LIMIT);
  if (!normalizedText) {
    setTransientStatus('模板内容不能为空。', true);
    return;
  }
  const normalizedLabel = normalizeCustomPromptLabel(label || makePromptLabel(normalizedText));
  const prompt = {
    id: `custom_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label: normalizedLabel,
    text: normalizedText,
    createdAt: new Date().toISOString()
  };
  state.customPrompts = [prompt, ...state.customPrompts.filter((item) => item.text !== normalizedText)].slice(0, CUSTOM_PROMPT_LIMIT);
  saveCustomPrompts();
  renderPromptLibrary();
  setTransientStatus('模板已保存。');
  updateSlashPromptMenu();
}

function deleteCustomPrompt(id) {
  const before = state.customPrompts.length;
  state.customPrompts = state.customPrompts.filter((prompt) => prompt.id !== id);
  if (state.customPrompts.length === before) return;
  saveCustomPrompts();
  renderPromptLibrary();
  setTransientStatus('模板已删除。');
  updateSlashPromptMenu();
}

function customPromptById(id) {
  return (state.customPrompts || []).find((prompt) => prompt.id === id);
}

function normalizeCustomPromptLabel(value) {
  return cleanFilenamePart(value || '自定义模板').slice(0, 28) || '自定义模板';
}

function makePromptLabel(text) {
  return cleanExcerpt(String(text || '').replace(/\s+/g, ' '), 18) || '自定义模板';
}

function renderConversationItem(item) {
  const pinned = Boolean(item.pinned);
  const archived = Boolean(item.archived);
  const archiveButton = archived
    ? `<button class="conversation-action" data-restore-conversation="${escapeAttr(item.id)}" type="button">恢复</button>`
    : `<button class="conversation-action" data-archive-conversation="${escapeAttr(item.id)}" type="button">归档</button>`;
  return `
    <div class="conversation-item ${item.id === state.currentConversationId ? 'active' : ''} ${pinned ? 'pinned' : ''} ${archived ? 'archived' : ''}" data-id="${escapeAttr(item.id)}">
      <button class="conversation-main" data-select-conversation="${escapeAttr(item.id)}" type="button">
        <div class="conversation-title">${escapeHtml(item.title)}</div>
        <div class="conversation-date">${archived ? '已归档 · ' : pinned ? '已置顶 · ' : ''}${formatTime(item.updated_at)}</div>
      </button>
      <div class="conversation-actions">
        ${archived ? '' : `<button class="conversation-action" data-pin-conversation="${escapeAttr(item.id)}" type="button">${pinned ? '取消置顶' : '置顶'}</button>`}
        <button class="conversation-action" data-copy-conversation-link="${escapeAttr(item.id)}" type="button">链接</button>
        ${archiveButton}
        <button class="conversation-action" data-rename-conversation="${escapeAttr(item.id)}" type="button">改名</button>
        <button class="conversation-action danger" data-delete-conversation="${escapeAttr(item.id)}" type="button">删除</button>
      </div>
    </div>`;
}

function renderMessageSearchResult(item, query) {
  const roleName = item.role === 'user' ? '学生' : '助手';
  return `
    <button class="message-result ${item.conversationId === state.currentConversationId ? 'active' : ''}"
      data-select-search-result="${escapeAttr(item.conversationId)}"
      data-result-message-id="${escapeAttr(item.messageId)}"
      type="button">
      <span class="message-result-title">${item.saved ? '★ ' : ''}${escapeHtml(item.conversationTitle || '答疑会话')}</span>
      <span class="message-result-meta">${item.saved ? '已收藏 · ' : ''}${roleName} · ${formatTime(item.createdAt)}</span>
      <span class="message-result-snippet">${highlightSearchText(item.snippet || '', query)}</span>
    </button>`;
}

async function selectSearchResult(conversationId, messageId) {
  if (!conversationId || state.sending) return;
  await selectConversation(conversationId, { highlightMessageId: messageId });
}

function filteredConversations() {
  const query = normalizeSearchText(state.conversationQuery);
  if (!query) return state.conversations;
  return state.conversations.filter((item) => normalizeSearchText(item.title).includes(query));
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function scheduleMessageSearch(query) {
  const normalized = String(query || '').trim();
  if (messageSearchTimer) clearTimeout(messageSearchTimer);
  if (normalized.length < 2) {
    state.messageSearch = { query: normalized, loading: false, results: [], error: '' };
    renderConversationList();
    return;
  }
  state.messageSearch = { query: normalized, loading: true, results: [], error: '' };
  renderConversationList();
  messageSearchTimer = setTimeout(() => loadMessageSearchResults(normalized), 220);
}

async function toggleSavedMessages() {
  state.savedMessages.open = !state.savedMessages.open;
  if (state.savedMessages.open) state.studyMemory.open = false;
  if (state.savedMessages.open) {
    await loadSavedMessages();
  } else {
    renderConversationList();
  }
}

async function toggleArchivedConversations() {
  if (state.sending) return;
  state.showArchived = !state.showArchived;
  state.savedMessages.open = false;
  state.studyMemory.open = false;
  state.conversationQuery = '';
  state.messageSearch = { query: '', loading: false, results: [], error: '' };
  const search = el('#conversationSearch');
  if (search) search.value = '';
  await loadConversations();
  if (state.currentConversationId && state.conversations.some((conversation) => conversation.id === state.currentConversationId)) {
    renderConversationList();
    return;
  }
  const next = state.conversations[0];
  if (next) {
    await selectConversation(next.id, { replaceRoute: true });
    return;
  }
  clearCurrentConversationView();
}

async function toggleStudyMemory() {
  state.studyMemory.open = !state.studyMemory.open;
  if (state.studyMemory.open) {
    state.savedMessages.open = false;
    await refreshStudyMemory();
    return;
  }
  renderConversationList();
}

async function refreshStudyMemory(options = {}) {
  const shouldRender = options.render !== false;
  if (!options.silent) {
    state.studyMemory = { ...state.studyMemory, loading: true, error: '' };
    if (shouldRender) renderConversationList();
  }
  try {
    const data = await api('/me');
    if (data.student) state.student = { ...state.student, ...data.student };
    state.studyMemory = { ...state.studyMemory, loading: false, error: '' };
  } catch (err) {
    state.studyMemory = { ...state.studyMemory, loading: false, error: err.message || '学习记忆读取失败。' };
  }
  if (shouldRender) renderConversationList();
}

async function refreshStudyMemoryAfterAnswer() {
  if (!state.student) return;
  try {
    const data = await api('/me');
    if (data.student) state.student = { ...state.student, ...data.student };
    if (state.studyMemory.open) renderConversationList();
  } catch {}
}

async function loadSavedMessages() {
  state.savedMessages = { ...state.savedMessages, open: true, loading: true, results: [], error: '' };
  renderConversationList();
  try {
    const data = await api('/saved');
    state.savedMessages = { open: true, loading: false, results: data.results || [], error: '' };
  } catch (err) {
    state.savedMessages = { open: true, loading: false, results: [], error: err.message || '收藏加载失败。' };
  }
  renderConversationList();
}

async function loadMessageSearchResults(query) {
  try {
    const data = await api(`/search?q=${encodeURIComponent(query)}`);
    if (state.conversationQuery !== query) return;
    state.messageSearch = { query, loading: false, results: data.results || [], error: '' };
  } catch (err) {
    if (state.conversationQuery !== query) return;
    state.messageSearch = { query, loading: false, results: [], error: err.message || '消息搜索失败。' };
  }
  renderConversationList();
}

function highlightSearchText(text, query) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return escapeHtml(source);
  const parts = source.split(new RegExp(`(${escapeRegExp(needle)})`, 'ig'));
  return parts.map((part) => (
    part.toLowerCase() === needle.toLowerCase()
      ? `<mark>${escapeHtml(part)}</mark>`
      : escapeHtml(part)
  )).join('');
}

async function renameConversation(id) {
  if (!id || state.sending) return;
  const item = state.conversations.find((conversation) => conversation.id === id);
  if (!item) return;
  const nextTitle = window.prompt('会话名称', item.title || '新的答疑');
  if (nextTitle === null) return;
  const title = nextTitle.trim();
  if (!title || title === item.title) return;
  try {
    const data = await api(`/conversations/${encodeURIComponent(id)}`, { method: 'PUT', body: { title } });
    state.conversations = state.conversations.map((conversation) => (
      conversation.id === id ? { ...conversation, ...data.conversation } : conversation
    ));
    if (state.currentConversationId === id) {
      state.currentConversationTitle = data.conversation.title || title;
      updateChatTopbarTitle();
    }
    renderConversationList();
    setTransientStatus('会话已重命名。');
  } catch (err) {
    setTransientStatus(`重命名失败：${err.message}`, true);
  }
}

async function toggleConversationPin(id) {
  if (!id || state.sending) return;
  const item = state.conversations.find((conversation) => conversation.id === id);
  if (!item) return;
  const nextPinned = item.pinned ? 0 : 1;
  state.conversations = sortConversations(state.conversations.map((conversation) => (
    conversation.id === id ? { ...conversation, pinned: nextPinned } : conversation
  )));
  renderConversationList();
  try {
    const data = await api(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { pinned: nextPinned }
    });
    state.conversations = sortConversations(state.conversations.map((conversation) => (
      conversation.id === id ? { ...conversation, ...data.conversation } : conversation
    )));
    renderConversationList();
  } catch (err) {
    state.conversations = sortConversations(state.conversations.map((conversation) => (
      conversation.id === id ? { ...conversation, pinned: item.pinned || 0 } : conversation
    )));
    renderConversationList();
    setTransientStatus(`置顶保存失败：${err.message}`, true);
  }
}

async function setConversationArchived(id, archived) {
  if (!id || state.sending) return;
  const item = state.conversations.find((conversation) => conversation.id === id);
  if (!item) return;
  try {
    await api(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { archived: archived ? 1 : 0 }
    });
    state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
    if (state.currentConversationId === id) {
      const next = state.conversations[0];
      if (next) await selectConversation(next.id, { replaceRoute: true });
      else clearCurrentConversationView();
    } else {
      renderConversationList();
    }
    setTransientStatus(archived ? '已归档会话。' : '已恢复会话。');
  } catch (err) {
    setTransientStatus(`${archived ? '归档' : '恢复'}失败：${err.message}`, true);
  }
}

function clearCurrentConversationView() {
  state.currentConversationId = null;
  state.currentConversationTitle = state.showArchived ? '归档会话' : '答疑会话';
  state.currentMessages = [];
  if (!location.pathname.endsWith('/admin')) history.replaceState({}, '', `${location.origin}${BASE}/`);
  updateChatTopbarTitle();
  renderConversationList();
  renderMessages([]);
  restoreCurrentComposer();
}

function sortConversations(conversations) {
  return [...(conversations || [])].sort((a, b) => {
    const pinnedDelta = Number(b.pinned || 0) - Number(a.pinned || 0);
    if (pinnedDelta) return pinnedDelta;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  });
}

function updateConversationTitle(id, title) {
  if (!id || !title) return;
  state.conversations = sortConversations(state.conversations.map((conversation) => (
    conversation.id === id ? { ...conversation, title } : conversation
  )));
  if (state.currentConversationId === id) {
    state.currentConversationTitle = title;
    updateChatTopbarTitle();
  }
  renderConversationList();
}

async function deleteConversation(id) {
  if (!id || state.sending) return;
  if (state.pendingDeletes.has(id)) return;
  const index = state.conversations.findIndex((conversation) => conversation.id === id);
  const item = state.conversations[index];
  if (!item) return;
  saveCurrentComposer();
  const wasCurrent = state.currentConversationId === id;
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  const pending = {
    item,
    index,
    wasCurrent,
    timer: setTimeout(() => finalizeDeleteConversation(id), DELETE_UNDO_MS)
  };
  state.pendingDeletes.set(id, pending);
  state.activeUndoDeleteId = id;
  renderUndoToast();

  if (!wasCurrent) {
    renderConversationList();
    return;
  }
  const next = state.conversations[0];
  if (next) {
    await selectConversation(next.id);
    return;
  }
  state.currentConversationId = null;
  state.currentConversationTitle = '答疑会话';
  state.currentMessages = [];
  updateChatTopbarTitle();
  renderConversationList();
  renderMessages([]);
  restoreCurrentComposer();
}

async function undoDeleteConversation(id) {
  const pending = id ? state.pendingDeletes.get(id) : null;
  if (!pending) return;
  clearTimeout(pending.timer);
  state.pendingDeletes.delete(id);
  if (state.activeUndoDeleteId === id) state.activeUndoDeleteId = null;
  const insertAt = Math.min(Math.max(pending.index, 0), state.conversations.length);
  if (!state.conversations.some((conversation) => conversation.id === pending.item.id)) {
    state.conversations.splice(insertAt, 0, pending.item);
  }
  renderConversationList();
  renderUndoToast();
  if (pending.wasCurrent || !state.currentConversationId) {
    await selectConversation(id);
  }
}

async function finalizeDeleteConversation(id) {
  const pending = state.pendingDeletes.get(id);
  if (!pending) return;
  state.pendingDeletes.delete(id);
  if (state.activeUndoDeleteId === id) state.activeUndoDeleteId = null;
  renderUndoToast();
  try {
    await api(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
    clearDraftForConversation(id);
    clearAttachmentsForConversation(id);
  } catch (err) {
    const insertAt = Math.min(Math.max(pending.index, 0), state.conversations.length);
    if (!state.conversations.some((conversation) => conversation.id === pending.item.id)) {
      state.conversations.splice(insertAt, 0, pending.item);
    }
    renderConversationList();
    setTransientStatus(`删除失败：${err.message}`, true);
  }
}

function renderUndoToast() {
  const toast = el('#undoToast');
  if (!toast) return;
  const pending = state.activeUndoDeleteId ? state.pendingDeletes.get(state.activeUndoDeleteId) : null;
  toast.classList.toggle('hidden', !pending);
  if (!pending) return;
  const text = el('#undoToastText');
  if (text) text.textContent = `已移除“${pending.item.title || '新的答疑'}”`;
}

function renderProviderSelect() {
  const selects = [...document.querySelectorAll('[data-provider-select="true"]')];
  if (!selects.length) return;
  if (!state.providers.length) {
    for (const select of selects) {
      select.innerHTML = `<option value="">暂无可用模型</option>`;
      select.disabled = true;
    }
    return;
  }
  if (!state.currentProviderId || !state.providers.some((p) => p.id === state.currentProviderId)) {
    const defaultProvider = state.providers.find((p) => p.is_default) || state.providers[0];
    state.currentProviderId = defaultProvider?.id || null;
  }
  const options = state.providers
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  for (const select of selects) {
    select.disabled = false;
    select.innerHTML = options;
    select.value = state.currentProviderId || '';
  }
}

function updateChatTopbarTitle() {
  const title = el('#chatTopbarTitle');
  if (title) title.textContent = currentConversationDisplayTitle();
  updateTopbarActions();
}

function updateTopbarActions() {
  const hasConversation = Boolean(state.currentConversationId);
  const hasMessages = Boolean((state.currentMessages || []).length);
  el('#topbarRenameBtn')?.toggleAttribute('disabled', !hasConversation || state.sending);
  el('#topbarCopyLinkBtn')?.toggleAttribute('disabled', !hasConversation);
  el('#topbarExportMdBtn')?.toggleAttribute('disabled', !hasMessages);
  el('#topbarExportPdfBtn')?.toggleAttribute('disabled', !hasMessages);
}

function renderMessages(messages) {
  const box = el('#messages');
  if (!box) return Promise.resolve();
  closeSelectionToolbar();
  state.currentMessages = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
  updateTopbarActions();
  messageContents.clear();
  localRetrySources.clear();
  if (!messages.length) {
    el('.main')?.classList.add('chat-empty');
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-brand-mark">研</div>
        <h2>今天想攻克哪道题？</h2>
        <p>把卡住的那一步放进来，我们慢慢拆。</p>
      </div>`;
    renderMessageOutline();
    applyConversationFind();
    return Promise.resolve();
  }
  el('.main')?.classList.remove('chat-empty');
  box.innerHTML = messages.map((message) => renderMessage(message)).join('');
  renderMessageOutline();
  enhanceAnswerSections(box);
  enhanceCodeBlocks(box);
  const hasActiveFind = Boolean(state.conversationFindQuery.trim());
  if (!hasActiveFind) scrollMessages(true);
  return ensureMathRendered(box).finally(() => {
    applyConversationFind({ scroll: hasActiveFind });
    scrollMessages();
    queueMathRecovery(box);
  });
}

function renderMessage(message) {
  const roleName = message.role === 'user' ? '学生' : '助手';
  const attachments = message.attachments || [];
  if (message.id) messageContents.set(String(message.id), message.content || '');
  const imageHtml = attachments.length
    ? `<div class="message-images">${attachments.map((a) => renderImageThumb(a)).join('')}</div>`
    : '';
  const metaHtml = renderMessageMeta(message);
  const sectionNavHtml = renderAnswerSectionNav(message);
  const followUpHtml = renderFollowUpSuggestions(message);
  const quickActionsHtml = renderMessageQuickActions(message);
  const actionsHtml = renderMessageActions(message);
  return `
    <article class="message ${message.role} ${isMessageSaved(message) ? 'saved' : ''}" data-message-id="${escapeAttr(message.id || '')}">
      <div class="message-role">${roleName}</div>
      <div class="message-card">
        ${quickActionsHtml}
        ${sectionNavHtml}
        <div class="message-content">${renderMarkdown(message.content || '')}</div>
        ${imageHtml}
        ${metaHtml}
        ${followUpHtml}
        ${actionsHtml}
      </div>
    </article>`;
}

function renderFollowUpSuggestions(message) {
  if (message?.role !== 'assistant' || !message?.id || String(message.id).startsWith('local_') || !isLatestAssistantMessage(message.id)) return '';
  return `<div class="follow-up-suggestions" aria-label="追问建议">
    ${FOLLOW_UP_PROMPTS.map((item) => `<button class="follow-up-suggestion" data-follow-up-prompt="${escapeAttr(item.id)}" type="button">${escapeHtml(item.label)}</button>`).join('')}
  </div>`;
}

function renderAnswerSectionNav(message) {
  if (message?.role !== 'assistant') return '';
  const headings = extractMarkdownHeadings(message.content || '');
  if (headings.length < 2) return '';
  return `<div class="answer-section-nav" aria-label="回答目录">
    ${headings.slice(0, 8).map((heading, index) => `
      <button class="answer-section-link level-${heading.level}" data-answer-section="${index}" type="button">${escapeHtml(heading.text)}</button>`).join('')}
  </div>`;
}

function extractMarkdownHeadings(markdown) {
  const headings = [];
  let inFence = false;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[`*_~[\]()]/g, '').trim();
    if (text) headings.push({ level: match[1].length, text });
    if (headings.length >= 12) break;
  }
  return headings;
}

function renderMessageOutline() {
  const outline = el('#messageOutline');
  if (!outline) return;
  const messages = (state.currentMessages || []).filter((message) => message?.id && !String(message.id).startsWith('local_'));
  outline.classList.toggle('hidden', !messages.length);
  if (!messages.length) {
    outline.innerHTML = '';
    return;
  }
  outline.innerHTML = `
    <div class="message-outline-title">本轮大纲</div>
    <div class="message-outline-list">
      ${messages.slice(-16).map((message, index) => renderMessageOutlineItem(message, Math.max(0, messages.length - 16) + index)).join('')}
    </div>`;
}

function renderMessageOutlineItem(message, index) {
  const roleName = message.role === 'user' ? '学生' : '助手';
  const snippet = cleanExcerpt(message.content || (message.attachments?.length ? '图片附件' : ''), 72) || '空消息';
  return `
    <button class="message-outline-item ${isMessageSaved(message) ? 'saved' : ''}" data-outline-message="${escapeAttr(message.id)}" type="button">
      <span class="message-outline-meta">${index + 1}. ${roleName}${isMessageSaved(message) ? ' · 已收藏' : ''}</span>
      <span class="message-outline-snippet">${escapeHtml(snippet)}</span>
    </button>`;
}

function handleMessageOutlineClick(event) {
  const button = event.target.closest('[data-outline-message]');
  if (!button) return;
  focusMessage(button.dataset.outlineMessage || '');
}

function renderMessageMeta(message) {
  const parts = messageMetaParts(message);
  return parts.length ? `<div class="message-meta">${parts.map(escapeHtml).join(' · ')}</div>` : '';
}

function focusMessage(messageId) {
  const article = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
  if (!article) return;
  article.scrollIntoView({ block: 'center', behavior: 'auto' });
  article.classList.add('message-highlight');
  setTimeout(() => article.classList.remove('message-highlight'), 2600);
}

async function sendMessage() {
  if (state.sending) return;
  const input = el('#messageInput');
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  recordComposerHistory(text);
  const draftConversationId = state.currentConversationId;
  const pendingAttachments = [...state.attachments];
  if (!state.currentConversationId) await createConversation({ preserveComposer: true });

  startSending('模型思考中...');
  el('#sendStatus').textContent = '模型思考中...';
  const abortController = state.abortController;

  const messagesBox = el('#messages');
  if (messagesBox.querySelector('.empty-state')) messagesBox.innerHTML = '';
  const userMessage = {
    id: `local_user_${Date.now()}`,
    role: 'user',
    content: text,
    attachments: pendingAttachments
  };
  messageContents.set(userMessage.id, userMessage.content);
  messagesBox.insertAdjacentHTML('beforeend', renderMessage(userMessage));
  const assistantId = `local_assistant_${Date.now()}`;
  messageContents.set(assistantId, '');
  localRetrySources.set(assistantId, {
    conversationId: state.currentConversationId,
    userMessageId: userMessage.id,
    message: text,
    attachments: pendingAttachments
  });
  messagesBox.insertAdjacentHTML('beforeend', `
    <article class="message assistant" data-message-id="${assistantId}">
      <div class="message-role">助手</div>
      <div class="message-card">
        <div class="think-line" id="${assistantId}_think">
          <span class="think-badge">Think</span>
          <span class="think-text">深度思考中 · 0s</span>
        </div>
        ${renderMessageQuickActions({ id: assistantId, role: 'assistant' }, { retryDisabled: true, continueDisabled: true })}
        <div class="message-content streaming" id="${assistantId}_content"></div>
        ${renderMessageActions({ id: assistantId, role: 'assistant' }, { exportDisabled: true, retryDisabled: true })}
      </div>
    </article>`);
  queueMathRecovery(messagesBox, [0, 300, 1200]);
  scrollMessages(true);

  input.value = '';
  clearDraftForConversation(draftConversationId);
  clearDraftForConversation(state.currentConversationId);
  autoResizeTextarea(input);
  const attachments = [...pendingAttachments];
  state.attachments = [];
  clearAttachmentsForConversation(draftConversationId);
  clearAttachmentsForConversation(state.currentConversationId);
  renderAttachments();

  let assistantRaw = '';
  let firstDeltaAt = null;
  let completed = false;
  let streamError = false;
  const thinkStartedAt = Date.now();
  const thinkEl = el(`#${assistantId}_think`);
  const thinkTimer = setInterval(() => {
    updateThinkLine(thinkEl, thinkStartedAt, firstDeltaAt ? '输出中' : '深度思考中');
  }, 1000);
  updateThinkLine(thinkEl, thinkStartedAt, '深度思考中');
  try {
    const response = await fetch(`${API}/chat`, {
      method: 'POST',
      credentials: 'include',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.currentConversationId,
        providerId: state.currentProviderId,
        message: text,
        attachments
      })
    });
    if (!response.ok) throw new Error(await errorText(response));
    await readSse(response, {
      meta(data) {
        if (data.conversationId) state.currentConversationId = data.conversationId;
        if (data.conversationTitle) updateConversationTitle(data.conversationId || state.currentConversationId, data.conversationTitle);
        const retrySource = localRetrySources.get(assistantId);
        if (retrySource) {
          retrySource.conversationId = data.conversationId || state.currentConversationId;
          if (data.userMessageId) retrySource.userMessageId = data.userMessageId;
        }
        if (data.userMessageId) {
          promoteRenderedMessage(userMessage.id, {
            id: data.userMessageId,
            role: 'user',
            content: text,
            attachments: pendingAttachments
          });
        }
      },
      delta(data) {
        assistantRaw += data.text || '';
        messageContents.set(assistantId, assistantRaw);
        if (!firstDeltaAt && assistantRaw) {
          firstDeltaAt = Date.now();
          updateThinkLine(thinkEl, thinkStartedAt, '输出中');
        }
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
        scrollMessages();
      },
      error(data) {
        streamError = true;
        const target = el(`#${assistantId}_content`);
        assistantRaw += `\n\n[错误] ${data.message || '模型调用失败'}`;
        messageContents.set(assistantId, assistantRaw);
        if (target) scheduleStreamingRender(target, assistantRaw);
      },
      async done(data) {
        completed = true;
        clearInterval(thinkTimer);
        finishThinkLine(thinkEl, thinkStartedAt);
        const target = el(`#${assistantId}_content`);
        if (target) {
          target.classList.remove('streaming');
          await flushStreamingRender(target, assistantRaw);
          const finalId = enableAssistantActions(assistantId, {
            exportEnabled: Boolean(assistantRaw.trim()),
            allowLocalRetry: streamError || !data?.assistantMessageId,
            message: assistantMessageFromDone(data, assistantRaw)
          });
          if (finalId !== assistantId) localRetrySources.delete(assistantId);
          queueMathRecovery(target);
        }
      }
    }, abortController.signal);
    const target = el(`#${assistantId}_content`);
    if (target && !completed) {
      target.classList.remove('streaming');
      await flushStreamingRender(target, assistantRaw);
      enableAssistantActions(assistantId, { exportEnabled: Boolean(assistantRaw.trim()), allowLocalRetry: true });
      queueMathRecovery(target);
    }
    if (!completed) finishThinkLine(thinkEl, thinkStartedAt);
    await loadConversations();
    if (!streamError) {
      await refreshCurrentConversationMessages();
      await refreshStudyMemoryAfterAnswer();
    }
  } catch (err) {
    const target = el(`#${assistantId}_content`);
    const stopped = isAbortError(err);
    if (target) {
      const fallback = stopped
        ? `${assistantRaw}${assistantRaw.trim() ? '\n\n' : ''}[已停止生成]`
        : `发送失败：${err.message}`;
      await flushStreamingRender(target, fallback);
      enableAssistantActions(assistantId, { exportEnabled: Boolean((assistantRaw || fallback).trim()), allowLocalRetry: true });
    }
    finishThinkLine(thinkEl, thinkStartedAt, true, stopped ? '已停止生成' : '请求结束');
  } finally {
    clearInterval(thinkTimer);
    finishSending();
    queueMathRecovery(messagesBox);
    scrollMessages();
  }
}

async function retryMessage(messageId) {
  if (state.sending || !state.currentConversationId || !messageId) return;
  const isLocalRetry = String(messageId).startsWith('local_');
  const retrySource = isLocalRetry ? localRetrySources.get(messageId) : null;
  const retryMessageId = retrySource?.retryOf && !String(retrySource.retryOf).startsWith('local_')
    ? retrySource.retryOf
    : isLocalRetry ? '' : messageId;
  const retryUserMessageId = retrySource?.userMessageId && !String(retrySource.userMessageId).startsWith('local_')
    ? retrySource.userMessageId
    : '';
  if (isLocalRetry && !retryMessageId && !retryUserMessageId) {
    await resendLocalRetrySource(retrySource);
    return;
  }

  startSending('正在重新生成...');
  const abortController = state.abortController;

  const oldArticle = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
  oldArticle?.classList.add('retry-source');
  const assistantId = `local_retry_${Date.now()}`;
  messageContents.set(assistantId, '');
  localRetrySources.set(assistantId, {
    conversationId: state.currentConversationId,
    retryOf: retryMessageId || messageId,
    userMessageId: retryUserMessageId,
    message: retrySource?.message || '',
    attachments: retrySource?.attachments || []
  });
  const placeholder = `
    <article class="message assistant" data-message-id="${assistantId}">
      <div class="message-role">助手</div>
      <div class="message-card">
        <div class="think-line" id="${assistantId}_think">
          <span class="think-badge">Think</span>
          <span class="think-text">重新生成中 · 0s</span>
        </div>
        ${renderMessageQuickActions({ id: assistantId, role: 'assistant' }, { retryDisabled: true, continueDisabled: true })}
        <div class="message-content streaming" id="${assistantId}_content"></div>
        ${renderMessageActions({ id: assistantId, role: 'assistant' }, { exportDisabled: true, retryDisabled: true })}
      </div>
    </article>`;
  if (oldArticle) {
    oldArticle.insertAdjacentHTML('afterend', placeholder);
  } else {
    el('#messages')?.insertAdjacentHTML('beforeend', placeholder);
    scrollMessages(true);
  }
  updateScrollAffordance();

  let assistantRaw = '';
  let completed = false;
  let streamError = false;
  const thinkStartedAt = Date.now();
  const thinkEl = el(`#${assistantId}_think`);
  const thinkTimer = setInterval(() => {
    updateThinkLine(thinkEl, thinkStartedAt, assistantRaw ? '输出中' : '重新生成中');
  }, 1000);
  updateThinkLine(thinkEl, thinkStartedAt, '重新生成中');

  try {
    const response = await fetch(`${API}/chat/retry`, {
      method: 'POST',
      credentials: 'include',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.currentConversationId,
        providerId: state.currentProviderId,
        ...(retryMessageId ? { messageId: retryMessageId } : {}),
        ...(retryUserMessageId ? { userMessageId: retryUserMessageId } : {})
      })
    });
    if (!response.ok) throw new Error(await errorText(response));
    await readSse(response, {
      meta(data) {
        if (data.conversationId) state.currentConversationId = data.conversationId;
        const nextRetrySource = localRetrySources.get(assistantId);
        if (nextRetrySource) {
          nextRetrySource.conversationId = data.conversationId || state.currentConversationId;
          if (data.retryOf) nextRetrySource.retryOf = data.retryOf;
          if (data.userMessageId) nextRetrySource.userMessageId = data.userMessageId;
        }
      },
      delta(data) {
        assistantRaw += data.text || '';
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
        scrollMessages();
      },
      error(data) {
        streamError = true;
        assistantRaw += `\n\n[错误] ${data.message || '重新生成失败'}`;
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
      },
      async done(data) {
        completed = true;
        clearInterval(thinkTimer);
        finishThinkLine(thinkEl, thinkStartedAt);
        const target = el(`#${assistantId}_content`);
        if (target) {
          target.classList.remove('streaming');
          await flushStreamingRender(target, assistantRaw);
          const finalId = enableAssistantActions(assistantId, {
            exportEnabled: Boolean(assistantRaw.trim()),
            allowLocalRetry: streamError || !data?.assistantMessageId,
            message: assistantMessageFromDone(data, assistantRaw)
          });
          if (finalId !== assistantId) localRetrySources.delete(assistantId);
          queueMathRecovery(target);
        }
      }
    }, abortController.signal);
    const target = el(`#${assistantId}_content`);
    if (target && !completed) {
      target.classList.remove('streaming');
      await flushStreamingRender(target, assistantRaw);
      enableAssistantActions(assistantId, { exportEnabled: Boolean(assistantRaw.trim()), allowLocalRetry: true });
      queueMathRecovery(target);
    }
    if (!completed) finishThinkLine(thinkEl, thinkStartedAt);
    await loadConversations();
    if (!streamError) {
      await refreshCurrentConversationMessages();
      await refreshStudyMemoryAfterAnswer();
    }
  } catch (err) {
    const target = el(`#${assistantId}_content`);
    const stopped = isAbortError(err);
    if (target) {
      const fallback = stopped
        ? `${assistantRaw}${assistantRaw.trim() ? '\n\n' : ''}[已停止生成]`
        : `重新生成失败：${err.message}`;
      await flushStreamingRender(target, fallback);
      enableAssistantActions(assistantId, { exportEnabled: Boolean((assistantRaw || fallback).trim()), allowLocalRetry: true });
    }
    finishThinkLine(thinkEl, thinkStartedAt, true, stopped ? '已停止生成' : '请求结束');
  } finally {
    clearInterval(thinkTimer);
    finishSending();
    oldArticle?.classList.remove('retry-source');
    queueMathRecovery(el('#messages'));
    scrollMessages();
  }
}

async function resendLocalRetrySource(source) {
  const text = String(source?.message || '').trim();
  if (!text && !(source?.attachments || []).length) {
    setTransientStatus('找不到可重新生成的问题。', true);
    return;
  }
  const input = el('#messageInput');
  if (input) {
    input.value = text;
    autoResizeTextarea(input);
  }
  state.attachments = (source.attachments || []).map((item) => ({ ...item }));
  saveCurrentAttachments();
  renderAttachments();
  await sendMessage();
}

async function continueMessage(messageId) {
  if (state.sending || !state.currentConversationId || !messageId || messageId.startsWith('local_')) return;

  startSending('正在继续回答...');
  const abortController = state.abortController;

  const sourceArticle = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
  sourceArticle?.classList.add('retry-source');
  const assistantId = `local_continue_${Date.now()}`;
  messageContents.set(assistantId, '');
  const placeholder = `
    <article class="message assistant" data-message-id="${assistantId}">
      <div class="message-role">助手</div>
      <div class="message-card">
        <div class="think-line" id="${assistantId}_think">
          <span class="think-badge">Think</span>
          <span class="think-text">继续回答中 · 0s</span>
        </div>
        ${renderMessageQuickActions({ id: assistantId, role: 'assistant' }, { retryDisabled: true, continueDisabled: true })}
        <div class="message-content streaming" id="${assistantId}_content"></div>
        ${renderMessageActions({ id: assistantId, role: 'assistant' }, { exportDisabled: true, retryDisabled: true, continueDisabled: true })}
      </div>
    </article>`;
  if (sourceArticle) {
    sourceArticle.insertAdjacentHTML('afterend', placeholder);
  } else {
    el('#messages')?.insertAdjacentHTML('beforeend', placeholder);
  }
  scrollMessages(true);
  updateScrollAffordance();

  let assistantRaw = '';
  let completed = false;
  let streamError = false;
  const thinkStartedAt = Date.now();
  const thinkEl = el(`#${assistantId}_think`);
  const thinkTimer = setInterval(() => {
    updateThinkLine(thinkEl, thinkStartedAt, assistantRaw ? '输出中' : '继续回答中');
  }, 1000);
  updateThinkLine(thinkEl, thinkStartedAt, '继续回答中');

  try {
    const response = await fetch(`${API}/chat/continue`, {
      method: 'POST',
      credentials: 'include',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.currentConversationId,
        providerId: state.currentProviderId,
        messageId
      })
    });
    if (!response.ok) throw new Error(await errorText(response));
    await readSse(response, {
      meta(data) {
        if (data.conversationId) state.currentConversationId = data.conversationId;
      },
      delta(data) {
        assistantRaw += data.text || '';
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
        scrollMessages();
      },
      error(data) {
        streamError = true;
        assistantRaw += `\n\n[错误] ${data.message || '继续回答失败'}`;
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
      },
      async done(data) {
        completed = true;
        clearInterval(thinkTimer);
        finishThinkLine(thinkEl, thinkStartedAt);
        const target = el(`#${assistantId}_content`);
        if (target) {
          target.classList.remove('streaming');
          await flushStreamingRender(target, assistantRaw);
          enableAssistantActions(assistantId, {
            exportEnabled: Boolean(assistantRaw.trim()),
            message: assistantMessageFromDone(data, assistantRaw)
          });
          queueMathRecovery(target);
        }
      }
    }, abortController.signal);
    const target = el(`#${assistantId}_content`);
    if (target && !completed) {
      target.classList.remove('streaming');
      await flushStreamingRender(target, assistantRaw);
      enableAssistantActions(assistantId, { exportEnabled: Boolean(assistantRaw.trim()) });
      queueMathRecovery(target);
    }
    if (!completed) finishThinkLine(thinkEl, thinkStartedAt);
    await loadConversations();
    if (!streamError) {
      await refreshCurrentConversationMessages();
      await refreshStudyMemoryAfterAnswer();
    }
  } catch (err) {
    const target = el(`#${assistantId}_content`);
    const stopped = isAbortError(err);
    if (target) {
      const fallback = stopped
        ? `${assistantRaw}${assistantRaw.trim() ? '\n\n' : ''}[已停止生成]`
        : `继续回答失败：${err.message}`;
      await flushStreamingRender(target, fallback);
      enableAssistantActions(assistantId, { exportEnabled: Boolean((assistantRaw || fallback).trim()) });
    }
    finishThinkLine(thinkEl, thinkStartedAt, true, stopped ? '已停止生成' : '请求结束');
  } finally {
    clearInterval(thinkTimer);
    finishSending();
    sourceArticle?.classList.remove('retry-source');
    queueMathRecovery(el('#messages'));
    scrollMessages();
  }
}

function startMessageEdit(messageId, article) {
  if (state.sending || !messageId || !article) return;
  const saved = state.currentMessages.find((message) => String(message.id || '') === String(messageId));
  if (saved?.role !== 'user') return;
  const content = messageContents.get(messageId) ?? saved.content ?? '';
  const contentEl = article.querySelector('.message-content');
  if (!contentEl) return;
  article.classList.add('message-editing');
  contentEl.innerHTML = `
    <div class="message-edit-panel">
      <textarea class="message-edit-input" rows="4" aria-label="编辑问题"></textarea>
      <div class="message-edit-actions">
        <button class="message-action primary" data-submit-edit-message="${escapeAttr(messageId)}" type="button">保存并重问</button>
        <button class="message-action" data-cancel-edit-message="${escapeAttr(messageId)}" type="button">取消</button>
      </div>
    </div>`;
  const textarea = contentEl.querySelector('.message-edit-input');
  textarea.value = content;
  textarea.focus();
  textarea.selectionStart = textarea.value.length;
  textarea.selectionEnd = textarea.value.length;
  resizeEditTextarea(textarea);
  textarea.addEventListener('input', () => resizeEditTextarea(textarea));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelMessageEdit(messageId, article);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitMessageEdit(messageId, textarea.value, article);
    }
  });
}

async function cancelMessageEdit(messageId, article) {
  if (!article) return;
  const content = messageContents.get(messageId) || '';
  const contentEl = article.querySelector('.message-content');
  article.classList.remove('message-editing');
  if (contentEl) await renderMessageContent(contentEl, content);
}

async function submitMessageEdit(messageId, value, article) {
  const text = String(value || '').trim();
  if (!text) {
    el('#sendStatus').textContent = '编辑后的问题不能为空。';
    return;
  }
  const original = String(messageContents.get(messageId) || '').trim();
  if (text === original) {
    await cancelMessageEdit(messageId, article);
    return;
  }
  await editAndResendMessage(messageId, text, article);
}

async function editAndResendMessage(messageId, text, article) {
  if (state.sending || !state.currentConversationId || !messageId || !article) return;

  startSending('正在修改并重问...');
  const abortController = state.abortController;
  const contentEl = article.querySelector('.message-content');
  article.classList.remove('message-editing');
  article.classList.add('retry-source');
  messageContents.set(messageId, text);
  if (contentEl) await renderMessageContent(contentEl, text);

  const staleArticles = [];
  let next = article.nextElementSibling;
  while (next?.classList?.contains('message')) {
    staleArticles.push(next);
    next.classList.add('retry-source');
    next = next.nextElementSibling;
  }

  const assistantId = `local_edit_${Date.now()}`;
  messageContents.set(assistantId, '');
  article.insertAdjacentHTML('afterend', `
    <article class="message assistant" data-message-id="${assistantId}">
      <div class="message-role">助手</div>
      <div class="message-card">
        <div class="think-line" id="${assistantId}_think">
          <span class="think-badge">Think</span>
          <span class="think-text">修改后重答中 · 0s</span>
        </div>
        ${renderMessageQuickActions({ id: assistantId, role: 'assistant' }, { retryDisabled: true, continueDisabled: true })}
        <div class="message-content streaming" id="${assistantId}_content"></div>
        ${renderMessageActions({ id: assistantId, role: 'assistant' }, { exportDisabled: true, retryDisabled: true })}
      </div>
    </article>`);
  updateScrollAffordance();

  let assistantRaw = '';
  let completed = false;
  let streamError = false;
  const thinkStartedAt = Date.now();
  const thinkEl = el(`#${assistantId}_think`);
  const thinkTimer = setInterval(() => {
    updateThinkLine(thinkEl, thinkStartedAt, assistantRaw ? '输出中' : '修改后重答中');
  }, 1000);
  updateThinkLine(thinkEl, thinkStartedAt, '修改后重答中');

  try {
    const response = await fetch(`${API}/chat/edit`, {
      method: 'POST',
      credentials: 'include',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.currentConversationId,
        providerId: state.currentProviderId,
        messageId,
        message: text
      })
    });
    if (!response.ok) throw new Error(await errorText(response));
    await readSse(response, {
      meta(data) {
        if (data.conversationId) state.currentConversationId = data.conversationId;
        if (data.editedMessageId) {
          promoteRenderedMessage(messageId, {
            id: data.editedMessageId,
            role: 'user',
            content: text,
            attachments: []
          });
        }
      },
      delta(data) {
        assistantRaw += data.text || '';
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
        scrollMessages();
      },
      error(data) {
        streamError = true;
        assistantRaw += `\n\n[错误] ${data.message || '修改并重问失败'}`;
        messageContents.set(assistantId, assistantRaw);
        const target = el(`#${assistantId}_content`);
        if (target) scheduleStreamingRender(target, assistantRaw);
      },
      async done(data) {
        completed = true;
        clearInterval(thinkTimer);
        finishThinkLine(thinkEl, thinkStartedAt);
        const target = el(`#${assistantId}_content`);
        if (target) {
          target.classList.remove('streaming');
          await flushStreamingRender(target, assistantRaw);
          enableAssistantActions(assistantId, {
            exportEnabled: Boolean(assistantRaw.trim()),
            message: assistantMessageFromDone(data, assistantRaw)
          });
          queueMathRecovery(target);
        }
      }
    }, abortController.signal);
    const target = el(`#${assistantId}_content`);
    if (target && !completed) {
      target.classList.remove('streaming');
      await flushStreamingRender(target, assistantRaw);
      enableAssistantActions(assistantId, { exportEnabled: Boolean(assistantRaw.trim()) });
      queueMathRecovery(target);
    }
    if (!completed) finishThinkLine(thinkEl, thinkStartedAt);
    await loadConversations();
    await refreshCurrentConversationMessages();
    await refreshStudyMemoryAfterAnswer();
  } catch (err) {
    const target = el(`#${assistantId}_content`);
    const stopped = isAbortError(err);
    if (target) {
      const fallback = stopped
        ? `${assistantRaw}${assistantRaw.trim() ? '\n\n' : ''}[已停止生成]`
        : `修改并重问失败：${err.message}`;
      await flushStreamingRender(target, fallback);
      enableAssistantActions(assistantId, { exportEnabled: Boolean((assistantRaw || fallback).trim()) });
    }
    finishThinkLine(thinkEl, thinkStartedAt, true, stopped ? '已停止生成' : '请求结束');
    await refreshCurrentConversationMessages();
  } finally {
    clearInterval(thinkTimer);
    finishSending();
    article.classList.remove('retry-source');
    staleArticles.forEach((item) => item.classList.remove('retry-source'));
    queueMathRecovery(el('#messages'));
    scrollMessages();
  }
}

function resizeEditTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 96), 360)}px`;
}

async function handleImages(event) {
  const input = event.target;
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  await appendImageFiles(files);
}

async function handlePaste(event) {
  const items = [...(event.clipboardData?.items || [])];
  const files = items
    .filter((item) => item.kind === 'file' && /^image\/(png|jpeg|webp)$/.test(item.type))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  await appendImageFiles(files, '粘贴图片');
}

function handleComposerDragEnter(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  composerDragDepth += 1;
  setComposerDragState(true);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleComposerDragOver(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  setComposerDragState(true);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleComposerDragLeave(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  composerDragDepth = Math.max(0, composerDragDepth - 1);
  if (composerDragDepth === 0) setComposerDragState(false);
}

async function handleComposerDrop(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  composerDragDepth = 0;
  setComposerDragState(false);
  const files = imageFilesFromDataTransfer(event.dataTransfer);
  if (!files.length) {
    setTransientStatus('只支持 PNG、JPG 或 WebP 图片。', true);
    return;
  }
  await appendImageFiles(files, '拖拽图片');
}

function isFileDrag(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  const types = [...(transfer.types || [])];
  if (types.includes('Files')) return true;
  return [...(transfer.items || [])].some((item) => item.kind === 'file');
}

function imageFilesFromDataTransfer(transfer) {
  return [...(transfer?.files || [])].filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
}

function setComposerDragState(active) {
  el('.composer-inner')?.classList.toggle('drag-over', Boolean(active));
}

function handleQuickPromptClick(event) {
  const button = event.target.closest('[data-quick-prompt]');
  if (!button) return;
  const prompt = QUICK_PROMPTS.find((item) => item.id === button.dataset.quickPrompt);
  if (!prompt) return;
  appendToComposer(prompt.text);
  closeSlashPromptMenu();
  flashButtonText(button, '已添加');
}

function handleFollowUpSuggestionClick(button) {
  const prompt = FOLLOW_UP_PROMPTS.find((item) => item.id === button.dataset.followUpPrompt);
  if (!prompt) return;
  appendToComposer(prompt.text);
  closeSelectionToolbar({ clearSelection: true });
  flashButtonText(button, '已添加');
}

function appendToComposer(text) {
  const input = el('#messageInput');
  if (!input) return;
  const value = input.value.trimEnd();
  input.value = value ? `${value}\n\n${text}` : text;
  saveDraftForConversation(state.currentConversationId, input.value);
  autoResizeTextarea(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function updateSlashPromptMenu(input = el('#messageInput')) {
  const match = slashPromptMatch(input);
  if (!match) {
    closeSlashPromptMenu();
    return;
  }
  const matches = slashPromptMatches(match.query);
  if (!matches.length) {
    closeSlashPromptMenu();
    return;
  }
  const index = state.slashPromptMenu.open
    ? Math.min(state.slashPromptMenu.index, matches.length - 1)
    : 0;
  state.slashPromptMenu = { open: true, query: match.query, index, matches };
  renderSlashPromptMenu();
}

function slashPromptMatch(input) {
  if (!input || input.selectionStart !== input.selectionEnd) return null;
  const caret = input.selectionStart;
  const before = input.value.slice(0, caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const fragment = before.slice(lineStart);
  if (!/^\/[^\s/]*$/u.test(fragment)) return null;
  return { query: fragment.slice(1), start: lineStart, end: caret };
}

function slashPromptMatches(query) {
  const normalized = normalizeSearchText(query);
  const prompts = promptCatalog();
  if (!normalized) return prompts;
  return prompts.filter((item) => normalizeSearchText(`${item.id} ${item.label} ${item.text} ${item.sourceLabel || ''}`).includes(normalized));
}

function promptCatalog() {
  const builtIns = QUICK_PROMPTS.map((item) => ({ ...item, source: 'builtin', sourceLabel: '内置' }));
  const custom = (state.customPrompts || []).map((item) => ({ ...item, source: 'custom', sourceLabel: '自定义' }));
  return [...custom, ...builtIns];
}

function promptById(id) {
  return promptCatalog().find((item) => item.id === id);
}

function renderSlashPromptMenu() {
  const menu = el('#slashPromptMenu');
  if (!menu) return;
  const { open, matches, index } = state.slashPromptMenu;
  menu.classList.toggle('hidden', !open || !matches.length);
  if (!open || !matches.length) {
    menu.innerHTML = '';
    return;
  }
  menu.innerHTML = matches.map((item, itemIndex) => `
    <button class="slash-prompt-item ${itemIndex === index ? 'active' : ''}" data-slash-prompt="${escapeAttr(item.id)}" type="button" role="option" aria-selected="${itemIndex === index ? 'true' : 'false'}">
      <span>${escapeHtml(item.label)}</span>
      <small>${escapeHtml(item.sourceLabel ? `${item.sourceLabel} · ${item.text}` : item.text)}</small>
    </button>`).join('');
}

function handleSlashPromptKeydown(event) {
  if (!state.slashPromptMenu.open) return false;
  const matches = state.slashPromptMenu.matches || [];
  if (!matches.length) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    state.slashPromptMenu.index = (state.slashPromptMenu.index + delta + matches.length) % matches.length;
    renderSlashPromptMenu();
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    insertSlashPrompt(matches[state.slashPromptMenu.index]);
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSlashPromptMenu();
    return true;
  }
  return false;
}

function handleSlashPromptMouseDown(event) {
  const button = event.target.closest('[data-slash-prompt]');
  if (!button) return;
  event.preventDefault();
  const prompt = promptById(button.dataset.slashPrompt);
  if (prompt) insertSlashPrompt(prompt);
}

function insertSlashPrompt(prompt) {
  const input = el('#messageInput');
  const match = slashPromptMatch(input);
  if (!input || !match || !prompt) return;
  const before = input.value.slice(0, match.start);
  const after = input.value.slice(match.end);
  input.value = `${before}${prompt.text}${after}`;
  const caret = before.length + prompt.text.length;
  saveDraftForConversation(state.currentConversationId, input.value);
  autoResizeTextarea(input);
  input.focus();
  input.setSelectionRange(caret, caret);
  closeSlashPromptMenu();
}

function closeSlashPromptMenu() {
  state.slashPromptMenu = { open: false, query: '', index: 0, matches: [] };
  renderSlashPromptMenu();
}

async function handleMessageActionClick(event) {
  if (handleImagePreviewClick(event)) return;

  const followUpButton = event.target.closest('[data-follow-up-prompt]');
  if (followUpButton) {
    handleFollowUpSuggestionClick(followUpButton);
    return;
  }

  const sectionButton = event.target.closest('[data-answer-section]');
  if (sectionButton) {
    jumpToAnswerSection(sectionButton);
    return;
  }

  const mathTarget = event.target.closest('[data-copy-math]');
  if (mathTarget) {
    event.preventDefault();
    event.stopPropagation();
    await copyMathSource(mathTarget);
    return;
  }

  const cancelEditButton = event.target.closest('[data-cancel-edit-message]');
  if (cancelEditButton) {
    await cancelMessageEdit(cancelEditButton.dataset.cancelEditMessage || '', cancelEditButton.closest('[data-message-id]'));
    return;
  }

  const submitEditButton = event.target.closest('[data-submit-edit-message]');
  if (submitEditButton && !submitEditButton.disabled) {
    const article = submitEditButton.closest('[data-message-id]');
    const textarea = article?.querySelector('.message-edit-input');
    await submitMessageEdit(submitEditButton.dataset.submitEditMessage || '', textarea?.value || '', article);
    return;
  }

  const codeButton = event.target.closest('[data-copy-code]');
  if (codeButton) {
    const code = codeButton.closest('.code-block')?.querySelector('pre code')?.innerText || '';
    if (!code.trim()) return;
    await copyWithFeedback(codeButton, code);
    return;
  }

  const copyButton = event.target.closest('[data-copy-message]');
  if (copyButton) {
    const messageId = copyButton.dataset.copyMessage || '';
    const article = copyButton.closest('[data-message-id]');
    const content = messageContents.get(messageId) || article?.querySelector('.message-content')?.innerText || '';
    if (!content.trim()) return;
    await copyWithFeedback(copyButton, content);
    return;
  }

  const quoteButton = event.target.closest('[data-quote-message]');
  if (quoteButton && !quoteButton.disabled) {
    quoteMessageForFollowUp(quoteButton.dataset.quoteMessage || '', quoteButton.closest('[data-message-id]'));
    return;
  }

  const linkButton = event.target.closest('[data-copy-message-link]');
  if (linkButton && !linkButton.disabled) {
    await copyMessageLink(linkButton.dataset.copyMessageLink || '', linkButton);
    return;
  }

  const collapseButton = event.target.closest('[data-toggle-collapse-message]');
  if (collapseButton && !collapseButton.disabled) {
    toggleMessageCollapse(collapseButton.dataset.toggleCollapseMessage || '', collapseButton.closest('[data-message-id]'), collapseButton);
    return;
  }

  const editButton = event.target.closest('[data-edit-message]');
  if (editButton && !editButton.disabled) {
    startMessageEdit(editButton.dataset.editMessage || '', editButton.closest('[data-message-id]'));
    return;
  }

  const branchButton = event.target.closest('[data-branch-message]');
  if (branchButton && !branchButton.disabled) {
    await branchFromMessage(branchButton.dataset.branchMessage || '', branchButton);
    return;
  }

  const retryButton = event.target.closest('[data-retry-message]');
  if (retryButton && !retryButton.disabled) {
    await retryMessage(retryButton.dataset.retryMessage || '');
    return;
  }

  const continueButton = event.target.closest('[data-continue-message]');
  if (continueButton && !continueButton.disabled) {
    await continueMessage(continueButton.dataset.continueMessage || '');
    return;
  }

  const feedbackButton = event.target.closest('[data-feedback-message]');
  if (feedbackButton && !feedbackButton.disabled) {
    await setMessageFeedback(feedbackButton.dataset.feedbackMessage || '', feedbackButton.dataset.feedbackValue || '', feedbackButton);
    return;
  }

  const savedButton = event.target.closest('[data-save-message]');
  if (savedButton && !savedButton.disabled) {
    await setMessageSaved(savedButton.dataset.saveMessage || '', savedButton);
    return;
  }

  const exportButton = event.target.closest('[data-export-message]');
  if (exportButton && !exportButton.disabled) {
    const message = messageForExport(exportButton.dataset.exportMessage || '', exportButton.closest('[data-message-id]'));
    if (!message?.content?.trim()) return;
    const format = exportButton.dataset.exportFormat || 'md';
    await exportSingleMessage(message, format);
    flashButtonText(exportButton, format === 'pdf' ? '已下载' : '已导出');
  }
}

function toggleMessageCollapse(messageId, article, button) {
  if (!article || !messageId) return;
  const collapsed = !article.classList.contains('message-collapsed');
  article.classList.toggle('message-collapsed', collapsed);
  if (button) {
    button.textContent = collapsed ? '展开' : '收起';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (!collapsed) {
    article.querySelector('.message-content')?.scrollIntoView({ block: 'nearest' });
  }
}

function handleConversationFindInput(event) {
  state.conversationFindQuery = event.currentTarget.value;
  state.conversationFindIndex = state.conversationFindQuery.trim() ? 0 : -1;
  applyConversationFind({ scroll: true });
}

function handleConversationFindKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  stepConversationFind(event.shiftKey ? -1 : 1);
}

function stepConversationFind(direction) {
  const matches = conversationFindMatches();
  if (!matches.length) {
    applyConversationFind();
    return;
  }
  const current = state.conversationFindIndex < 0 ? 0 : state.conversationFindIndex;
  state.conversationFindIndex = (current + direction + matches.length) % matches.length;
  applyConversationFind({ scroll: true, matches });
}

function clearConversationFind() {
  state.conversationFindQuery = '';
  state.conversationFindIndex = -1;
  const input = el('#conversationFind');
  if (input) input.value = '';
  applyConversationFind();
  input?.focus();
}

function applyConversationFind(options = {}) {
  const articles = [...document.querySelectorAll('article.message[data-message-id]')];
  articles.forEach((article) => {
    article.classList.remove('message-find-hit', 'message-find-active');
  });

  const query = normalizeSearchText(state.conversationFindQuery);
  const matches = options.matches || conversationFindMatches(articles);
  if (!query || !matches.length) {
    state.conversationFindIndex = -1;
    updateConversationFindControls(query ? '0/0' : '', false);
    return;
  }

  if (state.conversationFindIndex < 0 || state.conversationFindIndex >= matches.length) {
    state.conversationFindIndex = 0;
  }
  matches.forEach((article, index) => {
    article.classList.add('message-find-hit');
    article.classList.toggle('message-find-active', index === state.conversationFindIndex);
  });
  updateConversationFindControls(`${state.conversationFindIndex + 1}/${matches.length}`, true);
  if (options.scroll) {
    matches[state.conversationFindIndex]?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

function updateConversationFindControls(label, enabled) {
  const count = el('#conversationFindCount');
  if (count) count.textContent = label;
  const hasQuery = Boolean(state.conversationFindQuery.trim());
  ['#conversationFindPrev', '#conversationFindNext'].forEach((selector) => {
    const button = el(selector);
    if (button) button.disabled = !enabled;
  });
  const clear = el('#conversationFindClear');
  if (clear) clear.disabled = !hasQuery;
}

function conversationFindMatches(existingArticles) {
  const query = normalizeSearchText(state.conversationFindQuery);
  if (!query) return [];
  const articles = existingArticles || [...document.querySelectorAll('article.message[data-message-id]')];
  return articles.filter((article) => {
    const messageId = article.dataset.messageId || '';
    const raw = messageContents.get(messageId) || '';
    const visible = article.innerText || '';
    return normalizeSearchText(`${visible} ${raw}`).includes(query);
  });
}

function quoteMessageForFollowUp(messageId, article) {
  const selectedText = selectedTextInside(article);
  const saved = state.currentMessages.find((message) => String(message.id || '') === String(messageId || ''));
  const content = selectedText || messageContents.get(messageId) || saved?.content || article?.querySelector('.message-content')?.innerText || '';
  const selected = Boolean(selectedText);
  const quote = buildFollowUpQuote(content, saved?.role || (article?.classList.contains('user') ? 'user' : 'assistant'), selected);
  if (!quote) {
    setTransientStatus('没有可追问的内容。', true);
    return;
  }
  appendToComposer(quote);
  setTransientStatus(selected ? '已引用选中内容。' : '已引用这条消息。');
}

function scheduleSelectionToolbarUpdate() {
  cancelAnimationFrame(selectionToolbarFrame);
  selectionToolbarFrame = requestAnimationFrame(updateSelectionToolbar);
}

function updateSelectionToolbar() {
  const toolbar = el('#selectionToolbar');
  const selection = window.getSelection?.();
  if (!toolbar || !selection || selection.isCollapsed || !selection.rangeCount || isSelectionInTextInput(selection)) {
    closeSelectionToolbar();
    return;
  }
  const article = selectedMessageArticle(selection);
  const text = selection.toString().trim();
  if (!article || text.length < 2) {
    closeSelectionToolbar();
    return;
  }
  const rect = selectionAnchorRect(selection.getRangeAt(0));
  if (!rect) {
    closeSelectionToolbar();
    return;
  }
  const toolbarHeight = 44;
  const margin = 8;
  const above = rect.top >= toolbarHeight + margin + 10;
  state.selectionToolbar = {
    open: true,
    messageId: article.dataset.messageId || '',
    role: article.classList.contains('user') ? 'user' : 'assistant',
    text,
    left: clamp(rect.left + rect.width / 2, 86, window.innerWidth - 86),
    top: above
      ? clamp(rect.top - 10, toolbarHeight + margin, window.innerHeight - margin)
      : clamp(rect.bottom + 10, margin, window.innerHeight - toolbarHeight - margin),
    placement: above ? 'above' : 'below'
  };
  renderSelectionToolbar();
}

function selectedMessageArticle(selection) {
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const startArticle = nodeElement(range.startContainer)?.closest?.('article.message[data-message-id]');
  const endArticle = nodeElement(range.endContainer)?.closest?.('article.message[data-message-id]');
  if (!startArticle || startArticle !== endArticle) return null;
  const content = startArticle.querySelector('.message-content');
  const common = range.commonAncestorContainer;
  if (!content || (common !== content && !content.contains(common))) return null;
  return startArticle;
}

function selectedTextInside(article) {
  if (!article) return '';
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  if (selectedMessageArticle(selection) !== article) return '';
  return selection.toString().trim();
}

function selectionAnchorRect(range) {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  const rect = rects[0] || range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return rect;
}

function nodeElement(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function isSelectionInTextInput(selection) {
  const node = selection?.anchorNode;
  const target = nodeElement(node);
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function renderSelectionToolbar() {
  const toolbar = el('#selectionToolbar');
  if (!toolbar) return;
  const { open, left, top, placement } = state.selectionToolbar;
  toolbar.classList.toggle('hidden', !open);
  toolbar.classList.toggle('below', placement === 'below');
  if (!open) return;
  toolbar.style.left = `${Math.round(left)}px`;
  toolbar.style.top = `${Math.round(top)}px`;
}

function handleSelectionToolbarMouseDown(event) {
  event.preventDefault();
  event.stopPropagation();
}

async function handleSelectionToolbarClick(event) {
  const button = event.target.closest('[data-selection-action]');
  if (!button || !state.selectionToolbar.open) return;
  event.preventDefault();
  event.stopPropagation();
  if (button.dataset.selectionAction === 'copy') {
    await copySelectionToolbarText(button);
    return;
  }
  if (button.dataset.selectionAction === 'quote') {
    quoteSelectionToolbarText();
  }
}

async function copySelectionToolbarText(button) {
  const text = state.selectionToolbar.text || '';
  if (!text.trim()) {
    closeSelectionToolbar({ clearSelection: true });
    return;
  }
  try {
    await copyText(text);
    setTransientStatus('选中文本已复制。');
    closeSelectionToolbar({ clearSelection: true });
  } catch {
    flashButtonText(button, '复制失败', { error: true });
    setTransientStatus('复制失败，请手动选中文本复制。', true);
  }
}

function quoteSelectionToolbarText() {
  const { text, role } = state.selectionToolbar;
  const quote = buildFollowUpQuote(text, role, true);
  if (!quote) {
    setTransientStatus('没有可追问的内容。', true);
    closeSelectionToolbar({ clearSelection: true });
    return;
  }
  appendToComposer(quote);
  setTransientStatus('已引用选中内容。');
  closeSelectionToolbar({ clearSelection: true });
}

function handleSelectionToolbarDocumentMouseDown(event) {
  if (event.target.closest?.('#selectionToolbar')) return;
  if (!event.target.closest?.('.message-content')) closeSelectionToolbar();
}

function closeSelectionToolbar(options = {}) {
  cancelAnimationFrame(selectionToolbarFrame);
  if (options?.clearSelection) window.getSelection?.().removeAllRanges();
  state.selectionToolbar = { open: false, messageId: '', role: '', text: '', left: 0, top: 0, placement: 'above' };
  renderSelectionToolbar();
}

function buildFollowUpQuote(content, role, selected) {
  const text = cleanQuoteText(content);
  if (!text) return '';
  const roleName = role === 'user' ? '学生原文' : '助手回复';
  const heading = selected ? '请针对我选中的这段内容继续讲解：' : `请针对下面这段${roleName}继续讲解：`;
  const quoted = text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return `${heading}\n\n${quoted}\n\n我的问题是：`;
}

function cleanQuoteText(content, limit = 1600) {
  const text = String(content || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n...`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to the textarea path when clipboard permissions are denied.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy_failed');
}

async function copyWithFeedback(button, text) {
  try {
    await copyText(text);
    flashButtonText(button, '已复制');
    showToast('已复制。');
  } catch {
    flashButtonText(button, '复制失败', { error: true });
    setTransientStatus('复制失败，请手动选中文本复制。', true);
  }
}

async function copyMathSource(target) {
  const source = target?.dataset?.copyMath || '';
  if (!source.trim()) return;
  try {
    await copyText(source);
    target.classList.add('copied');
    setTransientStatus('公式源码已复制。');
    setTimeout(() => target.classList.remove('copied'), 900);
  } catch {
    target.classList.add('copy-error');
    setTransientStatus('公式复制失败，请手动复制整段答案。', true);
    setTimeout(() => target.classList.remove('copy-error'), 900);
  }
}

async function copyMessageLink(messageId, button) {
  const link = buildMessageLink(messageId);
  if (!link) return;
  await copyWithFeedback(button, link);
}

async function copyConversationLink(conversationId, button) {
  const link = buildConversationLink(conversationId);
  if (!link) return;
  await copyWithFeedback(button, link);
}

function buildConversationLink(conversationId) {
  if (!conversationId) return '';
  return conversationRouteUrl(conversationId);
}

function buildMessageLink(messageId) {
  if (!messageId || String(messageId).startsWith('local_') || !state.currentConversationId) return '';
  return conversationRouteUrl(state.currentConversationId, messageId);
}

async function setMessageFeedback(messageId, value, button) {
  if (!messageId || String(messageId).startsWith('local_')) return;
  const message = state.currentMessages.find((item) => String(item.id || '') === String(messageId));
  if (!message || message.role !== 'assistant') return;
  const nextFeedback = message.feedback === value ? null : value;
  const previousFeedback = message.feedback || null;
  updateLocalMessageFeedback(messageId, nextFeedback);
  try {
    const data = await api(`/messages/${encodeURIComponent(messageId)}/feedback`, {
      method: 'POST',
      body: { feedback: nextFeedback }
    });
    updateLocalMessageFeedback(messageId, data.feedback || null);
    setTransientStatus(data.feedback === 'up' ? '已标记为有用。' : data.feedback === 'down' ? '已标记为需改进。' : '已取消反馈。');
  } catch (err) {
    updateLocalMessageFeedback(messageId, previousFeedback);
    flashButtonText(button, '失败', { error: true });
    setTransientStatus(`反馈保存失败：${err.message}`, true);
  }
}

async function setMessageSaved(messageId, button) {
  if (!messageId || String(messageId).startsWith('local_')) return;
  const message = state.currentMessages.find((item) => String(item.id || '') === String(messageId));
  if (!message) return;
  const nextSaved = !isMessageSaved(message);
  updateLocalMessageSaved(messageId, nextSaved);
  try {
    const data = await api(`/messages/${encodeURIComponent(messageId)}/saved`, {
      method: 'POST',
      body: { saved: nextSaved }
    });
    updateLocalMessageSaved(messageId, Boolean(data.saved));
    setTransientStatus(data.saved ? '已加入复习收藏。' : '已取消收藏。');
  } catch (err) {
    updateLocalMessageSaved(messageId, !nextSaved);
    flashButtonText(button, '失败', { error: true });
    setTransientStatus(`收藏保存失败：${err.message}`, true);
  }
}

function updateLocalMessageFeedback(messageId, feedback) {
  state.currentMessages = state.currentMessages.map((message) => (
    String(message.id || '') === String(messageId) ? { ...message, feedback } : message
  ));
  const article = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
  if (!article) return;
  article.querySelectorAll('[data-feedback-message]').forEach((button) => {
    const active = feedback && button.dataset.feedbackValue === feedback;
    button.classList.toggle('active', Boolean(active));
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateLocalMessageSaved(messageId, saved) {
  state.currentMessages = state.currentMessages.map((message) => (
    String(message.id || '') === String(messageId) ? { ...message, saved: saved ? 1 : 0 } : message
  ));
  const article = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
  if (!article) return;
  article.classList.toggle('saved', Boolean(saved));
  const button = article.querySelector('[data-save-message]');
  if (button) {
    button.classList.toggle('active', Boolean(saved));
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.textContent = saved ? '已收藏' : '收藏';
  }
  updateRenderedMessageMeta(article, state.currentMessages.find((message) => String(message.id || '') === String(messageId)) || {});
}

function isMessageSaved(message) {
  return Boolean(Number(message?.saved || 0));
}

function flashButtonText(button, text, options = {}) {
  const original = button.textContent;
  const hadError = button.classList.contains('error');
  button.textContent = text;
  button.disabled = true;
  button.classList.toggle('error', Boolean(options.error));
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
    button.classList.toggle('error', hadError);
  }, 1200);
}

function setTransientStatus(text, error = false, timeout = 2200) {
  const status = el('#sendStatus');
  if (status) {
    status.textContent = text;
    status.classList.toggle('error', error);
    setTimeout(() => {
      if (status.textContent !== text) return;
      status.textContent = '';
      status.classList.remove('error');
    }, timeout);
  }
  showToast(text, { error, timeout });
}

function showToast(text, options = {}) {
  const toast = el('#appToast');
  if (!toast || !String(text || '').trim()) return;
  clearTimeout(appToastTimer);
  toast.textContent = text;
  toast.classList.toggle('error', Boolean(options.error));
  toast.classList.remove('hidden');
  appToastTimer = setTimeout(() => {
    if (toast.textContent !== text) return;
    toast.classList.add('hidden');
    toast.classList.remove('error');
  }, options.timeout || 2200);
}

function handleImagePreviewClick(event) {
  const button = event.target.closest?.('[data-preview-image]');
  if (!button) return false;
  openImagePreview(button.dataset.previewImage || '', button.dataset.previewName || '图片预览');
  return true;
}

function openImagePreview(src, name) {
  if (!src) return;
  const preview = el('#imagePreview');
  const image = el('#imagePreviewImg');
  const title = el('#imagePreviewTitle');
  if (!preview || !image || !title) return;
  image.src = src;
  image.alt = name || '图片预览';
  title.textContent = name || '图片预览';
  preview.classList.remove('hidden');
  el('#imagePreviewClose')?.focus();
}

function closeImagePreview() {
  const preview = el('#imagePreview');
  const image = el('#imagePreviewImg');
  if (!preview) return;
  preview.classList.add('hidden');
  if (image) image.removeAttribute('src');
}

function handleGlobalKeydown(event) {
  const withModifier = event.metaKey || event.ctrlKey;
  if (withModifier && event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === 'Escape' && state.commandPalette.open) {
    event.preventDefault();
    closeCommandPalette();
    return;
  }
  if (event.key === 'Escape' && !el('#imagePreview')?.classList.contains('hidden')) {
    event.preventDefault();
    closeImagePreview();
    return;
  }
  if (event.key === 'Escape' && state.selectionToolbar.open) {
    event.preventDefault();
    closeSelectionToolbar({ clearSelection: true });
    return;
  }
  if (event.key === 'Escape' && state.sending) {
    event.preventDefault();
    stopGeneration();
    return;
  }
  if (!isKeyboardShortcutAllowed(event)) return;
  if (withModifier && !event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusConversationSearch();
    return;
  }
  if (withModifier && event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    toggleSidebar();
  }
}

function isKeyboardShortcutAllowed(event) {
  const target = event.target;
  if (!target) return true;
  const tagName = target.tagName;
  return !target.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
}

function focusConversationSearch() {
  if (state.sidebarCollapsed) {
    state.sidebarCollapsed = false;
    localStorage.setItem('kc_sidebar_collapsed', '0');
    renderChatShell();
    renderMessages(state.currentMessages);
  }
  requestAnimationFrame(() => {
    const search = el('#conversationSearch');
    search?.focus();
    search?.select();
  });
}

function focusConversationFind() {
  if (state.sidebarCollapsed) {
    state.sidebarCollapsed = false;
    localStorage.setItem('kc_sidebar_collapsed', '0');
    renderChatShell();
    renderMessages(state.currentMessages);
  }
  requestAnimationFrame(() => {
    const input = el('#conversationFind');
    input?.focus();
    input?.select();
  });
}

function focusComposer() {
  requestAnimationFrame(() => {
    const input = el('#messageInput');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
}

function openPromptLibraryFromCommand() {
  state.promptLibraryOpen = true;
  renderPromptLibrary();
  requestAnimationFrame(() => el('#customPromptLabel')?.focus());
}

async function copyCurrentConversationLinkFromCommand() {
  const link = buildConversationLink(state.currentConversationId);
  if (!link) return;
  try {
    await copyText(link);
    showToast('会话链接已复制。');
  } catch {
    setTransientStatus('链接复制失败，请手动复制地址栏。', true);
  }
}

function startSending(statusText) {
  state.sending = true;
  state.abortController = new AbortController();
  updateTopbarActions();
  const sendButton = el('#sendBtn');
  const stopButton = el('#stopBtn');
  if (sendButton) sendButton.disabled = true;
  if (stopButton) {
    stopButton.disabled = false;
    stopButton.classList.remove('hidden');
  }
  const status = el('#sendStatus');
  if (status) status.textContent = statusText;
}

function finishSending() {
  state.sending = false;
  state.abortController = null;
  updateTopbarActions();
  const sendButton = el('#sendBtn');
  const stopButton = el('#stopBtn');
  if (sendButton) sendButton.disabled = false;
  if (stopButton) {
    stopButton.disabled = true;
    stopButton.classList.add('hidden');
  }
  const status = el('#sendStatus');
  if (status) status.textContent = '';
}

function stopGeneration() {
  if (!state.abortController || state.abortController.signal.aborted) return;
  state.abortController.abort();
  const stopButton = el('#stopBtn');
  if (stopButton) stopButton.disabled = true;
  const status = el('#sendStatus');
  if (status) status.textContent = '正在停止...';
}

async function branchFromMessage(messageId, button) {
  if (state.sending || !state.currentConversationId || !messageId || String(messageId).startsWith('local_')) return;
  if (button) {
    button.disabled = true;
    button.textContent = '分支中';
  }
  try {
    const data = await api('/conversations/branch', {
      method: 'POST',
      body: {
        conversationId: state.currentConversationId,
        messageId
      }
    });
    if (data.conversation) {
      state.conversations = sortConversations([
        data.conversation,
        ...state.conversations.filter((conversation) => conversation.id !== data.conversation.id)
      ]);
      renderConversationList();
      await selectConversation(data.conversation.id);
      setTransientStatus(`已创建分支：${data.conversation.title || '新会话'}`);
    }
  } catch (err) {
    setTransientStatus(`创建分支失败：${err.message}`, true);
    if (button) {
      button.disabled = false;
      button.textContent = '分支';
    }
  }
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const maxHeight = Number.parseInt(getComputedStyle(textarea).maxHeight, 10) || 240;
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(nextHeight, 86)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function isAbortError(err) {
  return err?.name === 'AbortError' || String(err?.message || '').includes('aborted');
}

function renderMessageActions(message, options = {}) {
  const messageId = message?.id || '';
  const id = escapeAttr(messageId);
  const exportDisabled = options.exportDisabled || !messageId;
  const linkDisabled = !messageId || String(messageId).startsWith('local_') || !state.currentConversationId;
  const quoteDisabled = !messageId || String(messageId).startsWith('local_');
  const editDisabled = !messageId || String(messageId).startsWith('local_') || message?.role !== 'user';
  const branchDisabled = options.branchDisabled || !messageId || String(messageId).startsWith('local_') || !['user', 'assistant'].includes(message?.role);
  const allowLocalRetry = Boolean(options.allowLocalRetry);
  const retryDisabled = options.retryDisabled || !messageId || (String(messageId).startsWith('local_') && !allowLocalRetry) || message?.role !== 'assistant';
  const continueDisabled = options.continueDisabled || !messageId || String(messageId).startsWith('local_') || message?.role !== 'assistant' || !isLatestAssistantMessage(messageId);
  const feedbackDisabled = !messageId || String(messageId).startsWith('local_') || message?.role !== 'assistant';
  const feedback = message?.feedback || '';
  const saved = isMessageSaved(message);
  const collapseButton = message?.role === 'assistant' && isCollapsibleMessage(message)
    ? `<button class="message-action" data-toggle-collapse-message="${id}" type="button" aria-expanded="true">收起</button>`
    : '';
  const editButton = message?.role === 'user'
    ? `<button class="message-action" data-edit-message="${id}" type="button" ${editDisabled ? 'disabled' : ''}>编辑</button>`
    : '';
  const branchButton = ['user', 'assistant'].includes(message?.role)
    ? `<button class="message-action" data-branch-message="${id}" type="button" ${branchDisabled ? 'disabled' : ''}>分支</button>`
    : '';
  const retryButton = message?.role === 'assistant'
    ? `<button class="message-action" data-retry-message="${id}" type="button" ${retryDisabled ? 'disabled' : ''}>重新生成</button>`
    : '';
  const continueButton = message?.role === 'assistant'
    ? `<button class="message-action" data-continue-message="${id}" type="button" ${continueDisabled ? 'disabled' : ''}>继续回答</button>`
    : '';
  const feedbackButtons = message?.role === 'assistant'
    ? `<button class="message-action feedback ${feedback === 'up' ? 'active' : ''}" data-feedback-message="${id}" data-feedback-value="up" type="button" aria-pressed="${feedback === 'up' ? 'true' : 'false'}" ${feedbackDisabled ? 'disabled' : ''}>有用</button>
       <button class="message-action feedback ${feedback === 'down' ? 'active' : ''}" data-feedback-message="${id}" data-feedback-value="down" type="button" aria-pressed="${feedback === 'down' ? 'true' : 'false'}" ${feedbackDisabled ? 'disabled' : ''}>需改</button>`
    : '';
  const secondaryButtons = `
    <button class="message-action" data-copy-message-link="${id}" type="button" ${linkDisabled ? 'disabled' : ''}>链接</button>
    ${branchButton}
    <button class="message-action" data-export-message="${id}" data-export-format="md" type="button" ${exportDisabled ? 'disabled' : ''}>MD</button>
    <button class="message-action" data-export-message="${id}" data-export-format="pdf" type="button" ${exportDisabled ? 'disabled' : ''}>PDF</button>
    <button class="message-action" data-export-message="${id}" data-export-format="json" type="button" ${exportDisabled ? 'disabled' : ''}>JSON</button>
    ${retryButton}
    ${continueButton}
    ${feedbackButtons}`;
  return `<div class="message-actions">
    <button class="message-action" data-copy-message="${id}" type="button">复制</button>
    <button class="message-action" data-quote-message="${id}" type="button" ${quoteDisabled ? 'disabled' : ''}>追问</button>
    <button class="message-action saved ${saved ? 'active' : ''}" data-save-message="${id}" type="button" aria-pressed="${saved ? 'true' : 'false'}" ${quoteDisabled ? 'disabled' : ''}>${saved ? '已收藏' : '收藏'}</button>
    ${collapseButton}
    ${editButton}
    <details class="message-more">
      <summary class="message-action message-more-summary">更多</summary>
      <div class="message-more-menu">${secondaryButtons}</div>
    </details>
  </div>`;
}

function isCollapsibleMessage(message) {
  if (!message || message.role !== 'assistant') return false;
  const text = String(message.content || '');
  if (text.length >= 1400) return true;
  const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  if (nonEmptyLines >= 28) return true;
  return text.split(/\n\s*\n/).filter((part) => part.trim()).length >= 18;
}

function renderMessageQuickActions(message, options = {}) {
  if (message?.role !== 'assistant') return '';
  const messageId = message?.id || '';
  const id = escapeAttr(messageId);
  const isLocal = String(messageId).startsWith('local_');
  const copyDisabled = !messageId;
  const allowLocalRetry = Boolean(options.allowLocalRetry);
  const retryDisabled = options.retryDisabled || !messageId || (isLocal && !allowLocalRetry);
  const continueDisabled = options.continueDisabled || !messageId || isLocal || !isLatestAssistantMessage(messageId);
  return `<div class="message-quick-actions" aria-label="助手回复操作">
    <button class="message-action compact" data-copy-message="${id}" type="button" ${copyDisabled ? 'disabled' : ''}>复制</button>
    <button class="message-action compact" data-retry-message="${id}" type="button" ${retryDisabled ? 'disabled' : ''}>重新生成</button>
    <button class="message-action compact" data-continue-message="${id}" type="button" ${continueDisabled ? 'disabled' : ''}>继续回答</button>
  </div>`;
}

function isLatestAssistantMessage(messageId) {
  const latest = [...(state.currentMessages || [])].reverse().find((message) => message.role === 'assistant');
  if (!latest) return true;
  return String(latest.id || '') === String(messageId || '');
}

function assistantMessageFromDone(data, content) {
  if (!data?.assistantMessageId) return null;
  return {
    id: data.assistantMessageId,
    role: 'assistant',
    content,
    attachments: [],
    created_at: data.assistantCreatedAt || '',
    model_name: data.assistantModelName || ''
  };
}

function promoteRenderedMessage(localId, message) {
  const realId = String(message?.id || '');
  if (!realId || String(realId).startsWith('local_')) return localId;
  const oldId = String(localId || realId);
  const article = document.querySelector(`[data-message-id="${cssEscape(oldId)}"]`) || document.querySelector(`[data-message-id="${cssEscape(realId)}"]`);
  const previousContent = messageContents.get(oldId) ?? messageContents.get(realId) ?? '';
  const content = message.content ?? previousContent;
  if (oldId !== realId) messageContents.delete(oldId);
  messageContents.set(realId, content);
  upsertCurrentMessage({ ...message, id: realId, content });

  if (!article) return realId;
  article.dataset.messageId = realId;
  updateRenderedMessageMeta(article, { ...message, id: realId, content });
  updateRenderedAnswerSectionNav(article, { ...message, id: realId, content });
  enhanceAnswerSections(article);
  updateRenderedFollowUpSuggestions(article, { ...message, id: realId, content });
  updateRenderedMessageActions(article, { ...message, id: realId, content });
  return realId;
}

function upsertCurrentMessage(message) {
  const id = String(message?.id || '');
  if (!id) return;
  const index = state.currentMessages.findIndex((item) => String(item.id || '') === id);
  if (index >= 0) {
    state.currentMessages[index] = { ...state.currentMessages[index], ...message };
    renderMessageOutline();
    return;
  }
  state.currentMessages.push({ ...message });
  renderMessageOutline();
}

function updateRenderedMessageMeta(article, message) {
  const nextHtml = renderMessageMeta(message);
  const current = article.querySelector('.message-meta');
  if (current) {
    if (nextHtml) current.outerHTML = nextHtml;
    else current.remove();
    return;
  }
  if (!nextHtml) return;
  const actions = article.querySelector('.message-actions');
  if (actions) actions.insertAdjacentHTML('beforebegin', nextHtml);
  else article.querySelector('.message-card')?.insertAdjacentHTML('beforeend', nextHtml);
}

function updateRenderedAnswerSectionNav(article, message) {
  const nextHtml = renderAnswerSectionNav(message);
  const current = article.querySelector('.answer-section-nav');
  if (current) {
    if (nextHtml) current.outerHTML = nextHtml;
    else current.remove();
    return;
  }
  if (!nextHtml) return;
  const content = article.querySelector('.message-content');
  if (content) content.insertAdjacentHTML('beforebegin', nextHtml);
  else article.querySelector('.message-card')?.insertAdjacentHTML('afterbegin', nextHtml);
}

function updateRenderedFollowUpSuggestions(article, message) {
  const nextHtml = renderFollowUpSuggestions(message);
  const current = article.querySelector('.follow-up-suggestions');
  if (current) {
    if (nextHtml) current.outerHTML = nextHtml;
    else current.remove();
    return;
  }
  if (!nextHtml) return;
  const actions = article.querySelector('.message-actions');
  if (actions) actions.insertAdjacentHTML('beforebegin', nextHtml);
  else article.querySelector('.message-card')?.insertAdjacentHTML('beforeend', nextHtml);
}

function updateRenderedMessageActions(article, message, options = {}) {
  const actions = article.querySelector('.message-actions');
  const html = renderMessageActions(message, options);
  if (actions) actions.outerHTML = html;
  else article.querySelector('.message-card')?.insertAdjacentHTML('beforeend', html);

  const quickActions = article.querySelector('.message-quick-actions');
  const quickHtml = renderMessageQuickActions(message, options);
  if (quickActions) {
    if (quickHtml) quickActions.outerHTML = quickHtml;
    else quickActions.remove();
  } else if (quickHtml) {
    insertMessageQuickActions(article, quickHtml);
  }
}

function insertMessageQuickActions(article, html) {
  const card = article?.querySelector('.message-card');
  if (!card) return;
  const think = card.querySelector('.think-line');
  if (think) {
    think.insertAdjacentHTML('afterend', html);
    return;
  }
  const first = card.querySelector('.answer-section-nav, .message-content');
  if (first) first.insertAdjacentHTML('beforebegin', html);
  else card.insertAdjacentHTML('afterbegin', html);
}

function enableAssistantActions(messageId, options = {}) {
  const content = options.message?.content ?? messageContents.get(messageId) ?? '';
  const finalId = options.message
    ? promoteRenderedMessage(messageId, { ...options.message, content })
    : messageId;
  const article = document.querySelector(`[data-message-id="${cssEscape(finalId)}"]`);
  if (!article) return;
  updateRenderedMessageActions(article, {
    id: finalId,
    role: 'assistant',
    content,
    attachments: [],
    created_at: options.message?.created_at || '',
    model_name: options.message?.model_name || ''
  }, {
    exportDisabled: !options.exportEnabled,
    allowLocalRetry: Boolean(options.allowLocalRetry)
  });
  return finalId;
}

async function exportConversation(format) {
  const messages = state.currentMessages || [];
  if (!messages.length) {
    el('#sendStatus').textContent = '当前会话还没有可导出的内容。';
    return;
  }
  const title = currentConversationTitle();
  if (format === 'md') {
    const markdown = buildConversationMarkdown(title, messages);
    downloadTextFile(`${safeFilename(title)}.md`, markdown, 'text/markdown;charset=utf-8');
    showToast('当前会话 MD 已导出。');
    return;
  }
  if (format === 'pdf') {
    if (await downloadConversationPdf(title, messages)) showToast('当前会话 PDF 已下载。');
    return;
  }
  if (format === 'json') {
    downloadJsonFile(`${safeFilename(title)}.json`, buildConversationJsonPayload(title, messages));
    showToast('当前会话 JSON 已导出。');
    return;
  }
  if (format === 'csv') {
    downloadCsvFile(`${safeFilename(title)}.csv`, buildConversationCsv(title, messages));
    showToast('当前会话 CSV 已导出。');
  }
}

async function exportConversationReview(format) {
  const messages = state.currentMessages || [];
  if (!messages.length) {
    el('#sendStatus').textContent = '当前会话还没有可复盘的内容。';
    return;
  }
  const title = `${currentConversationTitle()}-会话复盘`;
  const markdown = buildConversationReviewMarkdown(currentConversationTitle(), messages);
  if (format === 'pdf') {
    if (await downloadMarkdownPdf(title, markdown)) showToast('复盘 PDF 已下载。');
    return;
  }
  downloadTextFile(`${safeFilename(title)}.md`, markdown, 'text/markdown;charset=utf-8');
  showToast('复盘 MD 已导出。');
}

async function exportAllConversations(format) {
  const status = el('#sendStatus');
  if (status) status.textContent = '正在整理全部会话...';
  try {
    const data = await api('/export/conversations');
    const records = (data.conversations || []).filter((record) => Array.isArray(record.messages) && record.messages.length);
    if (!records.length) {
      if (status) status.textContent = '还没有可导出的答疑记录。';
      return;
    }
    const title = `${data.student?.studentNo || '学生'}-全部答疑记录`;
    if (format === 'md') {
      downloadTextFile(`${safeFilename(title)}.md`, buildAllConversationsMarkdown(title, records), 'text/markdown;charset=utf-8');
      showToast('全部会话 MD 已导出。');
    } else if (format === 'pdf') {
      if (await downloadAllConversationsPdf(title, records)) showToast('全部会话 PDF 已下载。');
    } else if (format === 'json') {
      downloadJsonFile(`${safeFilename(title)}.json`, buildConversationArchiveJsonPayload(title, records, 'all-conversations'));
      showToast('全部会话 JSON 已导出。');
    } else if (format === 'csv') {
      downloadCsvFile(`${safeFilename(title)}.csv`, buildAllConversationsCsv(records));
      showToast('全部会话 CSV 已导出。');
    }
  } catch (err) {
    if (status) {
      status.textContent = `全部导出失败：${err.message}`;
      status.classList.add('error');
    }
    showToast(`全部导出失败：${err.message}`, { error: true });
    return;
  }
  if (status) {
    status.textContent = '';
    status.classList.remove('error');
  }
}

async function exportSavedMessages(format) {
  const status = el('#sendStatus');
  if (status) status.textContent = '正在整理复习收藏...';
  try {
    const data = await api('/export/saved');
    const records = (data.conversations || []).filter((record) => Array.isArray(record.messages) && record.messages.length);
    if (!records.length) {
      if (status) status.textContent = '还没有收藏的消息。';
      return;
    }
    const title = `${data.student?.studentNo || '学生'}-复习收藏`;
    if (format === 'md') {
      downloadTextFile(`${safeFilename(title)}.md`, buildAllConversationsMarkdown(title, records), 'text/markdown;charset=utf-8');
      showToast('复习收藏 MD 已导出。');
    } else if (format === 'pdf') {
      if (await downloadAllConversationsPdf(title, records)) showToast('复习收藏 PDF 已下载。');
    } else if (format === 'json') {
      downloadJsonFile(`${safeFilename(title)}.json`, buildConversationArchiveJsonPayload(title, records, 'saved-messages'));
      showToast('复习收藏 JSON 已导出。');
    } else if (format === 'csv') {
      downloadCsvFile(`${safeFilename(title)}.csv`, buildAllConversationsCsv(records));
      showToast('复习收藏 CSV 已导出。');
    }
  } catch (err) {
    if (status) {
      status.textContent = `收藏导出失败：${err.message}`;
      status.classList.add('error');
    }
    showToast(`收藏导出失败：${err.message}`, { error: true });
    return;
  }
  if (status) {
    status.textContent = '';
    status.classList.remove('error');
  }
}

function exportStudyMemory(format) {
  const studentNo = state.student?.studentNo || '学生';
  const title = `${studentNo}-学习记忆`;
  if (format === 'json') {
    downloadJsonFile(`${safeFilename(title)}.json`, buildStudyMemoryJsonPayload());
    showToast('学习记忆 JSON 已导出。');
    return;
  }
  downloadTextFile(`${safeFilename(title)}.md`, buildStudyMemoryMarkdown(), 'text/markdown;charset=utf-8');
  showToast('学习记忆 MD 已导出。');
}

function buildStudyMemoryJsonPayload() {
  return {
    format: 'kaoyan-chat.study-memory.v1',
    exportedAt: new Date().toISOString(),
    student: {
      studentNo: state.student?.studentNo || '',
      displayName: state.student?.displayName || ''
    },
    memory: normalizedStudyMemory()
  };
}

function buildStudyMemoryMarkdown() {
  const memory = normalizedStudyMemory();
  const lines = [
    `# ${state.student?.studentNo || '学生'} 学习记忆`,
    '',
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `更新时间：${memory.lastUpdatedAt ? formatTime(memory.lastUpdatedAt) : '尚未更新'}`,
    '',
    '## 画像'
  ];
  const profileEntries = Object.entries(memory.profile || {}).filter(([, value]) => String(value || '').trim());
  if (profileEntries.length) {
    for (const [key, value] of profileEntries) lines.push(`- ${studyMemoryProfileLabel(key)}：${value}`);
  } else {
    lines.push('- 暂无画像信息');
  }
  lines.push('', '## 高频主题');
  const topics = studyMemoryTopicEntries(memory);
  if (topics.length) {
    for (const [topic, count] of topics) lines.push(`- ${topic}：${Number(count) || 0}`);
  } else {
    lines.push('- 暂无主题记录');
  }
  lines.push('', '## 最近问题');
  const recentQuestions = Array.isArray(memory.recentQuestions) ? memory.recentQuestions.slice(-20) : [];
  if (recentQuestions.length) {
    recentQuestions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
  } else {
    lines.push('暂无最近问题。');
  }
  return `${lines.join('\n')}\n`;
}

function normalizedStudyMemory() {
  const memory = state.student?.memory || {};
  return {
    profile: memory.profile && typeof memory.profile === 'object' ? memory.profile : {},
    topics: memory.topics && typeof memory.topics === 'object' ? memory.topics : {},
    recentQuestions: Array.isArray(memory.recentQuestions) ? memory.recentQuestions : [],
    lastUpdatedAt: memory.lastUpdatedAt || null
  };
}

function studyMemoryTopicEntries(memory = normalizedStudyMemory()) {
  return Object.entries(memory.topics || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 10);
}

function studyMemoryProfileLabel(key) {
  return ({
    target: '目标',
    level: '阶段',
    weakness: '薄弱点',
    preference: '偏好'
  })[key] || key;
}

async function handleImportJson(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 32 * 1024 * 1024) {
    setTransientStatus('导入失败：JSON 文件不能超过 32MB。', true, 4200);
    return;
  }
  try {
    setTransientStatus('正在导入 JSON...', false, 1600);
    const archive = JSON.parse(await file.text());
    const data = await api('/import/conversations', {
      method: 'POST',
      body: { archive }
    });
    await loadConversations();
    const first = data.conversations?.[0];
    if (first?.id) await selectConversation(first.id, { replaceRoute: true });
    showToast(`已导入 ${data.importedCount || data.conversations?.length || 0} 个会话，${data.messageCount || 0} 条消息。`, { timeout: 3600 });
  } catch (err) {
    setTransientStatus(`导入失败：${err.message}`, true, 5200);
  }
}

async function exportSingleMessage(message, format) {
  const roleName = message.role === 'user' ? '学生' : '助手';
  const title = `${currentConversationTitle()} - ${roleName}回复`;
  if (format === 'pdf') {
    if (await downloadConversationPdf(title, [message])) showToast('单条消息 PDF 已下载。');
    return;
  }
  if (format === 'json') {
    downloadJsonFile(`${safeFilename(title)}.json`, buildConversationJsonPayload(title, [message]));
    showToast('单条消息 JSON 已导出。');
    return;
  }
  const markdown = buildConversationMarkdown(title, [message]);
  downloadTextFile(`${safeFilename(title)}.md`, markdown, 'text/markdown;charset=utf-8');
  showToast('单条消息 MD 已导出。');
}

function buildConversationJsonPayload(title, messages) {
  const conversation = state.conversations.find((item) => item.id === state.currentConversationId) || {};
  return {
    app: 'kaoyan-chat',
    format: 'kaoyan-chat.conversation.v1',
    exportedAt: new Date().toISOString(),
    student: exportStudentInfo(),
    conversation: {
      id: conversation.id || state.currentConversationId || '',
      title,
      model_id: conversation.model_id || state.currentProviderId || null,
      pinned: Number(conversation.pinned || 0),
      archived: Number(conversation.archived || 0),
      updated_at: conversation.updated_at || '',
      created_at: conversation.created_at || ''
    },
    messages: sanitizeExportMessages(messages)
  };
}

function buildConversationCsv(title, messages) {
  const conversation = state.conversations.find((item) => item.id === state.currentConversationId) || {};
  return buildMessageCsvRows([{ conversation: { ...conversation, title }, messages }]);
}

function buildAllConversationsCsv(records) {
  return buildMessageCsvRows(records || []);
}

function buildMessageCsvRows(records) {
  const rows = [[
    'conversation_title',
    'conversation_id',
    'role',
    'content',
    'attachments',
    'model',
    'feedback',
    'saved',
    'created_at'
  ]];
  for (const record of records || []) {
    const conversation = record.conversation || {};
    for (const message of record.messages || []) {
      rows.push([
        conversation.title || '',
        conversation.id || '',
        message.role || '',
        message.content || '',
        (message.attachments || []).map((attachment) => attachment.name || 'image').join('; '),
        publicMessageModelName(message),
        message.feedback || '',
        isMessageSaved(message) ? '1' : '0',
        message.created_at || ''
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `"${text.replace(/"/g, '""')}"`;
}

function buildConversationArchiveJsonPayload(title, records, source) {
  return {
    app: 'kaoyan-chat',
    format: 'kaoyan-chat.archive.v1',
    source,
    title,
    exportedAt: new Date().toISOString(),
    student: exportStudentInfo(),
    conversations: (records || []).map((record) => ({
      conversation: {
        id: record.conversation?.id || '',
        title: record.conversation?.title || '答疑会话',
        model_id: record.conversation?.model_id || null,
        pinned: Number(record.conversation?.pinned || 0),
        archived: Number(record.conversation?.archived || 0),
        updated_at: record.conversation?.updated_at || '',
        created_at: record.conversation?.created_at || ''
      },
      messages: sanitizeExportMessages(record.messages || [])
    }))
  };
}

function sanitizeExportMessages(messages) {
  return (messages || []).map((message) => ({
    id: message.id || '',
    role: message.role || '',
    content: message.content || '',
    attachments: (message.attachments || []).map((attachment) => ({
      name: attachment.name || '附件',
      dataUrl: attachment.dataUrl || ''
    })).filter((attachment) => attachment.dataUrl),
    model_name: message.model_name || '',
    feedback: message.feedback || '',
    saved: Number(message.saved || 0),
    created_at: message.created_at || ''
  }));
}

function exportStudentInfo() {
  return {
    studentNo: state.student?.studentNo || '',
    displayName: state.student?.displayName || state.student?.studentNo || ''
  };
}

function messageForExport(messageId, article) {
  const saved = state.currentMessages.find((message) => String(message.id || '') === String(messageId || ''));
  const content = messageContents.get(messageId) ?? saved?.content ?? article?.querySelector('.message-content')?.innerText ?? '';
  return {
    ...(saved || {}),
    id: messageId,
    role: saved?.role || (article?.classList.contains('user') ? 'user' : 'assistant'),
    content,
    attachments: saved?.attachments || []
  };
}

function buildConversationMarkdown(title, messages) {
  const lines = [
    `# ${title}`,
    '',
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    ''
  ];
  for (const message of messages) {
    lines.push(`## ${message.role === 'user' ? '学生' : '助手'}`);
    lines.push('');
    const meta = messageMetaMarkdownLines(message);
    if (meta.length) {
      lines.push(...meta);
      lines.push('');
    }
    lines.push(message.content || '');
    const attachments = message.attachments || [];
    for (const attachment of attachments) {
      if (attachment.dataUrl) {
        lines.push('');
        lines.push(`![${attachment.name || '附件'}](${attachment.dataUrl})`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}

function buildAllConversationsMarkdown(title, records) {
  const lines = [
    `# ${title}`,
    '',
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    ''
  ];
  for (const record of records) {
    const conversation = record.conversation || {};
    lines.push(`## ${conversation.title || '答疑会话'}`);
    const meta = conversationMetaMarkdownLines(conversation);
    if (meta.length) {
      lines.push('');
      lines.push(...meta);
    }
    lines.push('');
    lines.push(...buildConversationMarkdown(conversation.title || '答疑会话', record.messages || []).split('\n').slice(4));
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}

function buildConversationReviewMarkdown(title, messages) {
  const stats = conversationReviewStats(messages);
  const topics = inferReviewTopics(messages.map((message) => message.content || '').join('\n'));
  const formulas = extractReviewFormulas(messages);
  const userQuestions = messages.filter((message) => message.role === 'user').slice(-8);
  const reviewTargets = messages
    .filter((message) => isMessageSaved(message) || message.feedback === 'down')
    .slice(-8);
  const lines = [
    `# ${title} 会话复盘`,
    '',
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 复盘摘要',
    '',
    `- 消息数：${stats.total} 条（学生 ${stats.userCount} 条，助手 ${stats.assistantCount} 条）`,
    `- 附件：${stats.attachmentCount} 个`,
    `- 收藏：${stats.savedCount} 条`,
    `- 反馈：有用 ${stats.feedbackUp} 条，需改 ${stats.feedbackDown} 条`,
    `- 模型：${stats.models.length ? stats.models.join('；') : '暂无记录'}`,
    '',
    '## 高频主题',
    '',
    topics.length ? topics.map((topic) => `- ${topic}`).join('\n') : '- 暂未识别到明确主题',
    '',
    '## 重点问题',
    ''
  ];
  if (userQuestions.length) {
    userQuestions.forEach((message, index) => {
      lines.push(`${index + 1}. ${cleanExcerpt(message.content || (message.attachments?.length ? '图片题目' : ''), 140)}`);
    });
  } else {
    lines.push('暂无学生问题。');
  }
  lines.push('', '## 公式清单', '');
  if (formulas.length) {
    formulas.forEach((formula, index) => lines.push(`${index + 1}. ${formula}`));
  } else {
    lines.push('暂无可提取公式。');
  }
  lines.push('', '## 需回看', '');
  if (reviewTargets.length) {
    reviewTargets.forEach((message, index) => {
      const tags = [
        isMessageSaved(message) ? '已收藏' : '',
        message.feedback === 'down' ? '需改' : '',
        message.feedback === 'up' ? '有用' : ''
      ].filter(Boolean).join('，');
      lines.push(`${index + 1}. ${tags || '标记'}：${cleanExcerpt(message.content || '', 150)}`);
    });
  } else {
    lines.push('暂无收藏或需改标记。');
  }
  lines.push('', '## 复习建议', '');
  for (const suggestion of buildReviewSuggestions({ stats, topics, formulas })) {
    lines.push(`- ${suggestion}`);
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}

function conversationReviewStats(messages) {
  const models = new Set();
  let attachmentCount = 0;
  let savedCount = 0;
  let feedbackUp = 0;
  let feedbackDown = 0;
  for (const message of messages || []) {
    attachmentCount += (message.attachments || []).length;
    if (isMessageSaved(message)) savedCount += 1;
    if (message.feedback === 'up') feedbackUp += 1;
    if (message.feedback === 'down') feedbackDown += 1;
    const model = publicMessageModelName(message);
    if (model) models.add(model);
  }
  return {
    total: messages.length,
    userCount: messages.filter((message) => message.role === 'user').length,
    assistantCount: messages.filter((message) => message.role === 'assistant').length,
    attachmentCount,
    savedCount,
    feedbackUp,
    feedbackDown,
    models: [...models].slice(0, 5)
  };
}

function inferReviewTopics(text) {
  const rules = [
    ['概率统计', /概率|统计|分布|样本|估计|检验|泊松|正态|随机变量/],
    ['高等数学', /极限|导数|微分|积分|级数|偏导|泰勒|无穷小/],
    ['线性代数', /矩阵|行列式|特征值|特征向量|相似|秩|二次型/],
    ['英语', /英语|阅读|翻译|作文|长难句|单词/],
    ['政治', /政治|马原|毛中特|史纲|思修|时政/]
  ];
  return rules.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function extractReviewFormulas(messages) {
  const formulas = [];
  const seen = new Set();
  const pattern = /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$)/g;
  for (const message of messages || []) {
    const source = normalizeMathDelimiters(message.content || '');
    for (const match of source.matchAll(pattern)) {
      const formula = match[0].trim();
      if (!formula || seen.has(formula)) continue;
      seen.add(formula);
      formulas.push(formula);
      if (formulas.length >= 12) return formulas;
    }
  }
  return formulas;
}

function buildReviewSuggestions({ stats, topics, formulas }) {
  const suggestions = [];
  if (topics.length) suggestions.push(`按「${topics.join('、')}」归档到错题本，后续优先刷同类题。`);
  if (formulas.length) suggestions.push('把公式清单单独整理一页，复习时先默写再看答案。');
  if (stats.savedCount) suggestions.push('先回看已收藏消息，把可复用的步骤整理成模板。');
  if (stats.feedbackDown) suggestions.push('优先重做标记为“需改”的回答，确认每一步推导都能独立复现。');
  if (stats.attachmentCount) suggestions.push('保留题图与文字题干对应关系，避免复盘时只看答案漏掉条件。');
  if (!suggestions.length) suggestions.push('本轮记录较少，可以先补充题目条件、自己的卡点和最终答案，再导出复盘。');
  return suggestions;
}

function conversationMetaMarkdownLines(conversation) {
  const parts = [];
  if (conversation?.updated_at) parts.push(`更新时间：${formatTime(conversation.updated_at)}`);
  if (conversation?.created_at) parts.push(`创建时间：${formatTime(conversation.created_at)}`);
  return parts.map((part) => `> ${part}`);
}

function messageMetaParts(message) {
  const parts = [];
  if (isMessageSaved(message)) parts.push('已收藏');
  if (message?.created_at) parts.push(`时间：${formatTime(message.created_at)}`);
  const modelName = publicMessageModelName(message);
  if (modelName) parts.push(`模型：${modelName}`);
  return parts;
}

function messageMetaMarkdownLines(message) {
  return messageMetaParts(message).map((part) => `> ${part}`);
}

function renderExportMessageMeta(message) {
  const parts = messageMetaParts(message);
  return parts.length ? `<div class="export-message-meta">${parts.map(escapeHtml).join(' · ')}</div>` : '';
}

function publicMessageModelName(message) {
  if (message?.role !== 'assistant') return '';
  const raw = String(message.model_name || '').trim();
  if (!raw) return '';
  return raw
    .replace(/中转|relay|provider|openai-compatible|anthropic|claude messages/gi, '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 100);
}

async function downloadConversationPdf(title, messages) {
  return downloadPdfFile(`${safeFilename(title)}.pdf`, {
    title,
    markdown: buildConversationMarkdown(title, messages),
    html: buildConversationPdfHtml(title, messages)
  });
}

async function downloadAllConversationsPdf(title, records) {
  return downloadPdfFile(`${safeFilename(title)}.pdf`, {
    title,
    markdown: buildAllConversationsMarkdown(title, records),
    html: buildAllConversationsPdfHtml(title, records)
  });
}

async function downloadMarkdownPdf(title, markdown) {
  return downloadPdfFile(`${safeFilename(title)}.pdf`, {
    title,
    markdown,
    html: buildMarkdownPdfHtml(title, markdown)
  });
}

function buildConversationPdfHtml(title, messages) {
  const bodyHtml = (messages || []).map((message) => {
    const attachments = message.attachments || [];
    const images = attachments
      .filter((attachment) => attachment.dataUrl)
      .map((attachment) => `<img class="export-image" src="${escapeAttr(attachment.dataUrl)}" alt="${escapeAttr(attachment.name || '附件')}" />`)
      .join('');
    return `
      <article class="export-message ${message.role}">
        <h2>${message.role === 'user' ? '学生' : '助手'}</h2>
        ${renderExportMessageMeta(message)}
        <div class="export-content">${renderMarkdown(message.content || '')}</div>
        ${images ? `<div class="export-images">${images}</div>` : ''}
      </article>`;
  }).join('');
  return exportHtmlDocument({
    title,
    body: `
      <h1>${escapeHtml(title)}</h1>
      <div class="export-meta">导出时间：${escapeHtml(new Date().toLocaleString('zh-CN', { hour12: false }))}</div>
      ${bodyHtml}`,
    style: conversationPdfStyle()
  });
}

function buildAllConversationsPdfHtml(title, records) {
  const bodyHtml = (records || []).map((record) => {
    const conversation = record.conversation || {};
    const messages = record.messages || [];
    return `
      <section class="export-conversation">
        <h2>${escapeHtml(conversation.title || '答疑会话')}</h2>
        <div class="export-message-meta">${conversationMetaMarkdownLines(conversation).map((line) => escapeHtml(line.replace(/^>\s*/, ''))).join(' · ')}</div>
        ${messages.map((message) => {
          const attachments = message.attachments || [];
          const images = attachments
            .filter((attachment) => attachment.dataUrl)
            .map((attachment) => `<img class="export-image" src="${escapeAttr(attachment.dataUrl)}" alt="${escapeAttr(attachment.name || '附件')}" />`)
            .join('');
          return `
            <article class="export-message ${message.role}">
              <h3>${message.role === 'user' ? '学生' : '助手'}</h3>
              ${renderExportMessageMeta(message)}
              <div class="export-content">${renderMarkdown(message.content || '')}</div>
              ${images ? `<div class="export-images">${images}</div>` : ''}
            </article>`;
        }).join('')}
      </section>`;
  }).join('');
  return exportHtmlDocument({
    title,
    body: `
      <h1>${escapeHtml(title)}</h1>
      <div class="export-meta">导出时间：${escapeHtml(new Date().toLocaleString('zh-CN', { hour12: false }))}</div>
      ${bodyHtml}`,
    style: conversationPdfStyle()
  });
}

function buildMarkdownPdfHtml(title, markdown) {
  return exportHtmlDocument({
    title,
    body: `<main class="export-content">${renderMarkdown(markdown)}</main>`,
    style: `
      body { margin: 0; color: #18202a; font: 15px/1.72 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
      .export-content { max-width: 860px; margin: 0 auto; }
      .export-content h1 { margin: 0 0 10px; font-size: 24px; }
      .export-content h2 { margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #d8dee6; font-size: 18px; }
      .export-content p { margin: 0 0 .85em; }
      .export-content ul, .export-content ol { padding-left: 22px; }
      .export-content li { margin: 0 0 6px; }
      .export-content pre { overflow: auto; padding: 12px; border-radius: 8px; background: #101820; color: #eef5ff; }
      mjx-container { overflow-x: auto; overflow-y: hidden; max-width: 100%; }
      @page { margin: 16mm 14mm; }
      @media print { .export-content h2 { break-after: avoid; } }
    `
  });
}

function conversationPdfStyle() {
  return `
    body { margin: 0; color: #18202a; font: 15px/1.72 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .export-meta { color: #647084; margin-bottom: 24px; }
    .export-conversation { break-before: auto; margin: 0 0 30px; }
    .export-conversation > h2 { margin: 0 0 6px; font-size: 18px; color: #18202a; }
    .export-message { break-inside: avoid; margin: 0 0 20px; padding-bottom: 16px; border-bottom: 1px solid #d8dee6; }
    .export-message h2, .export-message h3 { margin: 0 0 10px; font-size: 15px; color: #315a9d; }
    .export-message-meta { margin: -4px 0 10px; color: #647084; font-size: 12px; }
    .export-content p { margin: 0 0 .85em; }
    .export-content table { max-width: 100%; border-collapse: collapse; }
    .export-content th, .export-content td { border: 1px solid #d8dee6; padding: 6px 8px; }
    .export-content pre { overflow: auto; padding: 12px; border-radius: 8px; background: #101820; color: #eef5ff; }
    .export-images { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
    .export-image { max-width: 360px; max-height: 260px; border: 1px solid #d8dee6; object-fit: contain; }
    mjx-container { overflow-x: auto; overflow-y: hidden; max-width: 100%; }
    @page { margin: 16mm 14mm; }
    @media print { .export-conversation, .export-message { break-inside: avoid; } }
  `;
}

function exportHtmlDocument({ title, body, style }) {
  const assetBase = `${location.origin}${BASE}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} - 导出</title>
  <script>
    window.MathJax = {
      tex: {
        inlineMath: [['\\\\(', '\\\\)'], ['$', '$']],
        displayMath: [['\\\\[', '\\\\]'], ['$$', '$$']],
        processEscapes: true,
        processEnvironments: true
      },
      svg: { fontCache: 'global' },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }
    };
  <\/script>
  <script defer src="${assetBase}/vendor/mathjax/tex-svg.js"><\/script>
  <style>${style}</style>
</head>
<body>${body}</body>
</html>`;
}

function downloadTextFile(filename, text, type) {
  downloadBlobFile(filename, new Blob([text], { type }));
}

async function downloadPdfFile(filename, payload) {
  const status = el('#sendStatus');
  if (status) {
    status.textContent = '正在生成 TeX PDF...';
    status.classList.remove('error');
  }
  try {
    const response = await fetch(`${API}/export/pdf`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, ...payload })
    });
    if (!response.ok) throw new Error(await errorText(response));
    const blob = await response.blob();
    downloadBlobFile(filename, blob);
    if (status) status.textContent = '';
    return true;
  } catch (err) {
    if (status) {
      status.textContent = `PDF 导出失败：${err.message}`;
      status.classList.add('error');
    }
    showToast(`PDF 导出失败：${err.message}`, { error: true });
    return false;
  }
}

function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCsvFile(filename, text) {
  downloadTextFile(filename, `\uFEFF${text}`, 'text/csv;charset=utf-8');
}

function downloadJsonFile(filename, value) {
  downloadTextFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'application/json;charset=utf-8');
}

function currentConversationTitle() {
  const match = state.conversations.find((item) => item.id === state.currentConversationId);
  return cleanFilenamePart(state.currentConversationTitle || match?.title || '答疑会话');
}

function currentConversationDisplayTitle() {
  const match = state.conversations.find((item) => item.id === state.currentConversationId);
  return cleanFilenamePart(state.currentConversationTitle || match?.title || (state.showArchived ? '归档会话' : '新的答疑'));
}

function safeFilename(value) {
  const base = cleanFilenamePart(value || '答疑会话')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || '答疑会话').slice(0, 80);
}

function cleanFilenamePart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanExcerpt(value, maxLength = 160) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/\\\[[\s\S]*?\\\]/g, '[公式]')
    .replace(/\\\([\s\S]*?\\\)/g, '[公式]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function appendImageFiles(files, defaultName = '') {
  const allowed = files.slice(0, Math.max(0, 4 - state.attachments.length));
  for (const file of allowed) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) continue;
    if (file.size > 4 * 1024 * 1024) {
      el('#sendStatus').textContent = '单张图片不能超过 4MB。';
      continue;
    }
    const suffix = file.type.split('/')[1].replace('jpeg', 'jpg');
    const name = file.name || `${defaultName || '图片'}-${state.attachments.length + 1}.${suffix}`;
    state.attachments.push({ name, dataUrl: await fileToDataUrl(file) });
    if (state.attachments.length >= 4) break;
  }
  saveCurrentAttachments();
  renderAttachments();
}

function renderAttachments() {
  const row = el('#attachmentRow');
  if (!row) return;
  row.classList.toggle('visible', state.attachments.length > 0);
  row.innerHTML = state.attachments.map((item, index) => `
    <div class="attachment-item">
      ${renderImageThumb(item, 'attachment-thumb')}
      <span title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</span>
      <button class="icon-btn" data-remove-attachment="${index}" type="button" aria-label="移除附件">×</button>
    </div>`).join('');
  row.querySelectorAll('[data-remove-attachment]').forEach((button) => {
    button.addEventListener('click', () => {
      state.attachments.splice(Number(button.dataset.removeAttachment), 1);
      saveCurrentAttachments();
      renderAttachments();
    });
  });
}

function renderImageThumb(item, className = 'image-thumb') {
  const name = item.name || '附件';
  return `<button class="${className}" data-preview-image="${escapeAttr(item.dataUrl)}" data-preview-name="${escapeAttr(name)}" type="button" aria-label="预览 ${escapeAttr(name)}">
    <img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(name)}" />
  </button>`;
}

function initAdmin() {
  renderAdminShell(false);
  checkAdmin();
}

async function checkAdmin() {
  try {
    await api('/admin/me');
    renderAdminShell(true);
    await loadAdmin();
  } catch {
    renderAdminLogin();
  }
}

function renderAdminLogin() {
  el('#app').innerHTML = `
    <main class="admin-login">
      <form class="login-card" id="adminLoginForm">
        <h1>管理员后台</h1>
        <p>登录后可以配置 OpenAI 中转、Opus/Claude 中转和 Gemini 中转。</p>
        <div class="form-field">
          <label for="adminPassword">后台密码</label>
          <input class="input" id="adminPassword" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn primary" type="submit">登录后台</button>
        <a class="btn ghost" href="${BASE}/">返回答疑</a>
        <div class="status" id="adminLoginStatus"></div>
      </form>
    </main>`;
  el('#adminLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = el('#adminLoginStatus');
    status.textContent = '正在登录...';
    status.className = 'status';
    try {
      await api('/admin/login', { method: 'POST', body: { password: el('#adminPassword').value } });
      renderAdminShell(true);
      await loadAdmin();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status error';
    }
  });
}

function renderAdminShell() {
  el('#app').innerHTML = `
    <div class="admin-shell">
      <aside class="admin-nav">
        <h1>考研答疑后台</h1>
        <p class="status">配置模型、查看学生和旧知识库导入情况。</p>
        <div class="sidebar-footer">
          <a class="btn ghost" href="${BASE}/">学生端</a>
          <button class="btn ghost" id="adminLogoutBtn" type="button">退出</button>
        </div>
      </aside>
      <main class="admin-content">
        <div id="adminStatus" class="status"></div>
        <section class="admin-grid" id="adminStats"></section>
        <section class="panel">
          <h2>回复反馈</h2>
          <div id="feedbackList"></div>
        </section>
        <section class="panel">
          <h2>Provider 配置</h2>
          <div id="providerList"></div>
        </section>
        <section class="panel">
          <h2 id="providerFormTitle">新增 Provider</h2>
          <form class="provider-form" id="providerForm">
            <input type="hidden" id="providerId" />
            <div class="form-field">
              <label>名称</label>
              <input class="input" id="providerName" placeholder="OpenAI 中转" required />
            </div>
            <div class="form-field">
              <label>类型</label>
              <select class="select" id="providerType">
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="anthropic">Anthropic / Claude Messages</option>
              </select>
            </div>
            <div class="form-field wide">
              <label>Base URL</label>
              <input class="input" id="providerBaseUrl" placeholder="https://example.com/v1" required />
            </div>
            <div class="form-field wide">
              <label>API Key</label>
              <input class="input" id="providerApiKey" placeholder="留空表示不改原 key" />
            </div>
            <div class="form-field">
              <label>模型名</label>
              <input class="input" id="providerModel" placeholder="gpt-4.1 / claude-opus-4-1 / gemini-3.5-flash" required />
            </div>
            <div class="form-field">
              <label>温度</label>
              <input class="input" id="providerTemperature" type="number" min="0" max="2" step="0.1" value="0.3" />
            </div>
            <div class="form-field">
              <label>最大输出 token</label>
              <input class="input" id="providerMaxTokens" type="number" min="256" max="64000" step="256" value="4096" />
            </div>
            <div class="form-field">
              <label>状态</label>
              <div class="checkbox-row">
                <label><input id="providerEnabled" type="checkbox" /> 启用</label>
                <label><input id="providerDefault" type="checkbox" /> 默认</label>
              </div>
            </div>
            <div class="wide">
              <button class="btn primary" type="submit">保存</button>
              <button class="btn" id="resetProviderForm" type="button">清空</button>
            </div>
          </form>
        </section>
        <section class="panel">
          <h2>学生概览</h2>
          <div id="studentList"></div>
        </section>
        <section class="panel">
          <h2>已注入提示词预览</h2>
          <div class="prompt-preview" id="promptPreview"></div>
          <button class="btn" id="reindexBtn" type="button">重新导入 /root/kaoyan</button>
        </section>
      </main>
    </div>`;
  el('#adminLogoutBtn')?.addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST', body: {} });
    renderAdminLogin();
  });
  el('#providerForm')?.addEventListener('submit', saveProvider);
  el('#resetProviderForm')?.addEventListener('click', resetProviderForm);
  el('#reindexBtn')?.addEventListener('click', reindexKnowledge);
}

async function loadAdmin() {
  const [stats, providers, students, feedback] = await Promise.all([
    api('/admin/stats'),
    api('/admin/providers'),
    api('/admin/students'),
    api('/admin/feedback')
  ]);
  renderStats(stats.stats);
  renderProviders(providers.providers || []);
  renderStudents(students.students || []);
  renderFeedback(feedback.feedback || []);
}

function renderStats(stats) {
  el('#adminStats').innerHTML = [
    ['学生', stats.students],
    ['会话', stats.conversations],
    ['消息', stats.messages],
    ['有用', stats.feedbackUp],
    ['需改', stats.feedbackDown],
    ['知识片段', stats.knowledgeChunks]
  ].map(([label, value]) => `
    <div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`).join('');
  el('#promptPreview').textContent = stats.promptPreview || '';
}

function renderFeedback(items) {
  if (!items.length) {
    el('#feedbackList').innerHTML = `<div class="status">还没有学生反馈。</div>`;
    return;
  }
  el('#feedbackList').innerHTML = `
    <table class="provider-table feedback-table">
      <thead><tr><th>反馈</th><th>学号 / 会话</th><th>回复摘录</th><th>时间</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td><span class="feedback-badge ${item.feedback === 'down' ? 'down' : 'up'}">${item.feedback === 'down' ? '需改' : '有用'}</span></td>
            <td>${escapeHtml(item.student_no)}<br><span class="status">${escapeHtml(item.conversation_title || item.conversation_id || '')}</span></td>
            <td class="feedback-excerpt">${escapeHtml(cleanExcerpt(item.content, 180))}</td>
            <td>${formatTime(item.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderProviders(providers) {
  if (!providers.length) {
    el('#providerList').innerHTML = `<div class="status">暂无 provider。</div>`;
    return;
  }
  el('#providerList').innerHTML = `
    <table class="provider-table">
      <thead><tr><th>名称</th><th>类型</th><th>模型</th><th>状态</th><th>Key</th><th>操作</th></tr></thead>
      <tbody>
        ${providers.map((p) => `
          <tr>
            <td>${escapeHtml(p.name)}${p.is_default ? ' · 默认' : ''}<br><span class="status">${escapeHtml(p.base_url)}</span></td>
            <td>${escapeHtml(p.type)}</td>
            <td>${escapeHtml(p.model)}</td>
            <td>${p.enabled ? '启用' : '禁用'}</td>
            <td>${escapeHtml(p.api_key_masked || '未设置')}</td>
            <td>
              <button class="btn" data-edit-provider="${p.id}" type="button">编辑</button>
              <button class="btn" data-test-provider="${p.id}" type="button">测试</button>
              <button class="btn danger" data-delete-provider="${p.id}" type="button">删除</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el('#providerList').querySelectorAll('[data-edit-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      const provider = providers.find((p) => p.id === Number(button.dataset.editProvider));
      fillProviderForm(provider);
    });
  });
  el('#providerList').querySelectorAll('[data-test-provider]').forEach((button) => {
    button.addEventListener('click', () => testProvider(Number(button.dataset.testProvider)));
  });
  el('#providerList').querySelectorAll('[data-delete-provider]').forEach((button) => {
    button.addEventListener('click', () => deleteProvider(Number(button.dataset.deleteProvider)));
  });
}

function renderStudents(students) {
  if (!students.length) {
    el('#studentList').innerHTML = `<div class="status">还没有学生登录。</div>`;
    return;
  }
  el('#studentList').innerHTML = `
    <table class="student-table">
      <thead><tr><th>学号</th><th>会话</th><th>消息</th><th>最近活跃</th></tr></thead>
      <tbody>${students.map((s) => `
        <tr>
          <td>${escapeHtml(s.student_no)}</td>
          <td>${s.conversations}</td>
          <td>${s.messages}</td>
          <td>${formatTime(s.last_seen_at)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function fillProviderForm(provider) {
  el('#providerFormTitle').textContent = `编辑 Provider #${provider.id}`;
  el('#providerId').value = provider.id;
  el('#providerName').value = provider.name;
  el('#providerType').value = provider.type;
  el('#providerBaseUrl').value = provider.base_url;
  el('#providerApiKey').value = '';
  el('#providerModel').value = provider.model;
  el('#providerTemperature').value = provider.temperature;
  el('#providerMaxTokens').value = provider.max_tokens;
  el('#providerEnabled').checked = Boolean(provider.enabled);
  el('#providerDefault').checked = Boolean(provider.is_default);
}

function resetProviderForm() {
  el('#providerFormTitle').textContent = '新增 Provider';
  el('#providerForm').reset();
  el('#providerId').value = '';
  el('#providerTemperature').value = '0.3';
  el('#providerMaxTokens').value = '4096';
}

async function saveProvider(event) {
  event.preventDefault();
  const id = el('#providerId').value;
  const body = {
    name: el('#providerName').value,
    type: el('#providerType').value,
    base_url: el('#providerBaseUrl').value,
    api_key: el('#providerApiKey').value,
    model: el('#providerModel').value,
    temperature: Number(el('#providerTemperature').value),
    max_tokens: Number(el('#providerMaxTokens').value),
    enabled: el('#providerEnabled').checked,
    is_default: el('#providerDefault').checked
  };
  try {
    await api(id ? `/admin/providers/${id}` : '/admin/providers', { method: id ? 'PUT' : 'POST', body });
    resetProviderForm();
    await loadAdmin();
    setAdminStatus('已保存。');
  } catch (err) {
    setAdminStatus(err.message, true);
  }
}

async function testProvider(id) {
  setAdminStatus('正在测试 provider...');
  try {
    const data = await api(`/admin/providers/${id}/test`, { method: 'POST', body: {} });
    setAdminStatus(`测试通过：${data.text || 'ok'}`);
  } catch (err) {
    setAdminStatus(`测试失败：${err.message}`, true);
  }
}

async function deleteProvider(id) {
  if (!confirm('确定删除这个 provider？')) return;
  await api(`/admin/providers/${id}`, { method: 'DELETE' });
  await loadAdmin();
}

async function reindexKnowledge() {
  setAdminStatus('正在重新导入 /root/kaoyan...');
  try {
    const data = await api('/admin/reindex', { method: 'POST', body: {} });
    await loadAdmin();
    setAdminStatus(`导入完成，知识片段：${data.knowledgeChunks}`);
  } catch (err) {
    setAdminStatus(err.message, true);
  }
}

function setAdminStatus(text, error = false) {
  const status = el('#adminStatus');
  status.textContent = text;
  status.className = error ? 'status error' : 'status';
}

function updateThinkLine(node, startedAt, label) {
  if (!node) return;
  const text = node.querySelector('.think-text');
  if (text) text.textContent = `${label} · ${formatDuration(Date.now() - startedAt)}`;
}

function finishThinkLine(node, startedAt, error = false, label = '') {
  if (!node) return;
  node.classList.toggle('error', error);
  const text = node.querySelector('.think-text');
  if (text) text.textContent = `${label || (error ? '请求结束' : '深度思考完成')} · ${formatDuration(Date.now() - startedAt)}`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function scheduleStreamingRender(target, raw) {
  target.dataset.raw = raw;
  if (streamingRenderTimers.has(target)) return;
  const timer = setTimeout(async () => {
    streamingRenderTimers.delete(target);
    await renderMessageContent(target, target.dataset.raw || '');
    scrollMessages();
  }, 350);
  streamingRenderTimers.set(target, timer);
}

async function flushStreamingRender(target, raw) {
  const timer = streamingRenderTimers.get(target);
  if (timer) {
    clearTimeout(timer);
    streamingRenderTimers.delete(target);
  }
  target.dataset.raw = raw;
  await renderMessageContent(target, raw);
}

async function renderMessageContent(target, raw) {
  target.innerHTML = renderMarkdown(raw);
  enhanceAnswerSections(target.closest('article.message') || target);
  enhanceCodeBlocks(target);
  const completeMath = hasCompleteMathSegment(raw);
  const isStreaming = target.classList.contains('streaming');
  if (completeMath || !isStreaming) {
    const renderPromise = ensureMathRendered(target, { recover: !isStreaming });
    if (isStreaming) renderPromise.catch((err) => console.warn('Streaming math render failed:', err));
    else await renderPromise;
  }
  if (isStreaming) {
    queueMathRecovery(target, [450, 1200, 2600]);
  }
}

async function readSse(response, handlers, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const abort = () => reader.cancel().catch(() => {});
  try {
    if (signal?.aborted) throw abortError();
    signal?.addEventListener('abort', abort, { once: true });
    while (true) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const parsed = parseSseFrame(frame);
        if (parsed && handlers[parsed.event]) {
          await handlers[parsed.event](parsed.data);
          if (parsed.event === 'done') {
            try {
              await reader.cancel();
            } catch {}
            return;
          }
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseSseFrame(tail);
      if (parsed && handlers[parsed.event]) await handlers[parsed.event](parsed.data);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function abortError() {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  }
}

function parseSseFrame(frame) {
  let event = 'message';
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}

function renderMarkdown(text) {
  const source = normalizeMathDelimiters(text || '');
  const protectedMath = protectMathSegments(source);
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true, mangle: false, headerIds: false });
    return restoreMathSegments(marked.parse(protectedMath.text), protectedMath.segments);
  }
  return restoreMathSegments(escapeHtml(protectedMath.text).replace(/\n/g, '<br>'), protectedMath.segments);
}

function enhanceCodeBlocks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.closest('.code-block')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const label = document.createElement('span');
    label.className = 'code-block-lang';
    label.textContent = codeLanguageLabel(code);
    const button = document.createElement('button');
    button.className = 'code-copy-button';
    button.type = 'button';
    button.dataset.copyCode = 'true';
    button.textContent = '复制代码';
    header.append(label, button);
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.append(header, pre);
  });
}

function enhanceAnswerSections(root) {
  if (!root?.querySelectorAll) return;
  const articles = root.matches?.('article.message.assistant') ? [root] : [...root.querySelectorAll('article.message.assistant')];
  for (const article of articles) {
    const headings = [...article.querySelectorAll('.message-content h1, .message-content h2, .message-content h3')];
    headings.forEach((heading, index) => {
      heading.dataset.answerSectionIndex = String(index);
      heading.classList.add('answer-section-heading');
    });
  }
}

function jumpToAnswerSection(button) {
  const article = button.closest('article.message');
  const index = Number(button.dataset.answerSection || 0);
  const heading = article?.querySelector(`.answer-section-heading[data-answer-section-index="${index}"]`);
  if (!heading) return;
  heading.scrollIntoView({ block: 'center', behavior: 'auto' });
  heading.classList.add('answer-section-active');
  setTimeout(() => heading.classList.remove('answer-section-active'), 1800);
}

function codeLanguageLabel(code) {
  const className = [...(code.classList || [])].find((name) => name.startsWith('language-'));
  return className ? className.replace(/^language-/, '').toUpperCase() : 'CODE';
}

function normalizeMathDelimiters(text) {
  return text
    .replace(/＼/g, '\\')
    .replace(/\\\\\[/g, '\\[')
    .replace(/\\\\\]/g, '\\]')
    .replace(/\\\\\(/g, '\\(')
    .replace(/\\\\\)/g, '\\)')
    .replace(/(^|\n)\s*\[\s*\n([\s\S]*?(?:\\[a-zA-Z]+|[_^=+\-*/]|\\frac|\\int)[\s\S]*?)\n\s*\]\s*(?=\n|$)/g, '$1\\[$2\\]')
    .replace(/(^|\n)\s*\[\s*([^\]\n]*(?:\\[a-zA-Z]+|[_^=+\-*/]|\\frac|\\int)[^\]\n]*)\s*\]\s*(?=\n|$)/g, '$1\\[$2\\]')
    .replace(/\\\[/g, '\\[')
    .replace(/\\\]/g, '\\]')
    .replace(/\\\(/g, '\\(')
    .replace(/\\\)/g, '\\)');
}

function protectMathSegments(text) {
  const segments = [];
  const protectedText = text.replace(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$)/g, (segment) => {
    const token = `@@KC_MATH_${segments.length}@@`;
    segments.push(segment);
    return token;
  });
  return { text: protectedText, segments };
}

function restoreMathSegments(html, segments) {
  return segments.reduce((out, segment, index) => {
    const token = new RegExp(`@@KC_MATH_${index}@@`, 'g');
    return out.replace(token, mathSegmentHtml(segment));
  }, html);
}

function mathSegmentHtml(segment) {
  const value = String(segment || '');
  const display = value.startsWith('\\[') || value.startsWith('$$');
  const className = display ? 'math-source math-source-display' : 'math-source';
  return `<span class="${className}" data-copy-math="${escapeAttr(value)}" title="点击复制公式源码">${escapeHtml(value)}</span>`;
}

async function ensureMathRendered(container, options = {}) {
  if (!container) return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = await typesetMath(container);
    await nextFrame();
    if (!hasVisibleMathDelimiters(container)) {
      mathRecoveryAttempts.delete(container);
      return;
    }
    if (!rendered) break;
    await delay(180 * (attempt + 1));
  }
  if (hasVisibleMathDelimiters(container)) {
    const attempts = (mathRecoveryAttempts.get(container) || 0) + 1;
    mathRecoveryAttempts.set(container, attempts);
    if (options.recover !== false && attempts <= 5) queueMathRecovery(container, [800, 2400, 6000]);
  }
}

function queueMathRecovery(root = document, delays = [0, 250, 900, 2200]) {
  for (const wait of delays) {
    setTimeout(() => {
      recoverVisibleMath(root);
    }, wait);
  }
}

async function recoverVisibleMath(root = document) {
  const scope = root && (root === document || root.isConnected) ? root : document;
  const contents = scope.classList?.contains('message-content')
    ? [scope]
    : [...(scope.querySelectorAll?.('.message-content') || [])];
  for (const content of contents) {
    if (!content.isConnected || !hasVisibleMathDelimiters(content)) continue;
    const stillStreaming = content.classList.contains('streaming') && state.sending;
    if (stillStreaming && !hasCompleteMathSegment(content.dataset.raw || content.textContent || '')) continue;
    if (!stillStreaming) content.classList.remove('streaming');
    await ensureMathRendered(content, { recover: !stillStreaming });
  }
}

function handleMathJaxReady() {
  mathJaxReadyPromise = Promise.resolve(true);
  queueMathRecovery(document, [0, 150, 600, 1600]);
}

async function typesetMath(container) {
  mathJaxTypesetQueue = mathJaxTypesetQueue
    .catch(() => {})
    .then(async () => {
      const ready = await waitForMathJaxReady();
      if (!ready) return false;
      const currentMathJax = window.MathJax;
      if (!currentMathJax?.typesetPromise) return false;
      if (container && !container.isConnected) return false;
      if (currentMathJax.typesetClear && container) {
        currentMathJax.typesetClear([container]);
      }
      await currentMathJax.typesetPromise(container ? [container] : undefined);
      return true;
    });

  try {
    return await mathJaxTypesetQueue;
  } catch (err) {
    console.warn('MathJax typeset failed:', err);
    return false;
  }
}

function waitForMathJaxReady() {
  if (window.MathJax?.typesetPromise) return Promise.resolve(true);
  if (mathJaxReadyPromise) return mathJaxReadyPromise;
  mathJaxReadyPromise = new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      if (!ready) mathJaxReadyPromise = null;
      resolve(ready);
    };
    const check = () => {
      const mathJax = window.MathJax;
      if (mathJax?.typesetPromise) {
        finish(true);
        return;
      }
      if (mathJax?.startup?.promise) {
        mathJax.startup.promise.then(() => finish(Boolean(window.MathJax?.typesetPromise)), () => finish(false));
        return;
      }
      if (Date.now() - startedAt > 12000) {
        finish(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
  return mathJaxReadyPromise;
}

function hasVisibleMathDelimiters(container) {
  const text = container?.textContent || '';
  return text.includes('\\[') || text.includes('\\]') || text.includes('\\(') || text.includes('\\)') || text.includes('$$');
}

function hasCompleteMathSegment(text) {
  const source = normalizeMathDelimiters(text || '');
  return /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$)/.test(source);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json();
}

async function errorText(response) {
  try {
    const data = await response.json();
    return data.message || data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scrollMessages(force = false) {
  const box = el('#messages');
  if (!box) return;
  const style = window.getComputedStyle(box);
  if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
    const shouldScroll = force || box.scrollHeight - box.clientHeight - box.scrollTop <= 180;
    if (shouldScroll) box.scrollTop = box.scrollHeight;
    updateScrollAffordance();
    return;
  }
  const shouldScroll = force || isNearBottom();
  if (shouldScroll) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
  updateScrollAffordance();
}

function handleWindowScroll() {
  state.autoScroll = isNearBottom();
  if (state.selectionToolbar.open) closeSelectionToolbar();
  updateScrollAffordance();
}

function isNearBottom(threshold = 180) {
  const doc = document.documentElement;
  return doc.scrollHeight - window.innerHeight - window.scrollY <= threshold;
}

function updateScrollAffordance() {
  const button = el('#scrollBottomBtn');
  if (!button) return;
  const canScroll = document.documentElement.scrollHeight > window.innerHeight + 120;
  button.classList.toggle('hidden', !canScroll || isNearBottom());
}

function el(selector) {
  return document.querySelector(selector);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function draftStorageKey(conversationId = state.currentConversationId) {
  const studentNo = state.student?.studentNo || 'guest';
  return `${DRAFT_PREFIX}${studentNo}:${conversationId || 'new'}`;
}

function composerHistoryStorageKey() {
  const studentNo = state.student?.studentNo || 'guest';
  return `${COMPOSER_HISTORY_PREFIX}${studentNo}`;
}

function loadComposerHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(composerHistoryStorageKey()) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, COMPOSER_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function customPromptsStorageKey() {
  return `${CUSTOM_PROMPTS_PREFIX}${state.student?.studentNo || 'anonymous'}`;
}

function loadCustomPrompts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(customPromptsStorageKey()) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStoredCustomPrompt)
      .filter(Boolean)
      .slice(0, CUSTOM_PROMPT_LIMIT);
  } catch {
    return [];
  }
}

function saveCustomPrompts() {
  try {
    localStorage.setItem(customPromptsStorageKey(), JSON.stringify((state.customPrompts || []).slice(0, CUSTOM_PROMPT_LIMIT)));
  } catch {}
}

function normalizeStoredCustomPrompt(item) {
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text || '').trim().slice(0, CUSTOM_PROMPT_TEXT_LIMIT);
  if (!text) return null;
  const id = String(item.id || `custom_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`);
  return {
    id,
    label: normalizeCustomPromptLabel(item.label || makePromptLabel(text)),
    text,
    createdAt: String(item.createdAt || item.created_at || new Date().toISOString())
  };
}

function recordComposerHistory(text) {
  const value = String(text || '').trim();
  if (!value) return;
  const items = [value, ...state.composerHistory.items.filter((item) => item !== value)].slice(0, COMPOSER_HISTORY_LIMIT);
  state.composerHistory = { items, index: -1, draft: '' };
  try {
    localStorage.setItem(composerHistoryStorageKey(), JSON.stringify(items));
  } catch {}
}

function handleComposerHistoryKeydown(event) {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const input = event.currentTarget;
  if (!input || input.selectionStart !== input.selectionEnd || !state.composerHistory.items.length) return false;
  const navigating = state.composerHistory.index >= 0;
  if (!navigating && input.value.trim()) return false;
  if (event.key === 'ArrowDown' && !navigating) return false;
  event.preventDefault();
  if (event.key === 'ArrowUp') stepComposerHistory(input, 1);
  else stepComposerHistory(input, -1);
  return true;
}

function stepComposerHistory(input, direction) {
  const items = state.composerHistory.items;
  if (!items.length) return;
  if (state.composerHistory.index < 0) {
    state.composerHistory.draft = input.value;
    state.composerHistory.index = 0;
  } else {
    state.composerHistory.index += direction;
  }
  if (state.composerHistory.index < 0) {
    applyComposerHistoryValue(input, state.composerHistory.draft || '');
    resetComposerHistoryNavigation();
    return;
  }
  state.composerHistory.index = clamp(state.composerHistory.index, 0, items.length - 1);
  applyComposerHistoryValue(input, items[state.composerHistory.index] || '');
}

function applyComposerHistoryValue(input, value) {
  input.value = value;
  saveDraftForConversation(state.currentConversationId, input.value);
  autoResizeTextarea(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function resetComposerHistoryNavigation() {
  state.composerHistory.index = -1;
  state.composerHistory.draft = '';
}

function composerDraftKey(conversationId = state.currentConversationId) {
  return conversationId || 'new';
}

function saveCurrentComposer() {
  saveCurrentDraft();
  saveCurrentAttachments();
}

function restoreCurrentComposer() {
  restoreCurrentDraft();
  restoreCurrentAttachments();
}

function saveCurrentDraft() {
  const input = el('#messageInput');
  if (!input) return;
  saveDraftForConversation(state.currentConversationId, input.value);
}

function saveDraftForConversation(conversationId, value) {
  try {
    const text = String(value || '');
    const key = draftStorageKey(conversationId);
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {}
}

function restoreCurrentDraft() {
  const input = el('#messageInput');
  if (!input) return;
  try {
    input.value = localStorage.getItem(draftStorageKey()) || '';
  } catch {
    input.value = '';
  }
  autoResizeTextarea(input);
}

function clearDraftForConversation(conversationId = state.currentConversationId) {
  try {
    localStorage.removeItem(draftStorageKey(conversationId));
  } catch {}
}

function saveCurrentAttachments() {
  const key = composerDraftKey();
  if (state.attachments.length) {
    state.attachmentDrafts.set(key, state.attachments.map((item) => ({ ...item })));
  } else {
    state.attachmentDrafts.delete(key);
  }
}

function restoreCurrentAttachments() {
  const saved = state.attachmentDrafts.get(composerDraftKey()) || [];
  state.attachments = saved.map((item) => ({ ...item }));
  const input = el('#imageInput');
  if (input) input.value = '';
  renderAttachments();
}

function clearAttachmentsForConversation(conversationId = state.currentConversationId) {
  state.attachmentDrafts.delete(composerDraftKey(conversationId));
}

function loadStoredBool(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function loadStoredSidebarCollapsed() {
  try {
    const stored = localStorage.getItem('kc_sidebar_collapsed');
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {}
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(max-width: 860px)').matches;
}

function loadStoredTheme() {
  try {
    return localStorage.getItem('kc_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}
