// 「+」入口：拍照记账放在最显眼的位置，其次是相册 / 语音 / 手动
import { h, openSheet } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { openEntry } from './entry.js';
import { openScan, openVoice } from './ai.js';

export function openAdd() {
  const sheet = openSheet({ title: t('entry.title'), className: 'add-sheet' });
  const go = (fn) => () => { sheet.close(); fn(); };
  const small = (ic, label, hint, fn) => h('button', { class: 'add-item', onclick: go(fn) },
    h('span', { class: 'add-ico' }, icon(ic, 22)), h('b', null, label), h('small', null, hint));
  sheet.setContent(h('div', { class: 'add-hub' },
    h('button', { class: 'add-snap', onclick: go(() => openScan({ start: 'camera' })) },
      h('span', { class: 'add-snap-ico' }, icon('camera', 30, 2)),
      h('span', { class: 'add-snap-text' },
        h('b', null, t('home.snap')),
        h('small', null, t('add.snapHint'))),
      h('span', { class: 'ai-tag' }, icon('sparkles', 12, 2), 'AI')),
    h('div', { class: 'add-row' },
      small('image', t('home.album'), t('add.albumHint'), () => openScan({ start: 'pick' })),
      small('mic', t('home.voice'), t('add.voiceHint'), openVoice),
      small('pencil', t('home.manual'), t('add.manualHint'), openEntry))));
  return sheet;
}
