// Shared screen chrome: header, tab bar, toasts, bottom sheets, theme, install prompt.

import { $, $$, esc } from './util.js';
import { icon } from './icons.js';
import * as store from './store.js';

export function setHeader({ left = '', title = '', right = '' } = {}) {
  $('#tbLeft').innerHTML = left;
  $('#tbTitle').innerHTML = title;
  $('#tbRight').innerHTML = right;
}

/** Header used on the main tabs: Lodestar wordmark, project name, sun/dark switch. */
export function mainHeader() {
  const sun = document.documentElement.dataset.theme === 'sun';
  setHeader({
    title: `<a class="brand" href="#/projects" aria-label="โปรเจกต์ ${esc(store.getProject()?.name || '')} แตะเพื่อเปลี่ยนโปรเจกต์"><b>LODESTAR</b><small>${esc(store.getProject()?.name || '')}${icon('chevron', 'chev')}</small></a>`,
    right: `<button type="button" class="icon-btn" id="themeBtn" aria-label="${sun ? 'สลับเป็นโหมดมืด' : 'สลับเป็นโหมดกลางแดด'}">${icon(sun ? 'moon' : 'sun')}</button>`,
  });
  $('#themeBtn').onclick = async () => {
    const next = document.documentElement.dataset.theme === 'sun' ? 'dark' : 'sun';
    applyTheme(next);
    await store.updateSettings({ theme: next });
    mainHeader();
  };
}

export function setTabbar(visible, active) {
  const bar = $('#tabbar');
  bar.classList.toggle('hide', !visible);
  for (const a of $$('.tab', bar)) {
    const on = a.dataset.tab === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'sun' ? 'sun' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'sun' ? '#ffffff' : '#000000';
}

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Open an overlay (bottom sheet or full-screen). Clicks on [data-close] close it.
 * Returns { el, close }.
 */
export function openOverlay(html, { cls = 'sheet-wrap', onClick, onClose } = {}) {
  const ov = $('#overlay');
  ov.className = `open ${cls}`;
  ov.innerHTML = `<div class="scrim" data-close></div>${html}`;
  const close = () => {
    ov.className = '';
    ov.innerHTML = '';
    ov.onclick = null;
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.onclick = (e) => {
    if (e.target.closest('[data-close]')) return close();
    onClick?.(e, close);
  };
  return { el: ov, close };
}

// Android/desktop Chrome offer an install prompt we can trigger from a button.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.dispatchEvent(new CustomEvent('geo:installable'));
});
export const canPromptInstall = () => !!deferredInstall;
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  return choice?.outcome === 'accepted';
}
