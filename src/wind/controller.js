import { WindField } from './field.js';
import { ParticleSystem } from './particles.js';
import { WindRenderer } from './renderer.js';
import { BoatProbe } from './probe.js';
import { SimulationClock } from './clock.js';
import { clamp, bearing } from './config.js';

const $ = id => document.getElementById(id);
const canvas = $('water'), renderer = new WindRenderer(canvas);
let field, particles, boat, clock, seed = 2941, running = true, previous = null, dragging = false;
let speed = 4, uiTime = 0;
const config = { seed };
const formatBearing = angle => `${String(Math.round(bearing(angle)) % 360).padStart(3, '0')}°`;
function reset() {
  field = new WindField({ ...config, seed });
  // Limit visual workload according to the available CSS surface area.
  const area = canvas.clientWidth * canvas.clientHeight;
  const quality = clamp(area / 380000, 0.55, 1.8);
  particles = new ParticleSystem(field, quality); boat = new BoatProbe(field); clock = new SimulationClock();
  renderer.water.lastTime = NaN; previous = null; running = true;
  $('play').textContent = 'Pause'; $('seed').textContent = seed;
  refresh(); draw();
}
function refresh() {
  const local = boat.sample(clock.time), counts = field.spawns.stats;
  canvas.setAttribute('aria-label', `Wind field. Boat probe ${Math.round(Math.abs(boat.x))} meters ${boat.x < 0 ? 'left' : 'right'} of center, ${Math.round(boat.y)} meters up course. Drag the boat or use arrow keys; Shift moves farther.`);
  $('local-direction').textContent = formatBearing(local.direction);
  $('local-speed').replaceChildren(document.createTextNode(local.speedKnots.toFixed(1) + ' '), Object.assign(document.createElement('small'), { textContent: 'kn' }));
  $('heading').textContent = formatBearing(local.heading); $('tack-label').textContent = local.tack === 'starboard' ? 'STBD' : 'PORT';
  $('region').textContent = local.kind === 'background' ? 'Background wind' : `${local.kind === 'puff' ? 'Strong puff' : 'Light-air pocket'} · ${Math.round(local.influence * 100)}% influence`;
  const seconds = Math.floor(clock.time);
  $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('active').textContent = field.featuresAt(clock.time).length;
  $('puff-stats').textContent = `${counts.puffLeft} / ${counts.puffRight}`;
  $('pocket-stats').textContent = `${counts.pocketLeft} / ${counts.pocketRight}`;
  $('shift-stats').textContent = counts.favoredTotal ? `${counts.favorable} / ${counts.favoredTotal}` : '—';
}
function draw() { renderer.draw(field, particles, boat, clock.time, { boundaries: $('boundaries').checked, vectors: $('vectors').checked }); }
function toggle() { running = !running; $('play').textContent = running ? 'Pause' : 'Resume'; }
$('play').addEventListener('click', toggle);
$('replay').addEventListener('click', reset);
$('shuffle').addEventListener('click', () => { seed = crypto.getRandomValues(new Uint32Array(1))[0]; reset(); });
$('tack').addEventListener('click', () => { boat.toggleTack(); refresh(); draw(); });
for (const id of ['boundaries', 'vectors']) $(id).addEventListener('change', draw);
for (const [id, key, factor, suffix] of [
  ['probability', 'probability', 0.01, '%'], ['frequency', 'frequency', 1, ''], ['size', 'sizeBL', 1, ' BL'],
  ['shift', 'maxShift', 1, '°'], ['wind', 'windKnots', 1, ' kn'], ['contrast', 'contrast', 0.01, '%'],
]) {
  $(id).addEventListener('input', () => { $(id + '-value').textContent = $(id).value + suffix; });
  $(id).addEventListener('change', () => { config[key] = Number($(id).value) * factor; reset(); });
}
for (const [id, key] of [['regime', 'regime'], ['favored-side', 'favoredSide']]) {
  $(id).addEventListener('change', () => { config[key] = $(id).value; reset(); });
}
$('speed').addEventListener('input', () => { speed = Number($('speed').value); $('speed-value').textContent = `${speed}×`; });
function moveProbe(x, y) {
  boat.x = clamp(x, -field.config.width / 2 + 5, field.config.width / 2 - 5);
  boat.y = clamp(y, 5, field.config.height - 5); refresh(); draw();
}
canvas.addEventListener('pointerdown', e => {
  const p = renderer.toWorld(e.clientX, e.clientY);
  if (Math.hypot(p.x - boat.x, p.y - boat.y) * renderer.camera.scale > 32) return;
  dragging = true; canvas.setPointerCapture(e.pointerId); canvas.focus();
});
canvas.addEventListener('pointermove', e => { if (dragging) { const p = renderer.toWorld(e.clientX, e.clientY); moveProbe(p.x, p.y); } });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { dragging = false; });
canvas.addEventListener('keydown', e => {
  const move = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (!move) return;
  e.preventDefault(); const step = e.shiftKey ? 50 : 5; moveProbe(boat.x + move[0] * step, boat.y + move[1] * step);
});
document.addEventListener('visibilitychange', () => { previous = null; });
function animate(stamp) {
  const elapsed = previous === null ? 0 : Math.min(0.1, (stamp - previous) / 1000); previous = stamp;
  if (running) {
    clock.advance(elapsed, speed);
    // Presentation has its own clock; the field's fixed physics clock is above.
    let remaining = elapsed;
    while (remaining > 1e-8) { const dt = Math.min(0.025, remaining); particles.update(dt, clock.time); remaining -= dt; }
    uiTime += elapsed;
    if (uiTime >= 0.1) { refresh(); uiTime = 0; }
  }
  draw(); requestAnimationFrame(animate);
}
new ResizeObserver(() => { renderer.resize(); if (field) draw(); }).observe(canvas);
renderer.resize(); reset(); $('startup-error').hidden = true; requestAnimationFrame(animate);
