// home.js — 主页视图：hero 文案与按钮、四项特性条。
// 文案逐字对齐设计稿（图片素材/个人笔记-主页截图.jpg），不得改写。
import { store } from './store.js';
import { navigate } from './router.js';

const HERO = {
  titleLines: ['记录生活 · 书写成长', '遇见美好'],
  subtitle: [
    '个人笔记是一款简洁优雅的在线笔记应用，',
    '帮助你随时随地记录灵感、管理任务、沉淀思考，',
    '让每一个想法都被珍藏，让每一天都更有意义。',
  ],
  primaryCta: '开始记录',
  secondaryCta: '了解更多',
};

const FEATURES = [
  { icon: 'notebook', title: '简洁易用', desc: '界面清新，专注记录' },
  { icon: 'cloud',    title: '云端同步', desc: '多端同步，安全可靠' },
  { icon: 'shield',   title: '隐私保护', desc: '数据加密，隐私无忧' },
  { icon: 'tag',      title: '灵活分类', desc: '标签管理，高效查找' },
];

const HERO_IMG_ALT = '铺着阳光的桌面上放着咖啡、翻开的手写笔记本与一枝白色小花';

/* 线性图标（1.5px 描边，currentColor 着色，aria-hidden 由容器承担） */
const ICONS = {
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/></svg>',
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4v16"/><path d="M12 9h4M12 13h4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.5 9 4 4 0 0 0 7 18z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V5a1 1 0 0 1 1-1h6l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.2"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7-4.6-7-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7 3c0 5-7 9.6-7 9.6z"/></svg>',
};

/* 「开始记录」目标：未登录时经登录页回跳（Phase 3 才有登录页） */
export function heroPrimaryTarget(isLoggedIn) {
  return isLoggedIn ? '/notes/new' : '/login?redirect=' + encodeURIComponent('/notes/new');
}

function iconEl(className, markup) {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = markup;
  return span;
}

function label(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function buildHero() {
  const section = document.createElement('section');
  section.className = 'hero';

  const copy = document.createElement('div');
  copy.className = 'hero-copy';

  copy.appendChild(iconEl('hero-heart', ICONS.heart));

  const title = document.createElement('h1');
  HERO.titleLines.forEach((line, index) => {
    if (index > 0) title.appendChild(document.createElement('br'));
    title.appendChild(document.createTextNode(line));
  });
  copy.appendChild(title);

  const underline = document.createElement('span');
  underline.className = 'hero-underline';
  underline.setAttribute('aria-hidden', 'true');
  copy.appendChild(underline);

  const sub = document.createElement('p');
  sub.className = 'hero-sub';
  HERO.subtitle.forEach((line, index) => {
    if (index > 0) sub.appendChild(document.createElement('br'));
    sub.appendChild(label(line));
  });
  copy.appendChild(sub);

  const actions = document.createElement('div');
  actions.className = 'hero-actions';

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'btn btn-primary';
  primary.append(iconEl('btn-icon', ICONS.pen), label(HERO.primaryCta));
  primary.addEventListener('click', () => navigate(heroPrimaryTarget(store.isLoggedIn())));

  const secondary = document.createElement('button');
  secondary.type = 'button';
  secondary.className = 'btn btn-ghost';
  secondary.append(iconEl('btn-icon', ICONS.play), label(HERO.secondaryCta));
  secondary.addEventListener('click', () => navigate('/about'));

  actions.append(primary, secondary);
  copy.appendChild(actions);

  const picture = document.createElement('picture');
  picture.className = 'hero-media';
  const webp = document.createElement('source');
  webp.type = 'image/webp';
  webp.srcset = '/static/img/hero.webp 1920w, /static/img/hero-960.webp 960w';
  webp.sizes = '100vw';
  const img = document.createElement('img');
  img.src = '/static/img/hero.jpg';
  img.srcset = '/static/img/hero.jpg 1920w, /static/img/hero-960.jpg 960w';
  img.sizes = '100vw';
  img.alt = HERO_IMG_ALT;
  picture.append(webp, img);

  section.append(copy, picture);
  return section;
}

function buildFeatures() {
  const section = document.createElement('section');
  section.className = 'features';

  const heading = document.createElement('h2');
  heading.className = 'sr-only';
  heading.textContent = '产品特性';
  section.appendChild(heading);

  const list = document.createElement('ul');
  FEATURES.forEach((feature) => {
    const item = document.createElement('li');
    item.className = 'feature';
    item.appendChild(iconEl('feature-icon', ICONS[feature.icon]));

    const title = document.createElement('h3');
    title.textContent = feature.title;
    const desc = document.createElement('p');
    desc.textContent = feature.desc;
    item.append(title, desc);
    list.appendChild(item);
  });
  section.appendChild(list);
  return section;
}

export function renderHome(root) {
  root.appendChild(buildHero());
  root.appendChild(buildFeatures());
}
