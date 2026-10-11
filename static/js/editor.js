// editor.js — 写笔记 / 编辑笔记：分栏实时预览、标签联想、存草稿 / 保存并发布、脏标记与离开拦截。
// 约束：预览只能经 markdown.js 的 renderMarkdown() 输出；textarea.value 不得直接赋给 innerHTML。
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
import { api } from './api.js';
import { navigate } from './router.js';
import { store } from './store.js';
import { renderMarkdown } from './markdown.js';
import { confirmDialog, emptyState, skeleton, toast } from './ui.js';

const MAX_TAGS = 5;
const MAX_SUGGESTIONS = 6;
const PREVIEW_DEBOUNCE = 120;

/** 当前挂载的编辑器：用于把 Ctrl/Cmd+S 限定在编辑器仍在页面时生效 */
let activeEditor = null;
/** 标签候选缓存：同一次会话内复用 /api/tags 结果 */
let tagCache = null;

/* ==========================================================================
   工具
   ========================================================================== */

function formatStamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countChars(text) {
  return String(text == null ? '' : text).replace(/\s/g, '').length;
}

function insertAtCursor(el, snippet) {
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
  const value = el.value;
  el.value = value.slice(0, start) + snippet + value.slice(end);
  const pos = start + snippet.length;
  try {
    el.selectionStart = pos;
    el.selectionEnd = pos;
  } catch (_) { /* 某些环境不支持设置选区，忽略 */ }
  el.dispatchEvent({ type: 'input' });
}

/* ==========================================================================
   视图
   ========================================================================== */

export function renderEditor(root, params = {}) {
  const noteId = params && params.id ? String(params.id) : null;

  activeEditor = null;
  store.setDirty(false);
  store.dirtyGuard = null;

  const wrap = document.createElement('section');
  wrap.className = 'editor-wrap';
  root.appendChild(wrap);

  if (noteId) {
    wrap.appendChild(skeleton(2));
    api.get(`/api/notes/${noteId}`)
      .then((data) => mount(wrap, (data && data.note) || {}, noteId))
      .catch(() => {
        wrap.textContent = '';
        wrap.appendChild(emptyState({
          title: '笔记不存在或已被删除',
          actionText: '返回笔记列表',
          onAction: () => navigate('/notes'),
        }));
      });
  } else {
    mount(wrap, null, null);
  }
}

function mount(wrap, note, noteId) {
  wrap.textContent = '';

  const state = {
    id: noteId ? Number(noteId) : null,
    status: note ? note.status : 'new',
    updatedAt: note ? note.updated_at : null,
    tags: note && Array.isArray(note.tags) ? note.tags.slice(0, MAX_TAGS) : [],
  };

  /* ---- 纸张容器与头部 ---- */
  const paper = document.createElement('div');
  paper.className = 'editor-paper paper';

  const head = document.createElement('div');
  head.className = 'editor-head';

  const titleInput = document.createElement('input');
  titleInput.className = 'editor-title';
  titleInput.type = 'text';
  titleInput.setAttribute('placeholder', '请输入标题');
  titleInput.setAttribute('maxlength', '200');
  titleInput.setAttribute('aria-label', '标题');
  titleInput.value = note ? (note.title || '') : '';
  head.appendChild(titleInput);

  const tagWrap = document.createElement('div');
  tagWrap.className = 'tag-input-wrap';
  const tagList = document.createElement('ul');
  tagList.className = 'editor-tags';
  const tagInput = document.createElement('input');
  tagInput.className = 'tag-input';
  tagInput.type = 'text';
  tagInput.setAttribute('placeholder', '添加标签后按回车');
  tagInput.setAttribute('aria-label', '添加标签');
  const suggestions = document.createElement('div');
  suggestions.className = 'tag-suggestions';
  tagWrap.append(tagList, tagInput, suggestions);
  head.appendChild(tagWrap);

  const draftBtn = document.createElement('button');
  draftBtn.type = 'button';
  draftBtn.className = 'btn btn-ghost';
  draftBtn.textContent = '存草稿';
  const savePublishBtn = document.createElement('button');
  savePublishBtn.type = 'button';
  savePublishBtn.className = 'btn btn-gold';
  savePublishBtn.textContent = '保存并发布';
  head.append(draftBtn, savePublishBtn);
  paper.appendChild(head);

  /* ---- 移动端「编辑 / 预览」切换 ---- */
  const tabs = document.createElement('div');
  tabs.className = 'editor-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '切换编辑与预览');

  const mkTab = (label, active) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (active) btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    return btn;
  };
  const sourceTab = mkTab('编辑', true);
  const previewTab = mkTab('预览', false);
  tabs.append(sourceTab, previewTab);
  paper.appendChild(tabs);

  /* ---- 分栏 ---- */
  const panes = document.createElement('div');
  panes.className = 'editor-panes is-showing-source';

  const sourcePane = document.createElement('div');
  sourcePane.className = 'pane-source';
  const textarea = document.createElement('textarea');
  textarea.className = 'editor-source';
  textarea.setAttribute('aria-label', 'Markdown 源码');
  textarea.setAttribute('placeholder', '在这里写下你的想法，支持 Markdown');
  textarea.value = note ? (note.content_md || '') : '';
  sourcePane.appendChild(textarea);

  const previewPane = document.createElement('div');
  previewPane.className = 'pane-preview markdown-body';
  previewPane.setAttribute('aria-live', 'polite');
  previewPane.innerHTML = renderMarkdown(textarea.value);

  panes.append(sourcePane, previewPane);
  paper.appendChild(panes);

  /* ---- 底部工具条与状态条 ---- */
  const foot = document.createElement('div');
  foot.className = 'editor-foot';

  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  const imageBtn = document.createElement('button');
  imageBtn.type = 'button';
  imageBtn.className = 'btn btn-ghost';
  imageBtn.textContent = '插入图片';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.className = 'editor-file';
  fileInput.setAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp');
  fileInput.setAttribute('aria-label', '选择要插入的图片');
  toolbar.append(imageBtn, fileInput);

  const statusEl = document.createElement('div');
  statusEl.className = 'editor-status';
  const saveState = document.createElement('span');
  saveState.className = 'status-save';
  const countEl = document.createElement('span');
  countEl.className = 'status-count';
  const timeEl = document.createElement('span');
  timeEl.className = 'status-time';
  statusEl.append(
    saveState, document.createTextNode(' · '),
    countEl, document.createTextNode(' · '),
    timeEl,
  );

  foot.append(toolbar, statusEl);
  paper.appendChild(foot);
  wrap.appendChild(paper);

  /* ==========================================================================
     状态刷新与脏标记
     ========================================================================== */

  let saveText = '已保存';

  function refreshStatus() {
    saveState.textContent = saveText;
    countEl.textContent = `共 ${countChars(textarea.value)} 字`;
    timeEl.textContent = state.updatedAt ? `更新于 ${formatStamp(state.updatedAt)}` : '新建笔记';
  }

  function markDirty() {
    if (store.dirty) return;
    store.setDirty(true);
    saveText = '未保存的更改';
    titleInput.classList.add('is-dirty');
    refreshStatus();
  }

  refreshStatus();

  /* ==========================================================================
     标签
     ========================================================================== */

  function renderTags() {
    tagList.textContent = '';
    state.tags.forEach((name) => {
      const item = document.createElement('li');
      item.className = 'tag-chip';
      item.textContent = name;
      tagList.appendChild(item);
    });
  }

  function hideSuggestions() { suggestions.textContent = ''; }

  function showSuggestions(names) {
    suggestions.textContent = '';
    names.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = name;
      btn.addEventListener('click', () => addTag(name));
      suggestions.appendChild(btn);
    });
  }

  function addTag(raw) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name) return false;
    if (state.tags.includes(name)) return false;
    if (state.tags.length >= MAX_TAGS) return false;
    state.tags.push(name);
    tagInput.value = '';
    renderTags();
    hideSuggestions();
    markDirty();
    return true;
  }

  async function loadTagNames() {
    if (tagCache) return tagCache;
    try {
      const data = await api.get('/api/tags', { silent: true });
      tagCache = ((data && data.items) || []).map((tag) => tag.name);
    } catch (_) {
      tagCache = [];
    }
    return tagCache;
  }

  renderTags();

  tagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTag(tagInput.value);
      return;
    }
    if (event.key === 'Backspace' && tagInput.value === '' && state.tags.length) {
      event.preventDefault();
      state.tags.pop();
      renderTags();
      markDirty();
    }
  });

  tagInput.addEventListener('input', async () => {
    const text = tagInput.value.trim();
    if (!text) { hideSuggestions(); return; }
    const names = await loadTagNames();
    showSuggestions(
      names.filter((name) => name.startsWith(text) && !state.tags.includes(name))
        .slice(0, MAX_SUGGESTIONS),
    );
  });

  /* ==========================================================================
     预览（120ms 防抖）与滚动同步
     ========================================================================== */

  let previewTimer = null;
  textarea.addEventListener('input', () => {
    markDirty();
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      previewPane.innerHTML = renderMarkdown(textarea.value);
    }, PREVIEW_DEBOUNCE);
    refreshStatus();
  });

  titleInput.addEventListener('input', markDirty);

  let syncing = false;
  const syncScroll = (from, to) => {
    if (syncing) return;
    const range = from.scrollHeight - from.clientHeight;
    if (!range || range <= 0) return;
    const percent = from.scrollTop / range;
    syncing = true;
    to.scrollTop = percent * (to.scrollHeight - to.clientHeight);
    syncing = false;
  };
  sourcePane.addEventListener('scroll', () => syncScroll(sourcePane, previewPane));
  previewPane.addEventListener('scroll', () => syncScroll(previewPane, sourcePane));

  /* ---- 移动端切换 ---- */
  function selectPane(showPreview) {
    panes.classList.toggle('is-showing-preview', showPreview);
    panes.classList.toggle('is-showing-source', !showPreview);
    previewTab.classList.toggle('is-active', showPreview);
    sourceTab.classList.toggle('is-active', !showPreview);
    previewTab.setAttribute('aria-pressed', showPreview ? 'true' : 'false');
    sourceTab.setAttribute('aria-pressed', showPreview ? 'false' : 'true');
  }
  sourceTab.addEventListener('click', () => selectPane(false));
  previewTab.addEventListener('click', () => selectPane(true));

  /* ==========================================================================
     保存草稿 / 保存并发布
     ========================================================================== */

  function buildPayload(status) {
    return {
      title: titleInput.value,
      content_md: textarea.value,
      tags: state.tags.slice(),
      status,
    };
  }

  /* 「存草稿」只保存内容：新建 / 草稿 → draft；已发布 / 已分享 → 状态不变。
     理由：已分享的笔记被降级会掐断仍在生效的分享链接，已发布的笔记被降级则会从
     「已发布」筛选里消失。状态的改变只由分享接口显式触发。 */
  async function saveDraft() {
    const nextStatus = (state.status === 'new' || state.status === 'draft') ? 'draft' : state.status;

    try {
      const data = state.id
        ? await api.put(`/api/notes/${state.id}`, buildPayload(nextStatus))
        : await api.post('/api/notes', buildPayload(nextStatus));
      const saved = (data && data.note) || {};

      state.id = saved.id || state.id;
      state.status = saved.status || nextStatus;
      state.updatedAt = saved.updated_at || state.updatedAt;

      store.setDirty(false);
      titleInput.classList.remove('is-dirty');
      saveText = '已保存';
      refreshStatus();
      toast(nextStatus === 'draft' ? '已保存为草稿' : '已保存，文章保持「已发布」', 'success');

      // 新建状态保存成功后换成编辑地址，避免二次提交产生重复笔记
      if (location.pathname === '/notes/new' && state.id) {
        history.replaceState({}, '', `/notes/${state.id}/edit`);
      }
    } catch (_) {
      // 错误文案由 api.js 统一以 toast 展示后端 message
      saveText = '保存失败，请重试';
      refreshStatus();
    }
  }

  /* 保存内容 + 立即开启分享：一步把草稿/已发布变成「已分享」 */
  async function saveAndPublish() {
    const confirmed = await confirmDialog({
      title: '保存并发布',
      message: '发布后会生成分享链接，笔记将变为不可编辑。确定吗？',
      confirmText: '保存并发布',
    });
    if (!confirmed) return;

    // 内容仍按「离开草稿后不改状态」的规则保存，分享状态只由分享接口设置
    const nextStatus = (state.status === 'new' || state.status === 'draft') ? 'private' : state.status;
    try {
      const data = state.id
        ? await api.put(`/api/notes/${state.id}`, buildPayload(nextStatus))
        : await api.post('/api/notes', buildPayload(nextStatus));
      const saved = (data && data.note) || {};
      const id = saved.id || state.id;

      await api.post(`/api/notes/${id}/share`, { password: '' });

      state.id = id;
      store.setDirty(false);
      if (location.pathname === '/notes/new') history.replaceState({}, '', `/notes/${id}/edit`);
      toast('已发布并开启分享', 'success');
      mount(wrap, Object.assign({}, saved, { id, status: 'public' }), String(id));
    } catch (_) {
      // 错误文案由 api.js 统一以 toast 展示后端 message
      saveText = '操作失败，请重试';
      refreshStatus();
    }
  }

  draftBtn.addEventListener('click', saveDraft);
  savePublishBtn.addEventListener('click', saveAndPublish);
  activeEditor = { wrap, saveDraft };

  /* ---- 离开拦截 ---- */
  store.dirtyGuard = () => {
    if (!wrap.parentNode) return true;          // 编辑器已卸载，无需再问
    return confirmDialog({
      title: '放弃未保存的更改？',
      message: '当前笔记有未保存的修改，离开将丢失这些内容。',
      confirmText: '放弃更改',
      danger: true,
    });
  };

  /* ==========================================================================
     图片插入
     ========================================================================== */

  imageBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const data = await api.upload('/api/uploads/image', formData);
      const url = data && data.url;
      if (url) insertAtCursor(textarea, `![](${url})`);
    } catch (_) { /* 文案由 api.js 统一 toast */ }
    fileInput.value = '';
  });

  /* ==========================================================================
     已分享（public）笔记 → 只读
     写接口只接受 draft / private（public 只能由分享接口进入），因此对已分享笔记
     保存必然被后端拒绝。与其让用户撞到「参数不合法」，不如直接置为只读。
     ========================================================================== */

  if (state.status === 'public') {
    titleInput.readOnly = true;
    textarea.readOnly = true;
    tagInput.disabled = true;
    tagInput.setAttribute('placeholder', '');
    draftBtn.remove();
    savePublishBtn.remove();
    toolbar.remove();
    store.setDirty(false);
    store.dirtyGuard = null;

    const box = document.createElement('div');
    box.className = 'editor-locked';
    box.setAttribute('role', 'status');

    const boxTitle = document.createElement('p');
    boxTitle.className = 'editor-locked-title';
    boxTitle.textContent = '已发布，不可编辑';

    const boxHint = document.createElement('p');
    boxHint.className = 'editor-locked-hint';
    boxHint.textContent = '这篇笔记已开启分享，内容已锁定。如需修改，请先在详情页关闭分享。';

    const openDetail = document.createElement('button');
    openDetail.type = 'button';
    openDetail.className = 'btn btn-secondary';
    openDetail.textContent = '打开详情页';
    openDetail.addEventListener('click', () => navigate(`/notes/${state.id}`));

    box.append(boxTitle, boxHint, openDetail);
    paper.insertBefore(box, head);

    saveText = '已发布';
    refreshStatus();
  }
}

/* ==========================================================================
   快捷键：Ctrl/Cmd + S 存草稿并阻止浏览器默认保存
   ========================================================================== */

document.addEventListener('keydown', (event) => {
  if (!activeEditor || !activeEditor.wrap.parentNode) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key !== 's' && event.key !== 'S') return;
  event.preventDefault();
  activeEditor.saveDraft();
});
