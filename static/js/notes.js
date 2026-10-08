// notes.js — 笔记列表页、卡片网格与笔记详情页（Phase 5）。
// 约束：用户内容只能经 markdown.js 的 renderMarkdown() 进入 DOM；
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
import { api } from './api.js';
import { navigate } from './router.js';
import { renderMarkdown } from './markdown.js';
import { confirmDialog, emptyState, formatDate, noteCard, pagination, skeleton, toast } from './ui.js';

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  ['all', '全部'], ['draft', '草稿'], ['private', '私密'], ['public', '已分享'],
];
const SORT_FILTERS = [['updated', '按更新时间'], ['created', '按创建时间']];
const STATUS_KEYS = STATUS_FILTERS.map(([value]) => value);
const STATUS_LABEL = { draft: '草稿', private: '私密', public: '已分享' };

/* ==========================================================================
   query 读取与地址栏构造（筛选状态可分享、可刷新）
   ========================================================================== */

function readQuery() {
  let params;
  try { params = new URLSearchParams(location.search); } catch (_) { params = null; }
  const get = (key) => (params ? params.get(key) : null);

  const status = get('status');
  const sort = get('sort');
  const page = parseInt(get('page'), 10);
  return {
    status: STATUS_KEYS.includes(status) ? status : 'all',
    q: (get('q') || '').trim(),
    tag: get('tag') || '',
    sort: sort === 'created' ? 'created' : 'updated',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function hasFilters(query) {
  return query.status !== 'all' || !!query.q || !!query.tag || query.sort !== 'updated';
}

/** 把筛选状态编码成地址栏路径；默认值不写进 URL，保持链接干净。 */
function listPath(query) {
  const params = new URLSearchParams();
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.tag) params.set('tag', query.tag);
  if (query.sort && query.sort !== 'updated') params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const search = params.toString();
  return `/notes${search ? `?${search}` : ''}`;
}

function apiQuery(query) {
  const params = new URLSearchParams();
  params.set('status', query.status);
  params.set('sort', query.sort);
  params.set('page', String(query.page));
  params.set('page_size', String(PAGE_SIZE));
  if (query.q) params.set('q', query.q);
  if (query.tag) params.set('tag', query.tag);
  return params.toString();
}

/* ==========================================================================
   工具条：状态筛选 / 标签下拉 / 搜索 / 排序 / 清除筛选
   ========================================================================== */

function segmented(options, current, onPick) {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'group');

  options.forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segmented-btn';
    btn.setAttribute('data-value', value);
    btn.textContent = label;
    const active = value === current;
    if (active) btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => onPick(value));
    group.appendChild(btn);
  });
  return group;
}

function buildToolbar(query) {
  const bar = document.createElement('div');
  bar.className = 'note-toolbar';

  bar.appendChild(segmented(STATUS_FILTERS, query.status, (value) => {
    navigate(listPath({ ...query, status: value, page: 1 }));
  }));

  const select = document.createElement('select');
  select.className = 'tag-filter';
  select.setAttribute('aria-label', '按标签筛选');
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = '全部标签';
  select.appendChild(allOption);
  select.addEventListener('change', () => {
    navigate(listPath({ ...query, tag: select.value, page: 1 }));
  });
  bar.appendChild(select);

  api.get('/api/tags', { silent: true }).then((data) => {
    ((data && data.items) || []).forEach((tag) => {
      const option = document.createElement('option');
      option.value = tag.name;
      option.textContent = tag.name;
      select.appendChild(option);
    });
    select.value = query.tag;
  }).catch(() => { /* 标签下拉加载失败不阻塞列表 */ });

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'note-search';
  search.setAttribute('placeholder', '搜索标题或正文…');
  search.setAttribute('aria-label', '搜索笔记');
  search.value = query.q;
  let timer = null;
  search.addEventListener('input', () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      navigate(listPath({ ...query, q: search.value.trim(), page: 1 }));
    }, 300);
  });
  bar.appendChild(search);

  bar.appendChild(segmented(SORT_FILTERS, query.sort, (value) => {
    navigate(listPath({ ...query, sort: value, page: 1 }));
  }));

  if (hasFilters(query)) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-ghost clear-filters';
    clear.textContent = '清除筛选';
    clear.addEventListener('click', () => navigate('/notes'));
    bar.appendChild(clear);
  }

  return bar;
}

/* ==========================================================================
   卡片网格（Phase 7 的 /me「我的笔记」将复用本函数）
   ========================================================================== */

export function renderNoteGrid(container, query) {
  const region = document.createElement('div');
  region.className = 'note-content';
  container.appendChild(region);
  region.appendChild(skeleton(6));

  let cancelled = false;

  api.get(`/api/notes?${apiQuery(query)}`)
    .then((data) => {
      if (cancelled) return;
      paintGrid(region, query, data);
    })
    .catch(() => {
      // 错误文案由 api.js 统一以 toast 展示后端 message
      if (!cancelled) region.textContent = '';
    });

  return () => { cancelled = true; };
}

function paintGrid(region, query, data) {
  region.textContent = '';

  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  const pageSize = (data && data.page_size) || PAGE_SIZE;
  const page = (data && data.page) || query.page;

  if (items.length === 0) {
    if (hasFilters(query)) {
      region.appendChild(emptyState({
        title: '没有找到符合条件的笔记',
        actionText: '清除筛选',
        onAction: () => navigate('/notes'),
      }));
    } else {
      region.appendChild(emptyState({
        title: '还没有笔记，去写下第一篇吧',
        actionText: '写第一篇笔记',
        onAction: () => navigate('/notes/new'),
      }));
    }
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'note-grid';
  items.forEach((note) => {
    grid.appendChild(noteCard(note, {
      onOpen: () => navigate(`/notes/${note.id}`),
      onRemove: () => navigate('/notes'),
    }));
  });
  region.appendChild(grid);

  region.appendChild(pagination({
    page,
    pageSize,
    total,
    onChange: (next) => navigate(listPath({ ...query, page: next })),
  }));
}

/* ==========================================================================
   列表页：工具条 + 网格
   ========================================================================== */

export function renderNoteList(root, params = {}) {
  void params;
  const query = readQuery();

  const page = document.createElement('section');
  page.className = 'note-page';

  const body = document.createElement('div');
  body.className = 'note-body';

  page.append(buildToolbar(query), body);
  root.appendChild(page);

  renderNoteGrid(body, query);
  return page;
}

/* ==========================================================================
   详情页（Phase 5 Task 4）：单栏纸张 + 元信息 + 正文 + 操作条
   分享按钮由 Phase 6、收藏按钮由 Phase 7 插入 .detail-actions
   ========================================================================== */

export function renderNoteDetail(root, params = {}) {
  const page = document.createElement('section');
  page.className = 'note-page note-detail';
  root.appendChild(page);
  page.appendChild(skeleton(2));

  api.get(`/api/notes/${params.id}`)
    .then((data) => paintDetail(page, (data && data.note) || {}))
    .catch(() => paintNotFound(page));
}

function paintDetail(page, note) {
  page.textContent = '';

  const article = document.createElement('article');
  article.className = 'paper paper-padded detail-paper';

  const title = document.createElement('h1');
  title.className = 'detail-title';
  title.textContent = note.title || '无标题';
  article.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'detail-meta';

  const status = STATUS_LABEL[note.status] ? note.status : 'draft';
  const badge = document.createElement('span');
  badge.className = `badge badge-${status}`;
  badge.textContent = STATUS_LABEL[status];
  meta.appendChild(badge);

  const time = document.createElement('time');
  time.className = 'detail-time';
  time.textContent = formatDate(note.updated_at);
  meta.appendChild(time);

  const length = document.createElement('span');
  length.className = 'detail-length';
  length.textContent = `共 ${String(note.content_md || '').replace(/\s/g, '').length} 字`;
  meta.appendChild(length);

  const tags = Array.isArray(note.tags) ? note.tags : [];
  if (tags.length) {
    const tagList = document.createElement('ul');
    tagList.className = 'note-tags';
    tags.forEach((name) => {
      const item = document.createElement('li');
      item.className = 'tag-chip';
      item.textContent = name;
      tagList.appendChild(item);
    });
    meta.appendChild(tagList);
  }
  article.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'detail-body markdown-body';
  if (note.content_md) body.innerHTML = renderMarkdown(note.content_md);
  else body.textContent = '（空白笔记）';
  article.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn btn-secondary';
  edit.textContent = '编辑';
  edit.addEventListener('click', () => navigate(`/notes/${note.id}/edit`));
  actions.appendChild(edit);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-danger';
  remove.textContent = '删除';
  remove.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '删除笔记',
      message: '确定要删除这篇笔记吗？删除后无法恢复。',
      confirmText: '确定删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.del(`/api/notes/${note.id}`);
      toast('已删除', 'success');
      navigate('/notes');
    } catch (_) { /* 错误文案由 api.js 统一 toast */ }
  });
  actions.appendChild(remove);

  article.appendChild(actions);
  page.appendChild(article);
}

function paintNotFound(page) {
  page.textContent = '';
  page.appendChild(emptyState({
    title: '笔记不存在或已被删除',
    actionText: '返回笔记列表',
    onAction: () => navigate('/notes'),
  }));
}
