// Ambient FX layer for 灿灿校园电台.
// Pure decoration: reads audio intensity from the read-only bridge exposed by app.js
// (globalThis.__radioFx) and never touches playback / chat logic.

const doc = document;
const root = doc.documentElement;
const body = doc.body;
const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const coarseQuery = globalThis.matchMedia?.('(pointer: coarse)');

const PALETTE = [
  { rgb: [34, 230, 255], weight: 0.44 }, // cyan
  { rgb: [139, 92, 255], weight: 0.3 }, // violet
  { rgb: [255, 79, 216], weight: 0.2 }, // pink
  { rgb: [255, 214, 90], weight: 0.06 } // gold
];

const reduceMotion = () => Boolean(motionQuery?.matches);
const lowDistraction = () => body.classList.contains('low-distraction-mode');
const isCompact = () => globalThis.innerWidth <= 760 || Boolean(coarseQuery?.matches);
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function pickColor() {
  let roll = Math.random();
  for (const entry of PALETTE) {
    roll -= entry.weight;
    if (roll <= 0) return entry.rgb;
  }
  return PALETTE[0].rgb;
}

/* ------------------------------------------------------------------ */
/* Audio bridge                                                        */
/* ------------------------------------------------------------------ */

const audio = { level: 0, low: 0, mid: 0, high: 0, beat: 0, mode: 'off', live: false };

function sampleAudio() {
  const bridge = globalThis.__radioFx;
  const mode = bridge?.mode || 'off';
  const raw = bridge?.intensity || {};
  const active = mode === 'song' || mode === 'host';
  const target = active
    ? { level: raw.overall || 0, low: raw.low || 0, mid: raw.mid || 0, high: raw.high || 0, beat: raw.beat || 0 }
    : { level: 0.04, low: 0.03, mid: 0.02, high: 0.02, beat: 0 };
  const ease = 0.18;
  audio.level += (target.level - audio.level) * ease;
  audio.low += (target.low - audio.low) * ease;
  audio.mid += (target.mid - audio.mid) * ease;
  audio.high += (target.high - audio.high) * ease;
  audio.beat = Math.max(target.beat, audio.beat * 0.86);
  audio.mode = mode;
  audio.live = active;
}

/* ------------------------------------------------------------------ */
/* Background particle constellation                                   */
/* ------------------------------------------------------------------ */

const bg = {
  canvas: doc.querySelector('#fx-canvas'),
  ctx: null,
  w: 0,
  h: 0,
  dpr: 1,
  particles: [],
  sparks: [],
  rings: [],
  meteors: [],
  sprites: new Map(),
  pointer: { x: -9999, y: -9999, active: false, px: 0, py: 0 },
  focus: { x: 0, y: 0, valid: false, measuredAt: 0 },
  lastBeatAt: 0,
  nextMeteorAt: performance.now() + 4000
};

function glowSprite(rgb) {
  const key = rgb.join(',');
  if (bg.sprites.has(key)) return bg.sprites.get(key);
  const size = 48;
  const sprite = doc.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const g = sprite.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${key}, 0.9)`);
  grad.addColorStop(0.25, `rgba(${key}, 0.35)`);
  grad.addColorStop(1, `rgba(${key}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  bg.sprites.set(key, sprite);
  return sprite;
}

function particleBudget() {
  const area = bg.w * bg.h;
  const base = isCompact() ? 42 : 96;
  const scaled = Math.round(base * clamp(area / (1440 * 900), 0.55, 1.35));
  return reduceMotion() ? Math.round(scaled * 0.5) : scaled;
}

function makeParticle(anywhere = true) {
  const z = rand(0.25, 1);
  return {
    x: anywhere ? rand(0, bg.w) : rand(-20, bg.w + 20),
    y: anywhere ? rand(0, bg.h) : bg.h + 10,
    vx: rand(-0.12, 0.12),
    vy: rand(-0.22, -0.04),
    bx: 0,
    by: 0,
    z,
    size: z > 0.8 ? 2 : 1,
    tw: rand(0, Math.PI * 2),
    rgb: pickColor()
  };
}

function resizeBackground() {
  if (!bg.canvas) return;
  bg.dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
  bg.w = globalThis.innerWidth;
  bg.h = globalThis.innerHeight;
  bg.canvas.width = Math.round(bg.w * bg.dpr);
  bg.canvas.height = Math.round(bg.h * bg.dpr);
  bg.ctx = bg.canvas.getContext('2d');
  const budget = particleBudget();
  while (bg.particles.length < budget) bg.particles.push(makeParticle());
  bg.particles.length = budget;
  for (const p of bg.particles) {
    p.x = clamp(p.x, 0, bg.w);
    p.y = clamp(p.y, 0, bg.h);
  }
  if (reduceMotion()) drawBackground(0, performance.now());
}

function measureFocus(now) {
  if (now - bg.focus.measuredAt < 400) return bg.focus;
  bg.focus.measuredAt = now;
  const stage = doc.querySelector('.avatar-stage');
  const rect = stage?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.bottom > 0 && rect.top < bg.h) {
    bg.focus.x = rect.left + rect.width / 2;
    bg.focus.y = rect.top + rect.height / 2;
    bg.focus.valid = true;
  } else {
    bg.focus.x = bg.w * 0.5;
    bg.focus.y = bg.h * 0.42;
    bg.focus.valid = false;
  }
  return bg.focus;
}

function emitRing(x, y, strength = 1, rgb = [34, 230, 255]) {
  if (bg.rings.length > 6) bg.rings.shift();
  bg.rings.push({ x, y, r: 12, max: 180 + strength * 260, life: 1, rgb, dash: Math.random() > 0.5 });
}

function emitSparks(x, y, count = 16, power = 1) {
  if (reduceMotion()) return;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + rand(-0.2, 0.2);
    const speed = rand(1.4, 4.2) * power;
    bg.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.6,
      life: 1,
      decay: rand(0.018, 0.034),
      size: Math.random() > 0.7 ? 3 : 2,
      rgb: pickColor()
    });
  }
  if (bg.sparks.length > 220) bg.sparks.splice(0, bg.sparks.length - 220);
}

function spawnMeteor() {
  const fromLeft = Math.random() > 0.5;
  bg.meteors.push({
    x: fromLeft ? rand(-100, bg.w * 0.4) : rand(bg.w * 0.6, bg.w + 100),
    y: rand(-60, bg.h * 0.25),
    vx: (fromLeft ? 1 : -1) * rand(9, 13),
    vy: rand(3.2, 5.2),
    life: 1,
    rgb: pickColor()
  });
}

function updateBackground(dt, now) {
  const focus = measureFocus(now);
  const speed = 0.55 + audio.level * 2.4 + audio.beat * 1.6;
  const host = audio.mode === 'host';
  const pointer = bg.pointer;

  // Beat → shockwave from the DJ avatar.
  if (audio.live && audio.beat > 0.34 && now - bg.lastBeatAt > 420) {
    bg.lastBeatAt = now;
    emitRing(focus.x, focus.y, audio.beat, host ? [255, 79, 216] : [34, 230, 255]);
    for (const p of bg.particles) {
      const dx = p.x - focus.x;
      const dy = p.y - focus.y;
      const d = Math.hypot(dx, dy) || 1;
      const push = (audio.beat * 3.2 * p.z) / Math.max(1, d / 240);
      p.bx += (dx / d) * push;
      p.by += (dy / d) * push;
    }
  }

  for (const p of bg.particles) {
    p.tw += 0.03 * dt;
    let vx = p.vx * speed;
    let vy = p.vy * speed;

    if (host) {
      // Voice → particles orbit the DJ.
      const dx = p.x - focus.x;
      const dy = p.y - focus.y;
      const d = Math.hypot(dx, dy) || 1;
      vx += (-dy / d) * 0.7 * p.z - (dx / d) * 0.12;
      vy += (dx / d) * 0.7 * p.z - (dy / d) * 0.12;
    }

    if (pointer.active) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 150 * 150) {
        const d = Math.sqrt(d2) || 1;
        const force = (1 - d / 150) * 1.6;
        p.bx += (dx / d) * force * 0.35;
        p.by += (dy / d) * force * 0.35;
      }
    }

    p.x += (vx + p.bx) * dt * 0.06;
    p.y += (vy + p.by) * dt * 0.06;
    p.bx *= 0.93;
    p.by *= 0.93;

    if (p.y < -20) { p.y = bg.h + 10; p.x = rand(0, bg.w); }
    if (p.y > bg.h + 30) p.y = -10;
    if (p.x < -30) p.x = bg.w + 20;
    if (p.x > bg.w + 30) p.x = -20;
  }

  for (const s of bg.sparks) {
    s.x += s.vx * dt * 0.06;
    s.y += s.vy * dt * 0.06;
    s.vy += 0.05 * dt * 0.06;
    s.vx *= 0.985;
    s.life -= s.decay * dt * 0.06;
  }
  bg.sparks = bg.sparks.filter((s) => s.life > 0);

  for (const ring of bg.rings) {
    ring.r += (ring.max - ring.r) * 0.045 * dt * 0.06 + 1.2;
    ring.life -= 0.016 * dt * 0.06;
  }
  bg.rings = bg.rings.filter((ring) => ring.life > 0);

  if (now > bg.nextMeteorAt) {
    bg.nextMeteorAt = now + rand(5200, 11000) / (audio.live ? 1.6 : 1);
    if (!isCompact() || Math.random() > 0.5) spawnMeteor();
  }
  for (const m of bg.meteors) {
    m.x += m.vx * dt * 0.06;
    m.y += m.vy * dt * 0.06;
    m.life -= 0.012 * dt * 0.06;
  }
  bg.meteors = bg.meteors.filter((m) => m.life > 0 && m.y < bg.h + 80);
}

function drawBackground(dt, now) {
  const { ctx, w, h, dpr } = bg;
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pointer = bg.pointer;
  const parallaxX = pointer.active ? (pointer.x / w - 0.5) : 0;
  const parallaxY = pointer.active ? (pointer.y / h - 0.5) : 0;
  pointer.px += (parallaxX - pointer.px) * 0.05;
  pointer.py += (parallaxY - pointer.py) * 0.05;

  const particles = bg.particles;
  const linkDist = isCompact() ? 90 : 128;
  const linkDist2 = linkDist * linkDist;
  const lineBoost = 0.55 + audio.level * 1.6 + audio.beat * 0.8;

  // Constellation links.
  ctx.lineWidth = 1;
  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    const ax = a.x - pointer.px * 18 * a.z;
    const ay = a.y - pointer.py * 18 * a.z;
    for (let j = i + 1; j < particles.length; j += 1) {
      const b = particles[j];
      const bx = b.x - pointer.px * 18 * b.z;
      const by = b.y - pointer.py * 18 * b.z;
      const dx = ax - bx;
      const dy = ay - by;
      const d2 = dx * dx + dy * dy;
      if (d2 > linkDist2) continue;
      const alpha = (1 - d2 / linkDist2) * 0.16 * lineBoost * Math.min(a.z, b.z);
      if (alpha < 0.012) continue;
      ctx.strokeStyle = `rgba(${a.rgb[0]}, ${a.rgb[1]}, ${a.rgb[2]}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    if (pointer.active) {
      const dx = ax - pointer.x;
      const dy = ay - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 170 * 170) {
        const alpha = (1 - d2 / (170 * 170)) * 0.42;
        ctx.strokeStyle = `rgba(${a.rgb[0]}, ${a.rgb[1]}, ${a.rgb[2]}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.stroke();
      }
    }
  }

  // Particles: soft glow + crisp pixel core.
  for (const p of particles) {
    const x = p.x - pointer.px * 18 * p.z;
    const y = p.y - pointer.py * 18 * p.z;
    const twinkle = 0.55 + Math.sin(p.tw) * 0.25;
    const glow = (6 + p.z * 10) * (1 + audio.low * 1.4 + audio.beat * 0.8);
    ctx.globalAlpha = clamp((0.25 + p.z * 0.45) * twinkle * (0.8 + audio.level), 0, 0.95);
    ctx.drawImage(glowSprite(p.rgb), x - glow / 2, y - glow / 2, glow, glow);
    ctx.globalAlpha = clamp(0.5 + p.z * 0.5 * twinkle, 0, 1);
    ctx.fillStyle = `rgb(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]})`;
    const s = p.size + (audio.beat > 0.4 && p.z > 0.7 ? 1 : 0);
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }
  ctx.globalAlpha = 1;

  // Meteors.
  for (const m of bg.meteors) {
    const tail = 16;
    const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * m.life})`);
    grad.addColorStop(0.2, `rgba(${m.rgb.join(',')}, ${0.6 * m.life})`);
    grad.addColorStop(1, `rgba(${m.rgb.join(',')}, 0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
    ctx.stroke();
  }

  // Beat shockwaves.
  for (const ring of bg.rings) {
    ctx.strokeStyle = `rgba(${ring.rgb.join(',')}, ${(ring.life * 0.42).toFixed(3)})`;
    ctx.lineWidth = 1 + ring.life * 2;
    ctx.setLineDash(ring.dash ? [3, 7] : []);
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Click sparks.
  for (const s of bg.sparks) {
    ctx.globalAlpha = clamp(s.life, 0, 1);
    ctx.fillStyle = `rgb(${s.rgb.join(',')})`;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* Circular spectrum around the DJ avatar                              */
/* ------------------------------------------------------------------ */

const ring = { canvas: null, ctx: null, size: 0, dpr: 1, bars: new Float32Array(48), checkedAt: 0 };

function ensureRingCanvas(now) {
  if (ring.canvas && ring.canvas.isConnected && now - ring.checkedAt < 600) return ring.canvas;
  ring.checkedAt = now;
  const canvas = doc.querySelector('.avatar-spectrum');
  if (!canvas) {
    ring.canvas = null;
    return null;
  }
  const size = Math.round(canvas.offsetWidth);
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (canvas !== ring.canvas || size !== ring.size || dpr !== ring.dpr) {
    ring.canvas = canvas;
    ring.size = size;
    ring.dpr = dpr;
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = Math.max(1, Math.round(size * dpr));
    ring.ctx = canvas.getContext('2d');
  }
  return canvas;
}

function drawSpectrum(now) {
  const canvas = ensureRingCanvas(now);
  if (!canvas || !ring.ctx || ring.size < 20) return;
  const ctx = ring.ctx;
  const size = ring.size;
  ctx.setTransform(ring.dpr, 0, 0, ring.dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const spectrum = audio.live ? globalThis.__radioFx?.getSpectrum?.() : null;
  const count = ring.bars.length;
  const t = now / 1000;
  for (let i = 0; i < count; i += 1) {
    let target;
    if (spectrum && spectrum.length) {
      const bin = Math.floor((i / count) * Math.min(spectrum.length, 40));
      target = (spectrum[bin] || 0) / 255;
      target = Math.pow(target, 1.35) * (1 + i / count * 0.8);
    } else {
      const wave = Math.sin(t * 1.6 + i * 0.45) * 0.5 + Math.sin(t * 0.7 + i * 0.21) * 0.5;
      target = (audio.live ? 0.18 + audio.level * 0.9 : 0.08) * (0.55 + wave * 0.45);
    }
    ring.bars[i] += (clamp(target, 0, 1) - ring.bars[i]) * (target > ring.bars[i] ? 0.45 : 0.12);
  }

  const cx = size / 2;
  const cy = size / 2;
  const inner = size * 0.39;
  const maxLen = size * 0.105;
  const total = count * 2;
  const rotation = reduceMotion() ? 0 : t * 0.08;
  ctx.lineCap = 'butt';
  for (let k = 0; k < total; k += 1) {
    const i = k < count ? k : total - 1 - k; // mirrored for symmetry
    const v = ring.bars[i];
    const angle = (k / total) * Math.PI * 2 - Math.PI / 2 + rotation;
    const len = 2 + v * maxLen;
    const hue = 188 + (i / count) * 128; // cyan → violet → pink
    ctx.strokeStyle = `hsla(${hue}, 100%, ${62 + v * 18}%, ${0.35 + v * 0.65})`;
    ctx.lineWidth = Math.max(1.5, (Math.PI * 2 * inner) / total * 0.52);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (inner + len), cy + sin * (inner + len));
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Reactive CSS variables + live state                                 */
/* ------------------------------------------------------------------ */

let lastCssWrite = 0;
let lastLive = null;
function writeReactiveVars(now) {
  if (now - lastCssWrite < 48) return;
  lastCssWrite = now;
  const shell = doc.querySelector('.player-shell');
  const target = shell || root;
  target.style.setProperty('--fx-level', audio.level.toFixed(3));
  target.style.setProperty('--fx-low', audio.low.toFixed(3));
  target.style.setProperty('--fx-beat', audio.beat.toFixed(3));
  if (lastLive !== audio.live) {
    lastLive = audio.live;
    body.classList.toggle('fx-live', audio.live);
    const label = doc.querySelector('.topbar-signal-label');
    if (label) label.textContent = audio.live ? label.dataset.live : label.dataset.idle;
  }
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

let rafId = 0;
let lastFrame = performance.now();

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const elapsed = now - lastFrame;
  if (elapsed < 15) return;
  const dt = Math.min(48, elapsed);
  lastFrame = now;
  sampleAudio();
  writeReactiveVars(now);
  if (lowDistraction()) {
    if (bg.ctx) bg.ctx.clearRect(0, 0, bg.canvas.width, bg.canvas.height);
    return;
  }
  updateBackground(dt, now);
  drawBackground(dt, now);
  drawSpectrum(now);
}

function startLoop() {
  if (rafId || reduceMotion()) return;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ------------------------------------------------------------------ */
/* Pointer interactions                                                */
/* ------------------------------------------------------------------ */

const SPOTLIGHT_SELECTOR = [
  '.now-panel', '.chat-panel', '.lyric-shell', '.page-panel', '.list-item', '.stat',
  '.mixer-control', '.mixer-status-card', '.diary-detail', '.diary-header',
  '.radio-mode-btn', '.playlist-queue-item'
].join(',');

let spotlightEl = null;
function onPointerMove(event) {
  bg.pointer.x = event.clientX;
  bg.pointer.y = event.clientY;
  bg.pointer.active = event.pointerType !== 'touch';

  const target = event.target instanceof Element ? event.target.closest(SPOTLIGHT_SELECTOR) : null;
  if (spotlightEl && spotlightEl !== target) spotlightEl.classList.remove('fx-lit');
  spotlightEl = target;
  if (target) {
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
    target.style.setProperty('--my', `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`);
    target.classList.add('fx-lit');
  }

  if (reduceMotion()) return;
  const stage = event.target instanceof Element ? event.target.closest('.avatar-stage') : null;
  const activeStage = doc.querySelector('.avatar-stage');
  if (activeStage) {
    if (stage) {
      const rect = stage.getBoundingClientRect();
      const rx = ((event.clientY - rect.top) / rect.height - 0.5) * -12;
      const ry = ((event.clientX - rect.left) / rect.width - 0.5) * 14;
      activeStage.style.setProperty('--tilt-x', `${rx.toFixed(2)}deg`);
      activeStage.style.setProperty('--tilt-y', `${ry.toFixed(2)}deg`);
    } else {
      activeStage.style.setProperty('--tilt-x', '0deg');
      activeStage.style.setProperty('--tilt-y', '0deg');
    }
  }

  const magnet = event.target instanceof Element ? event.target.closest('.transport-main-btn') : null;
  const mainBtn = doc.querySelector('.transport-main-btn');
  if (mainBtn) {
    if (magnet) {
      const rect = magnet.getBoundingClientRect();
      const mx = (event.clientX - (rect.left + rect.width / 2)) * 0.22;
      const my = (event.clientY - (rect.top + rect.height / 2)) * 0.22;
      mainBtn.style.translate = `${mx.toFixed(1)}px ${my.toFixed(1)}px`;
    } else if (mainBtn.style.translate) {
      mainBtn.style.translate = '';
    }
  }
}

function onPointerLeave() {
  bg.pointer.active = false;
  spotlightEl?.classList.remove('fx-lit');
  spotlightEl = null;
}

function onPointerDown(event) {
  const target = event.target instanceof Element ? event.target.closest('button, a[data-link], .track-card, .scene-prompt-chip') : null;
  if (!target || lowDistraction()) return;
  const strong = target.matches('.transport-main-btn, .radio-mode-btn, #like-btn');
  emitSparks(event.clientX, event.clientY, strong ? 22 : 12, strong ? 1.25 : 0.8);
  if (strong && !reduceMotion()) emitRing(event.clientX, event.clientY, 0.25, target.matches('#like-btn') ? [255, 79, 216] : [34, 230, 255]);
}

/* ------------------------------------------------------------------ */
/* Navigation indicator + route entrance                               */
/* ------------------------------------------------------------------ */

const nav = doc.querySelector('.nav');
const indicator = doc.createElement('span');
indicator.className = 'nav-indicator';
indicator.setAttribute('aria-hidden', 'true');
nav?.prepend(indicator);

function syncIndicator() {
  const active = nav?.querySelector('a.active');
  if (!active) {
    indicator.style.opacity = '0';
    return;
  }
  indicator.style.opacity = '1';
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.height = `${active.offsetHeight}px`;
  indicator.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
  if (typeof active.scrollIntoView === 'function' && nav.scrollWidth > nav.clientWidth) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

const view = doc.querySelector('#view');
let lastRoute = null;
let enterTimer = null;
function onViewMutated() {
  const route = location.pathname;
  if (route === lastRoute) return;
  lastRoute = route;
  bg.focus.measuredAt = 0;
  ring.checkedAt = 0;
  syncIndicator();
  observeTitle();
  if (reduceMotion() || !view) return;
  view.classList.remove('fx-enter');
  void view.offsetWidth;
  view.classList.add('fx-enter');
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => view.classList.remove('fx-enter'), 1400);
}

/* Track title → glitch reveal whenever the song changes. */
let titleObserver = null;
let observedTitle = null;
function observeTitle() {
  const title = doc.querySelector('#track-title');
  if (title === observedTitle) return;
  titleObserver?.disconnect();
  observedTitle = title;
  if (!title) return;
  let previous = title.textContent;
  titleObserver = new MutationObserver(() => {
    if (title.textContent === previous) return;
    previous = title.textContent;
    title.setAttribute('data-text', previous);
    if (reduceMotion()) return;
    title.classList.remove('fx-title-swap');
    void title.offsetWidth;
    title.classList.add('fx-title-swap');
  });
  title.setAttribute('data-text', previous);
  titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
}

/* ------------------------------------------------------------------ */
/* Boot intro                                                          */
/* ------------------------------------------------------------------ */

function playIntro() {
  let seen = false;
  try { seen = sessionStorage.getItem('fx-intro-seen') === '1'; } catch {}
  if (seen || reduceMotion()) {
    body.classList.add('fx-ready');
    return;
  }
  try { sessionStorage.setItem('fx-intro-seen', '1'); } catch {}
  const intro = doc.createElement('div');
  intro.className = 'fx-intro';
  intro.setAttribute('aria-hidden', 'true');
  intro.innerHTML = `
    <div class="fx-intro-core">
      <div class="fx-intro-freq"><span>88</span><span>92</span><span>96</span><span>100</span><span>104</span><span>108</span><i class="fx-intro-needle"></i></div>
      <div class="fx-intro-title" data-text="灿灿校园电台">灿灿校园电台</div>
      <div class="fx-intro-sub">TUNING IN · AI DJ CYBER FM</div>
      <div class="fx-intro-bar"><span></span></div>
    </div>`;
  body.append(intro);
  const finish = () => {
    if (intro.classList.contains('is-leaving')) return;
    intro.classList.add('is-leaving');
    body.classList.add('fx-ready');
    const x = globalThis.innerWidth / 2;
    const y = globalThis.innerHeight / 2;
    emitRing(x, y, 1.4, [34, 230, 255]);
    setTimeout(() => emitRing(x, y, 1.1, [255, 79, 216]), 140);
    emitSparks(x, y, 36, 1.8);
    setTimeout(() => intro.remove(), 700);
  };
  intro.addEventListener('pointerdown', finish, { once: true });
  setTimeout(finish, 1650);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  resizeBackground();
  playIntro();
  syncIndicator();
  onViewMutated();

  globalThis.addEventListener('resize', () => {
    resizeBackground();
    syncIndicator();
    bg.focus.measuredAt = 0;
    ring.checkedAt = 0;
  }, { passive: true });
  globalThis.addEventListener('pointermove', onPointerMove, { passive: true });
  globalThis.addEventListener('pointerdown', onPointerDown, { passive: true });
  doc.addEventListener('pointerleave', onPointerLeave);
  globalThis.addEventListener('blur', onPointerLeave);

  if (view) new MutationObserver(onViewMutated).observe(view, { childList: true });
  if (nav) {
    new MutationObserver(syncIndicator).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  doc.fonts?.ready?.then(syncIndicator).catch(() => {});

  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) stopLoop();
    else startLoop();
  });
  motionQuery?.addEventListener?.('change', () => {
    resizeBackground();
    if (reduceMotion()) stopLoop();
    else startLoop();
  });
  startLoop();
}

init();
