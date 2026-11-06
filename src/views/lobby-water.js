import { createScenario } from '../engine/wind.js';
import { DEFAULT_TRAINER_CONFIG } from '../engine/config.js';
import { RaceWindLayer } from './organic-wind.js';

// A separate field, clock and particle system; this never touches the trainer.
export function createLobbyWater(canvas) {
  let scenario = createScenario({ ...DEFAULT_TRAINER_CONFIG, seed: 81723, courseLength: 1000 });
  const layer = new RaceWindLayer(), motion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, frame = 0, previous = 0, time = 40;
  function draw(elapsed = 0) {
    layer.draw(canvas, scenario, time, '-600 -1100 1200 1200', 'streaks', {
      width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: Math.min(devicePixelRatio || 1, 1.5),
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
    }, elapsed);
  }
  function animate(now) {
    frame = 0;
    if (!active || document.hidden) return;
    // Limit the lobby to 30 fps, with no catch-up after hidden tabs.
    if (now - previous >= 33) {
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
      time += elapsed;
      if (time > 600) { time = 40; scenario = createScenario({ ...DEFAULT_TRAINER_CONFIG, seed: 81723 }); }
      draw(elapsed);
    }
    if (!motion.matches) frame = requestAnimationFrame(animate);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; previous = performance.now();
    if (active && !document.hidden) { draw(); if (!motion.matches) frame = requestAnimationFrame(animate); }
  }
  const resize = new ResizeObserver(sync); resize.observe(canvas);
  document.addEventListener('visibilitychange', sync); motion.addEventListener('change', sync);
  return { setActive(value) { active = value; sync(); }, destroy() {
    active = false; cancelAnimationFrame(frame); resize.disconnect();
    document.removeEventListener('visibilitychange', sync); motion.removeEventListener('change', sync);
  } };
}
