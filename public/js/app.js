// 入口：主题、语言、底部标签栏与页面切换
import { h, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { t, setLang } from './i18n.js';
import { settings, subscribe, runRecurring } from './store.js';
import { checkHealth, onHealth } from './recognize.js';
import { renderHome } from './views/home.js';
import { renderStats } from './views/stats.js';
import { renderAssets } from './views/assets.js';
import { renderMe } from './views/me.js';
import { openAdd } from './sheets/add.js';
import { localUser } from './session.js';
import { boot, startSync, onSync } from './cloud.js';
import { renderAuth } from './views/auth.js';

const TABS = [
  { id: 'home', icon: 'list', render: renderHome },
  { id: 'stats', icon: 'pie', render: renderStats },
  { id: 'assets', icon: 'wallet', render: renderAssets },
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d100a' : '#f3f6ec');
}
media.addEventListener('change', applyTheme);

function renderTabbar() {
  const item = (tab) => h('button', {
    class: `tab ${tab.id === active ? 'active' : ''}`,
    onclick: () => switchTab(tab.id),
  }, icon(tab.icon, 22, tab.id === active ? 2.1 : 1.75), h('span', null, t(`tab.${tab.id}`)));
  tabbar.replaceChildren(
    item(TABS[0]), item(TABS[1]),
    h('button', { class: 'fab', 'aria-label': t('entry.title'), onclick: () => openAdd() }, icon('plus', 28, 2.4)),
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

function recurring() {
  const auto = runRecurring();
  if (auto) toast(t('rec.made', { n: auto }), 'success');
}

function startApp() {
  subscribe(render);
  onHealth(() => { if (active === 'me') render(); });
  onSync(() => { if (active === 'me') render(); });
  render();
  checkHealth();
}

function showAuth() {
  document.title = t('app.name');
  applyTheme();
  tabbar.hidden = true;
  renderAuth(page);
}

setLang(settings().lang);
if (localUser) {
  // 已登录过：先用本机缓存把界面画出来，再在后台和服务器对账
  startApp();
  boot().then((r) => {
    if (r !== 'app') return;
    render();
    startSync({
      confirmImport: (n) => confirmDialog({ title: t('cloud.importTitle'), message: t('cloud.importMsg', { n }), okText: t('cloud.importOk'), iconName: 'upload' }),
      afterFirstSync: recurring,
    });
  });
} else {
  const r = await boot();
  if (r === 'auth') showAuth();
  else if (r === 'app') { startApp(); recurring(); }
}

window.addEventListener('resize', () => { if (active === 'stats') render(); });
