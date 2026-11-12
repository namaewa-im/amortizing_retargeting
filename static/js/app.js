'use strict';

const { clips, maxMM } = window.ROLLOUTS;
const METHODS = [
  { id: 'ca', name: 'Contact-Aware (CA)', short: 'CA' },
  { id: 'direct', name: 'Direct FA Prediction (Ablation)', short: 'Direct' },
  { id: 'ours', name: 'CA + Residual (Ours)', short: 'Ours' },
];
const SPLITS = [
  { id: 'S1', name: 'Unseen subjects (S1)' },
  { id: 'S3', name: 'Unseen objects (S3)' },
  { id: 'S1xS3', name: 'Both (S1×S3)' },
];
const PER_PAGE = 15;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = reducedMotion.matches;
let split = SPLITS[0].id;
let onlySuccess = false;

const videoURL = (clip, method) => `static/videos/${clip.split}/${clip.recording}_${method}.webm`;
const objectName = clip => clip.object.replace(/^\d+_/, '').replace(/_/g, ' ');
const success = (clip, method) => clip.err[method] < maxMM;

/* Playback: load when near the viewport, play only while visible. */
const visible = new Set();
function update(video) {
  if (paused || document.hidden || !video.isConnected || !visible.has(video) || document.body.classList.contains('compare-open')) { video.pause(); return; }
  if (!video.getAttribute('src')) video.src = video.dataset.src;
  if (video.paused) video.play().catch(() => {});
}
const seen = new IntersectionObserver(entries => {
  entries.forEach(({ target, isIntersecting }) => (isIntersecting ? visible.add(target) : visible.delete(target)));
  entries.forEach(({ target }) => update(target));
}, { threshold: 0.01 });
const near = new IntersectionObserver(entries => {
  entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting && !target.getAttribute('src')) { target.preload = 'auto'; target.src = target.dataset.src; }
  });
}, { rootMargin: '300px 0px' });
function refresh() { document.querySelectorAll('video[data-src]').forEach(update); syncToggle(); }

function makeVideo(src, observe = true) {
  const video = document.createElement('video');
  video.muted = video.loop = video.playsInline = true;
  video.preload = 'none';
  video.dataset.src = src;
  video.setAttribute('aria-hidden', 'true');
  if (observe) { seen.observe(video); near.observe(video); }
  return video;
}
function release(root) {
  root.querySelectorAll('video').forEach(video => {
    seen.unobserve(video); near.unobserve(video); visible.delete(video);
    video.pause(); video.removeAttribute('src'); video.load();
  });
}

function makeCard(clip, method) {
  const card = document.createElement('article');
  card.className = 'video-card';
  const ok = success(clip, method);
  const open = document.createElement('button');
  open.type = 'button';
  open.setAttribute('aria-label', `Compare methods on ${objectName(clip)}, ${clip.subject}, ${clip.recording}`);
  open.addEventListener('click', () => openCompare(clip, open));
  const label = document.createElement('div');
  label.className = 'card-label';
  label.innerHTML = `<span></span><span class="err ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${clip.err[method].toFixed(0)} mm</span>`;
  label.firstChild.textContent = objectName(clip);
  card.append(makeVideo(videoURL(clip, method)), label, open);
  return card;
}

/* One horizontal gallery per method; all three share the split tabs and the same clip order. */
const galleries = METHODS.map(method => {
  const root = document.querySelector(`[data-method="${method.id}"]`);
  const track = root.querySelector('.video-track');
  const previous = root.querySelector('[data-slide=previous]');
  const next = root.querySelector('[data-slide=next]');
  const page = root.querySelector('.page');
  const rate = root.querySelector('.rate');
  const pages = () => Math.max(1, track.children.length);
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  function arrows() {
    previous.disabled = track.scrollLeft < 2;
    next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    page.textContent = `${current() + 1} / ${pages()}`;
  }
  function slide(direction) {
    track.scrollBy({ left: direction * track.clientWidth, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
  function render() {
    release(track);
    const selected = clips.filter(clip => clip.split === split);
    const shown = onlySuccess ? selected.filter(clip => success(clip, method.id)) : selected;
    track.replaceChildren();
    for (let start = 0; start < shown.length; start += PER_PAGE) {
      const slideEl = document.createElement('div');
      slideEl.className = 'gallery-slide';
      shown.slice(start, start + PER_PAGE).forEach(clip => slideEl.append(makeCard(clip, method.id)));
      track.append(slideEl);
    }
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'gallery-empty';
      empty.textContent = 'No successful rollouts in this split.';
      track.append(empty);
    }
    track.scrollLeft = 0;
    const wins = selected.filter(clip => success(clip, method.id)).length;
    rate.innerHTML = `<b>${wins}</b> / ${selected.length} succeed (${(100 * wins / selected.length).toFixed(1)}%)`;
    requestAnimationFrame(arrows);
  }
  previous.addEventListener('click', () => slide(-1));
  next.addEventListener('click', () => slide(1));
  track.addEventListener('scroll', arrows, { passive: true });
  new ResizeObserver(arrows).observe(track);
  track.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); slide(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  let drag, suppress = false;
  track.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
  });
  track.addEventListener('pointermove', event => {
    if (!drag) return;
    const distance = event.clientX - drag.x;
    if (Math.abs(distance) > 5) {
      drag.moved = true;
      track.classList.add('dragging');
      track.setPointerCapture(drag.id);
      track.scrollLeft = drag.left - distance;
    }
  });
  function endDrag() {
    if (!drag) return;
    suppress = drag.moved;
    if (track.hasPointerCapture(drag.id)) track.releasePointerCapture(drag.id);
    track.classList.remove('dragging');
    if (suppress) track.scrollTo({ left: current() * track.clientWidth, behavior: 'smooth' });
    drag = null;
    setTimeout(() => { suppress = false; }, 0);
  }
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('click', event => { if (suppress) { event.preventDefault(); event.stopPropagation(); } }, true);
  return { render };
});

const tabs = document.querySelector('.split-tabs');
const filter = document.querySelector('#only-success');
filter.addEventListener('click', () => {
  onlySuccess = !onlySuccess;
  filter.setAttribute('aria-pressed', String(onlySuccess));
  galleries.forEach(gallery => gallery.render());
  refresh();
});
SPLITS.forEach((item, index) => {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.dataset.split = item.id;
  const count = clips.filter(clip => clip.split === item.id).length;
  tab.innerHTML = `${item.name}<small>${count}</small>`;
  tab.addEventListener('click', () => select(item.id));
  tab.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const target = SPLITS[(index + step + SPLITS.length) % SPLITS.length];
    select(target.id);
    tabs.querySelector(`[data-split="${target.id}"]`).focus();
  });
  tabs.append(tab);
});
function select(id) {
  split = id;
  tabs.querySelectorAll('button').forEach(tab => {
    const active = tab.dataset.split === id;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  galleries.forEach(gallery => gallery.render());
  refresh();
}

/* Comparison viewer: the same demonstration under all three methods, played in sync. */
const compare = document.querySelector('.compare');
const compareGrid = compare.querySelector('.compare-grid');
let opener;
function openCompare(clip, from) {
  opener = from;
  compare.querySelector('h3').textContent = objectName(clip);
  compare.querySelector('.compare-head p').textContent =
    `${SPLITS.find(s => s.id === clip.split).name} · ${clip.subject} · ${clip.recording}`;
  release(compareGrid);
  compareGrid.replaceChildren(...METHODS.map(method => {
    const ok = success(clip, method.id);
    const figure = document.createElement('figure');
    const card = document.createElement('div');
    card.className = 'video-card';
    const video = makeVideo(videoURL(clip, method.id), false);
    video.preload = 'auto';
    video.src = video.dataset.src;
    delete video.dataset.src;   // driven by the viewer, not the gallery observers
    card.append(video);
    const caption = document.createElement('figcaption');
    caption.innerHTML = `<b>${method.short}</b><span class="${ok ? 'ok' : 'bad'}">${ok ? 'Success' : 'Failure'} · ${clip.err[method.id].toFixed(1)} mm</span>`;
    figure.append(card, caption);
    return figure;
  }));
  const videos = [...compareGrid.querySelectorAll('video')];
  Promise.all(videos.map(v => new Promise(resolve => {
    if (v.readyState >= 3) resolve(); else v.addEventListener('canplay', resolve, { once: true });
  }))).then(() => {
    if (compare.hidden) return;
    videos.forEach(v => { v.currentTime = 0; if (!paused) v.play().catch(() => {}); });
  });
  // Keep the three clips aligned: when the first one loops, restart the others with it.
  let last = 0;
  videos[0].addEventListener('timeupdate', () => {
    const t = videos[0].currentTime;
    if (t < last) videos.slice(1).forEach(v => { v.currentTime = t; });
    last = t;
  });
  compare.hidden = false;
  document.body.classList.add('compare-open');
  document.querySelectorAll('.video-track video').forEach(v => v.pause());
  compare.querySelector('.compare-close').focus();
}
function closeCompare() {
  if (compare.hidden) return;
  release(compareGrid);
  compareGrid.replaceChildren();
  compare.hidden = true;
  document.body.classList.remove('compare-open');
  refresh();
  opener?.focus({ preventScroll: true });
}
compare.querySelector('.compare-close').addEventListener('click', closeCompare);
compare.addEventListener('click', event => { if (event.target === compare) closeCompare(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCompare(); });

/* Global play / pause */
const toggle = document.querySelector('#motion-toggle');
function syncToggle() {
  toggle.innerHTML = paused
    ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z"/></svg>'
    : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4v12M13 4v12"/></svg>';
  toggle.setAttribute('aria-label', paused ? 'Play videos' : 'Pause videos');
  toggle.setAttribute('aria-pressed', String(paused));
}
toggle.addEventListener('click', () => {
  paused = !paused;
  refresh();
  compareGrid.querySelectorAll('video').forEach(v => (paused ? v.pause() : v.play().catch(() => {})));
});
document.addEventListener('visibilitychange', refresh);

select(split);
