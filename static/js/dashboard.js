// dashboard.js — 工作台（依据 项目截图/02工作台.png）
// 登录后的默认落地页：三张统计卡（草稿 / 已发布 / 收藏）+ 最近文章列表 + 页脚标语。
// 数据全部来自既有接口，不新增后端端点：
//   草稿数   GET /api/notes?status=draft&page_size=1   → total
//   已发布数 GET /api/notes?page_size=1（全部）− 草稿数  → total 之差
//            （含「私密」与「已分享」两种已离开草稿的状态；只数 private 会漏掉已分享的笔记）
//   收藏数   GET /api/favorites?page_size=1            → total
//   最近文章 GET /api/notes?sort=updated&page_size=5   → items

import { api } from './api.js';
import { navigate } from './router.js';
import { formatDate, skeleton } from './ui.js';

/* 工作台使用截图里的措辞：草稿 / 已发布 / 已分享 */
const STATUS_LABELS = { draft: '草稿', private: '已发布', public: '已分享' };
const STATUS_CLASS = { draft: 'badge-tag', private: 'badge-ok', public: 'badge-ok' };
const RECENT_LIMIT = 5;

function statCard(label) {
  const card = document.createElement('div');
  card.className = 'dash-stat';
  const value = document.createElement('p');
  value.className = 'dash-stat-value';
  value.textContent = '—';
  const caption = document.createElement('p');
  caption.className = 'dash-stat-label';
  caption.textContent = label;
  card.append(value, caption);
  return { card, value };
}

function recentRow(note) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'dash-row';

  const title = document.createElement('span');
  title.className = 'dash-row-title';
  title.textContent = note.title || '无标题';

  const badge = document.createElement('span');
  badge.className = STATUS_CLASS[note.status] || 'badge-tag';
  badge.textContent = STATUS_LABELS[note.status] || note.status;

  const time = document.createElement('span');
  time.className = 'dash-row-time';
  time.textContent = formatDate(note.updated_at);

  row.append(title, badge, time);
  row.addEventListener('click', () => navigate(`/notes/${note.id}`));
  return row;
}

async function load(stats, recent) {
  const count = async (path) => {
    try {
      const data = await api.get(path, { silent: true });
      return data && typeof data.total === 'number' ? data.total : 0;
    } catch (_) {
      return null;
    }
  };

  const [total, draft, favorites, notes] = await Promise.all([
    count('/api/notes?page_size=1'),
    count('/api/notes?status=draft&page_size=1'),
    count('/api/favorites?page_size=1'),
    api.get(`/api/notes?sort=updated&page_size=${RECENT_LIMIT}`, { silent: true })
      .catch(() => null),
  ]);

  // 「已发布」= 全部 − 草稿：既包含「私密」也包含「已分享」。
  // 早先只统计 status=private，导致已开启分享的笔记在工作台上显示为 0。
  const published = (total === null || draft === null) ? null : total - draft;

  stats.textContent = '';
  [
    ['草稿', draft],
    ['已发布', published],
    ['收藏', favorites],
  ].forEach(([label, value]) => {
    const { card, value: el } = statCard(label);
    if (value !== null) el.textContent = String(value);
    stats.appendChild(card);
  });

  recent.textContent = '';
  const heading = document.createElement('h2');
  heading.textContent = '最近文章';
  recent.appendChild(heading);

  const items = notes && Array.isArray(notes.items) ? notes.items : [];
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'dash-empty';
    empty.textContent = '还没有文章，点右上角「新建文章」写下第一篇吧';
    recent.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'dash-list';
  items.forEach((note) => list.appendChild(recentRow(note)));
  recent.appendChild(list);
}

export function renderDashboard(root) {
  const page = document.createElement('section');
  page.className = 'dash-page';

  const head = document.createElement('div');
  head.className = 'dash-head';
  const title = document.createElement('h1');
  title.className = 'dash-title';
  title.textContent = '工作台';

  const actions = document.createElement('div');
  actions.className = 'dash-actions';

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn btn-gold';
  create.textContent = '新建文章';
  create.addEventListener('click', () => navigate('/notes/new'));

  const mine = document.createElement('button');
  mine.type = 'button';
  mine.className = 'btn btn-secondary';
  mine.textContent = '我的文章';
  mine.addEventListener('click', () => navigate('/notes'));

  actions.append(create, mine);
  head.append(title, actions);

  const stats = document.createElement('div');
  stats.className = 'dash-stats';

  const recent = document.createElement('section');
  recent.className = 'dash-section';

  const foot = document.createElement('p');
  foot.className = 'dash-foot';
  foot.textContent = '用心记录，让知识更有价值。© 个人笔记';

  page.append(head, stats, recent, foot);
  root.appendChild(page);

  stats.appendChild(skeleton(3));
  recent.appendChild(skeleton(2));
  load(stats, recent);
}
