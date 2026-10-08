// about.js — 关于页：应用介绍 / 功能清单 / 技术栈 / 致谢与联系方式（静态）。
export const CONTACT_EMAIL = 'example@example.com';

const INTRO = '个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感、管理任务、沉淀思考。'
  + '所有笔记默认只有你自己可见，需要分享时可以生成带密码的链接。';

const FEATURE_LIST = [
  'Markdown 笔记撰写与实时预览',
  '草稿与发布状态管理',
  '标签分类与关键词搜索',
  '带密码的链接分享',
  '笔记评论',
  '笔记收藏',
  '浏览足迹回顾',
  '图片上传与引用',
];

const TECH_STACK = [
  ['页面显示', '原生 HTML + CSS + JavaScript'],
  ['服务端', 'Python 3.12 + Flask'],
  ['数据库', 'SQLite'],
  ['Markdown 渲染', 'marked + DOMPurify（本地内置，不使用在线 CDN）'],
];

const CREDITS = 'Markdown 渲染由 marked 提供，HTML 清洗由 DOMPurify 提供，均以本地文件方式内置';

function paper(title) {
  const section = document.createElement('section');
  section.className = 'paper';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function paragraph(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function buildIntro() {
  const section = paper('关于个人笔记');
  section.appendChild(paragraph(INTRO));
  return section;
}

function buildFeatureList() {
  const section = paper('功能清单');
  const list = document.createElement('ul');
  list.className = 'about-list';
  FEATURE_LIST.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

function buildTechStack() {
  const section = paper('技术栈说明');
  const list = document.createElement('dl');
  list.className = 'tech-list';
  TECH_STACK.forEach(([term, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  });
  section.appendChild(list);
  return section;
}

function buildCredits() {
  const section = paper('致谢与联系方式');
  section.appendChild(paragraph(CREDITS));
  section.appendChild(paragraph(`联系邮箱：${CONTACT_EMAIL}`));
  return section;
}

export function renderAbout(root) {
  const page = document.createElement('div');
  page.className = 'about-page';
  page.append(buildIntro(), buildFeatureList(), buildTechStack(), buildCredits());
  root.appendChild(page);
}
