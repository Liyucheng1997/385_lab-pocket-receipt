// 入口：主题、语言、底部标签栏与页面切换
import { h } from './ui.js';
import { icon } from './icons.js';
import { t, setLang } from './i18n.js';
import { settings, subscribe } from './store.js';
import { checkHealth, onHealth } from './recognize.js';
import { renderHome } from './views/home.js';
import { renderStats } from './views/stats.js';
import { renderBudget } from './views/budget.js';
import { renderMe } from './views/me.js';
import { openEntry } from './sheets/entry.js';

const TABS = [
  { id: 'home', icon: 'list', render: renderHome },
  { id: 'stats', icon: 'chart', render: renderStats },
  { id: 'budget', icon: 'pie', render: renderBudget },
  { id: 'me', icon: 'user', render: renderMe },
];

let active = 'home';
try { active = sessionStorage.getItem('ledger.tab') || 'home'; } catch { /* 存储不可用时用默认页 */ }
const scrollPos = {};

const app = document.getElementById('app');
const screen = h('main', { class: 'screen' });
const page = h('div', { class: 'page' });
const tabbar = h('nav', { class: 'tabbar' });
screen.append(page);
app.append(screen, tabbar);

const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = settings().theme;
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f5f5f7');
}
media.addEventListener('change', applyTheme);

function renderTabbar() {
  const item = (tab) => h('button', {
    class: `tab ${tab.id === active ? 'active' : ''}`,
    onclick: () => switchTab(tab.id),
  }, icon(tab.icon, 22, tab.id === active ? 2 : 1.75), h('span', null, t(`tab.${tab.id}`)));
  tabbar.replaceChildren(
    item(TABS[0]), item(TABS[1]),
    h('button', { class: 'fab', 'aria-label': t('entry.title'), onclick: () => openEntry() }, icon('plus', 26, 2.25)),
    item(TABS[2]), item(TABS[3]));
}

function render() {
  setLang(settings().lang);
  document.title = t('app.name');
  applyTheme();
  const tab = TABS.find((x) => x.id === active) || TABS[0];
  const y = screen.scrollTop;
  tab.render(page, render);
  screen.scrollTop = y;
  renderTabbar();
}

function switchTab(id) {
  if (id === active) {
    screen.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  scrollPos[active] = screen.scrollTop;
  active = id;
  try { sessionStorage.setItem('ledger.tab', id); } catch { /* 忽略 */ }
  page.classList.remove('enter');
  void page.offsetWidth;
  page.classList.add('enter');
  render();
  screen.scrollTop = scrollPos[id] || 0;
}

subscribe(render);
onHealth(() => { if (active === 'me') render(); });
render();
checkHealth();

window.addEventListener('resize', () => { if (active === 'stats') render(); });
