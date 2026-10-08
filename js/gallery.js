// Full-screen photo viewer with previous / next (buttons, arrow keys or a sideways swipe),
// Smart Photo (the photo with an information strip below it) and the direction the photo faces.
// Read-only unless `onDelete` is given (the station editor passes it): only then can a photo be
// deleted or its direction set.

import * as store from './store.js';
import * as attitude from './attitude.js';
import { openOverlay, toast } from './ui.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { az3, cardinal } from './geomath.js';
import { smartFor } from './smartauto.js';
import { deliver } from './export.js';

const SRC = { exif: 'จากกล้อง', auto: 'อ่านตอนกดถ่ายรูป', aimed: 'เล็งตั้งเอง', camera: 'กล้องในแอป' };

export async function openGallery(st, startId, { onDelete } = {}) {
  let metas = await store.listPhotos(st);
  if (!metas.length) return;
  const editable = !!onDelete;
  let i = Math.max(0, metas.findIndex((p) => p.id === startId));
  let url = null;
  let smart = null; // { file, url } while the Smart Photo is shown
  let aiming = null; // unsubscribe while setting the direction
  let aimValue = null;
  // Smart Photo is shown first unless Settings says otherwise; รูปเดิม shows the original
  let mode = store.getSettings().photoView === 'plain' ? 'plain' : 'smart';
  let seq = 0;

  const { el, close } = openOverlay(`<div class="lightbox" role="dialog" aria-label="รูปของ ${esc(st.code)}">
      <div class="lb-stage">
        <img alt="">
        <span class="lb-badge hidden">Smart Photo</span>
        <button type="button" class="lb-nav prev" aria-label="รูปก่อนหน้า">${icon('back')}</button>
        <button type="button" class="lb-nav next" aria-label="รูปถัดไป">${icon('back')}</button>
      </div>
      <div class="lb-info">
        <span class="lb-title"></span>
        <span class="lb-brg"></span>
      </div>
      <div class="lb-bar" id="lbBar"></div>
    </div>`, {
    cls: 'full',
    onClose: () => {
      if (url) URL.revokeObjectURL(url);
      if (smart) URL.revokeObjectURL(smart.url);
      aiming?.();
      document.removeEventListener('keydown', onKey);
    },
    onClick: async (e, closeIt) => {
      if (e.target.closest('.lb-nav.prev')) return show(i - 1);
      if (e.target.closest('.lb-nav.next')) return show(i + 1);
      const b = e.target.closest('[data-lb]');
      if (!b || b.disabled) return;
      const act = b.dataset.lb;
      if (act === 'del' && onDelete) {
        if (!confirm('ลบรูปนี้? ย้อนกลับไม่ได้')) return;
        await onDelete(metas[i].id);
        toast('ลบรูปแล้ว');
        metas = await store.listPhotos(st);
        if (!metas.length) return closeIt();
        show(Math.min(i, metas.length - 1));
      } else if (act === 'smart') {
        mode = 'smart';
        loadSmart();
      } else if (act === 'share' && smart) {
        const res = await deliver(smart.file);
        if (res === 'downloaded') toast('ดาวน์โหลดรูปแล้ว');
        else if (res === 'shared') toast('ส่งรูปแล้ว');
        if (res !== 'cancelled') {
          metas[i] = await store.updatePhoto(metas[i].id, { smartSavedAt: Date.now() }, { touch: false });
          renderInfo();
        }
      } else if (act === 'plain') {
        mode = 'plain';
        seq += 1;
        if (smart) { URL.revokeObjectURL(smart.url); smart = null; }
        if (url) img.src = url;
        badge.classList.add('hidden');
        renderBar();
      } else if (act === 'aim') {
        startAim();
      } else if (act === 'aim-use' && aimValue != null) {
        await saveBearing(aimValue, 'aimed');
        stopAim();
        if (mode === 'smart') loadSmart();
        toast(`ตั้งทิศที่ถ่ายเป็น ${az3(Math.round(aimValue) % 360)}° ${cardinal(aimValue)} แล้ว`);
      } else if (act === 'aim-clear') {
        await saveBearing(null, null);
        stopAim();
        if (mode === 'smart') loadSmart();
        toast('ลบทิศที่ถ่ายแล้ว');
      } else if (act === 'aim-cancel') {
        stopAim();
      } else if (act === 'close') {
        closeIt();
      }
    },
  });

  const img = el.querySelector('.lb-stage img');
  const title = el.querySelector('.lb-title');
  const brg = el.querySelector('.lb-brg');
  const bar = el.querySelector('#lbBar');
  const badge = el.querySelector('.lb-badge');

  function renderBar() {
    if (aiming) {
      bar.className = 'lb-bar aim';
      bar.innerHTML = `<div class="lb-aim">
          <p>ยกมือถือเล็งหลังเครื่องไปที่ outcrop ในทิศเดียวกับตอนถ่ายรูป</p>
          <b class="mono" id="aimVal">—</b>
        </div>
        <div class="lb-btns">
          <button type="button" class="btn sm" data-lb="aim-cancel">ยกเลิก</button>
          ${metas[i].bearing != null ? '<button type="button" class="btn sm danger" data-lb="aim-clear">ลบทิศ</button>' : ''}
          <button type="button" class="btn-primary sm" data-lb="aim-use" disabled>${icon('check')}<span>ใช้ทิศนี้</span></button>
        </div>`;
      return;
    }
    bar.className = 'lb-bar';
    const tools = `${editable ? `<button type="button" class="btn sm icon-only" data-lb="aim" aria-label="ตั้งทิศที่ถ่าย">${icon('compass')}</button>` : ''}
        ${editable ? `<button type="button" class="btn sm danger icon-only" data-lb="del" aria-label="ลบรูป">${icon('trash')}</button>` : ''}`;
    bar.innerHTML = mode === 'smart'
      ? `<div class="lb-btns">
          <button type="button" class="btn sm" data-lb="plain">รูปเดิม</button>
          ${tools}
          <button type="button" class="btn-primary sm" data-lb="share"${smart ? '' : ' disabled'}>${smart ? icon('share') : '<i class="spinner"></i>'}<span>บันทึกหรือแชร์</span></button>
          <button type="button" class="btn sm" data-lb="close">ปิด</button>
        </div>`
      : `<div class="lb-btns">
          <button type="button" class="btn sm" data-lb="smart">${icon('photo')}Smart Photo</button>
          ${tools}
          <button type="button" class="btn sm" data-lb="close">ปิด</button>
        </div>`;
  }

  function renderInfo() {
    const m = metas[i];
    title.textContent = `${st.code} รูปที่ ${i + 1}/${metas.length}`;
    const dir = m.bearing != null
      ? `ทิศที่ถ่าย ${m.bearingSrc === 'auto' ? '≈' : ''}${az3(Math.round(m.bearing) % 360)}° ${cardinal(m.bearing)} (${SRC[m.bearingSrc] || ''})`
      : editable ? 'ยังไม่มีทิศที่ถ่าย แตะ ทิศ เพื่อตั้ง' : '';
    const kept = m.smartAt ? `Smart Photo ${m.smartSavedAt ? 'อยู่ในแอปและบันทึกลงเครื่องแล้ว' : 'เก็บในแอปแล้ว'}` : '';
    brg.textContent = [dir, kept].filter(Boolean).join(' · ');
  }

  async function show(n) {
    if (n < 0 || n >= metas.length) return;
    if (n !== i) stopAim(false);
    i = n;
    if (smart) { URL.revokeObjectURL(smart.url); smart = null; }
    badge.classList.add('hidden');
    const meta = metas[i];
    const data = await store.getPhotoData(meta.id);
    if (!data) { toast('ไม่พบไฟล์รูปนี้'); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([data], { type: meta.type }));
    img.src = url;
    img.alt = `${st.code} รูปที่ ${i + 1}`;
    el.querySelector('.lb-nav.prev').hidden = i === 0;
    el.querySelector('.lb-nav.next').hidden = i === metas.length - 1;
    renderInfo();
    renderBar();
    if (mode === 'smart') loadSmart();
  }

  /** Show the Smart Photo (the kept copy, or drawn now when out of date). */
  async function loadSmart() {
    const token = ++seq;
    const at = i;
    if (smart) { URL.revokeObjectURL(smart.url); smart = null; }
    renderBar();
    try {
      const cur = await store.getStation(st.id) || st; // latest details
      const { file, meta } = await smartFor(cur, metas[at], at, metas.length);
      if (token !== seq || at !== i) return;
      metas[at] = meta;
      smart = { file, url: URL.createObjectURL(file) };
      img.src = smart.url;
      badge.classList.remove('hidden');
      renderInfo();
      renderBar();
    } catch (err) {
      if (token !== seq) return;
      toast(`สร้าง Smart Photo ไม่สำเร็จ: ${err.message}`, 4000);
      mode = 'plain';
      renderBar();
    }
  }

  async function saveBearing(value, src) {
    const meta = metas[i];
    const next = await store.updatePhoto(meta.id, {
      bearing: value == null ? null : Math.round(value * 10) / 10,
      bearingSrc: value == null ? null : src,
    });
    metas[i] = next;
    renderInfo();
  }

  function startAim() {
    if (aiming) return;
    if (attitude.needsPermission()) attitude.requestPermission(); // iPhone: must come from this tap
    const decl = Number(store.getSettings().declination) || 0;
    aimValue = null;
    aiming = attitude.subscribe((a) => {
      const out = el.querySelector('#aimVal');
      const use = el.querySelector('[data-lb=aim-use]');
      if (!out) return;
      if (a.status !== 'ok' || !a.sample) {
        out.textContent = a.status === 'unavailable' ? 'ไม่มีเซนเซอร์' : a.status === 'denied' ? 'ไม่ได้รับสิทธิ์' : '—';
        return;
      }
      if (!a.sample.north) { out.textContent = 'อ่านทิศเหนือไม่ได้'; return; }
      const b = attitude.viewBearing(attitude.sampleRotation(a.sample, decl));
      if (b == null) return;
      aimValue = b;
      out.textContent = `${az3(Math.round(b) % 360)}° ${cardinal(b)}`;
      if (use) use.disabled = false;
    });
    renderBar();
  }

  function stopAim(rerender = true) {
    if (!aiming) return;
    aiming();
    aiming = null;
    aimValue = null;
    if (rerender) renderBar();
  }

  function onKey(e) {
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  }
  document.addEventListener('keydown', onKey);

  // sideways swipe on the photo
  const stage = el.querySelector('.lb-stage');
  let sx = null, sy = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = sy = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(dx < 0 ? i + 1 : i - 1);
  });

  i = -1;
  await show(Math.max(0, metas.findIndex((p) => p.id === startId)));
  return close;
}
