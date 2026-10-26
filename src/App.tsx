import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, STEP, validateConfig } from './engine/config';
import { normalize } from './engine/geometry';
import { advance, applyAction, canBearAway, compassHeading, initialBoat } from './engine/physics';
import { formatTime } from './engine/scoring';
import { createScenario, windAt } from './engine/wind';
import type { Action, Boat, Command, Config } from './engine/types';
import type { Benchmark } from './engine/optimizer';
import { Course } from './components/Course';
import { WindHistory } from './components/WindHistory';
import { Results } from './components/Results';

type Phase = 'ready' | 'sailing' | 'paused' | 'finished';

export default function App() {
  const [scenario, setScenario] = useState(() => createScenario(DEFAULT_CONFIG));
  const [draft, setDraft] = useState<Config>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>('ready');
  const [boat, setBoat] = useState(initialBoat);
  const [track, setTrack] = useState<Boat[]>([initialBoat()]);
  const [follow, setFollow] = useState(false);
  const [showWind, setShowWind] = useState(true);
  const [speed, setSpeed] = useState(4);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boatRef = useRef(boat);
  const trackRef = useRef(track);
  const commands = useRef<Command[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const accumulator = useRef(0);

  const reset = useCallback((config: Config) => {
    try { validateConfig(config); } catch (e) { setError((e as Error).message); return; }
    workerRef.current?.terminate();
    workerRef.current = null;
    const next = initialBoat();
    boatRef.current = next; trackRef.current = [next]; commands.current = []; accumulator.current = 0;
    setScenario(createScenario(config)); setDraft(config); setBoat(next); setTrack([next]);
    setBenchmark(null); setError(null); setPhase('ready');
  }, []);

  useEffect(() => {
    if (phase !== 'sailing') return;
    let previous = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      // Hidden tabs pause simulated time instead of accumulating a catch-up burst.
      const elapsed = document.hidden ? 0 : Math.min((now - previous) / 1000, 0.2);
      previous = now;
      accumulator.current += elapsed * speed;
      let current = boatRef.current;
      while (accumulator.current >= STEP && !current.finished) {
        current = advance(current, scenario);
        accumulator.current -= STEP;
        const last = trackRef.current[trackRef.current.length - 1];
        if (current.time - last.time >= 1 || current.finished) trackRef.current.push(current);
      }
      boatRef.current = current;
      setBoat(current); setTrack([...trackRef.current]);
      if (current.finished) {
        setPhase('finished');
        const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        worker.onmessage = event => { if (event.data.error) setError(event.data.error); else setBenchmark(event.data.result); worker.terminate(); workerRef.current = null; };
        worker.onerror = event => { setError(event.message || 'Worker failed'); worker.terminate(); workerRef.current = null; };
        worker.postMessage({ scenario, commands: commands.current, time: current.time });
      } else frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [phase, scenario, speed]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const act = useCallback((action: Action) => {
    if (phase !== 'sailing' && phase !== 'paused') return;
    const current = boatRef.current;
    const next = applyAction(current, action, scenario);
    if (current === next) return;
    commands.current.push({ time: current.time, action });
    boatRef.current = next; setBoat(next);
  }, [phase, scenario]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, button, summary, textarea')) return;
      if (event.code === 'Space') { event.preventDefault(); if (phase !== 'finished') setPhase(phase === 'sailing' ? 'paused' : 'sailing'); }
      if (event.key.toLowerCase() === 't' && !event.repeat) act('tack');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, act]);

  const wind = windAt(scenario, boat.time);
  const active = phase === 'sailing' || phase === 'paused';
  const stopped = boat.penaltyRemaining > 1e-8;
  const setOption = <K extends keyof Config>(key: K, value: Config[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (phase === 'ready') reset(next);
  };
  const newWind = () => reset({ ...draft, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
  const numberField = (key: keyof Config, label: string, min: number, max: number, step = 1) => <label>{label}<input type="number" value={draft[key] as number} min={min} max={max} step={step} onChange={event => setDraft({ ...draft, [key]: event.target.valueAsNumber })} /></label>;

  return <div className="app-shell">
    <header className="site-header"><a href="./" className="brand" aria-label="Upwind home"><svg viewBox="0 0 30 32" aria-hidden="true"><path d="M15 1L3 26h12z" fill="currentColor" /><path d="M18 9v17h9zM3 29h24" fill="none" stroke="currentColor" strokeWidth="2" /></svg><span>UPWIND<span className="brand-sub">DECISION TRAINER</span></span></a><span className="header-note">READ THE WIND. SAIL THE SHIFT.</span><span className="version">TRAINING / 01</span></header>
    <main>
      <div className="intro-row"><div><div className="eyebrow">THE UPWIND LEG</div><h1>Every tack is a decision.</h1><p>Read the shifts. Find your way to the windward mark.</p></div><div className="scenario-selects">
        <label>Wind mode<select value={draft.windMode} disabled={active} onChange={e => setOption('windMode', e.target.value as Config['windMode'])}><option value="oscillating">Oscillating</option><option value="persistent">Persistent shift</option><option value="steady">Steady · practice</option></select></label>
        <label>Difficulty<select value={draft.difficulty} disabled={active} onChange={e => setOption('difficulty', e.target.value as Config['difficulty'])}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
      </div></div>
      <div className="race-layout">
        <section className="course-panel" aria-label="Interactive racecourse">
          <div className="course-toolbar"><div className="live-status"><span className={`status-dot ${phase === 'sailing' ? 'live' : ''}`} />{phase === 'ready' ? 'READY TO SAIL' : phase === 'finished' ? 'LEG COMPLETE' : phase.toUpperCase()}</div><div className="view-switch" aria-label="Camera view"><button aria-pressed={!follow} onClick={() => setFollow(false)}>Full course</button><button aria-pressed={follow} onClick={() => setFollow(true)}>Follow boat</button></div></div>
          <Course scenario={scenario} boat={boat} track={track} benchmark={benchmark} follow={follow} />
          <div className="course-footer"><span><span className="legend-line blue" />Your route</span>{benchmark?.route && <span><span className="legend-line gold" />Hindsight reference</span>}<span className="scale-note">Equal scale · meters</span></div>
        </section>
        <aside className="instrument-panel" aria-label="Sailing instruments and controls">
          <div className="compass"><div className="instrument-label">COMPASS HEADING</div><div className="heading">{(Math.round(compassHeading(boat, scenario)) % 360).toString().padStart(3, '0')}<span>°</span></div><div className={`tack-label ${boat.tack}`}>{boat.tack.toUpperCase()} TACK</div></div>
          <div className="wind-instrument"><div><span className="instrument-label">TRUE WIND</span><strong>{(Math.round(normalize(scenario.config.baseline + wind)) % 360).toString().padStart(3, '0')}°</strong></div><div><span className="instrument-label">SHIFT</span><strong>{wind >= 0 ? '+' : ''}{wind.toFixed(1)}°</strong></div></div>
          <div className="race-stats"><div><span>Elapsed</span><strong>{formatTime(boat.time)}</strong></div><div><span>Distance</span><strong>{boat.distance.toFixed(0)} <small>m</small></strong></div><div><span>Tacks</span><strong>{boat.tacks}</strong></div><div><span>Boat speed</span><strong>{stopped ? '0.0' : scenario.config.speedKnots.toFixed(1)} <small>kn</small></strong></div></div>
          <div className="sailing-controls"><button className="tack-button" disabled={!active || stopped} onClick={() => act('tack')}>{stopped ? `Tacking · ${boat.penaltyRemaining.toFixed(1)} s` : 'Tack'}<span>↗ ↖</span></button>
            <button className="bear-button" disabled={!active || stopped || (boat.mode === 'close' && !canBearAway(boat, scenario))} onClick={() => act(boat.mode === 'gate' ? 'close' : 'bear')}>{boat.mode === 'gate' ? 'Return close-hauled' : 'Bear away to gate'}</button>
            <button className="start-button" disabled={phase === 'finished'} onClick={() => setPhase(phase === 'sailing' ? 'paused' : 'sailing')}>{phase === 'sailing' ? 'Ⅱ Pause' : phase === 'paused' ? '▶ Resume' : '▶ Start sailing'}</button>
          </div>
          <label className="playback">Playback speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="1">1× real time</option><option value="4">4×</option><option value="8">8×</option><option value="16">16×</option></select></label>
          <p className="instrument-hint">{phase === 'ready' ? 'Start on starboard. Tack when you choose. Cross the dark gate right to left on starboard to finish.' : boat.mode === 'gate' ? 'Aiming at gate center whenever legal. If the wind closes the angle, the boat returns to close-hauled.' : 'The boat follows the wind automatically. You choose when to tack.'}</p>
          <div className="keyboard-hint">SPACE start / pause <span>T tack</span></div>
        </aside>
      </div>
      <div className="utility-row"><div><button onClick={newWind}>↻ New wind</button><button onClick={() => reset(scenario.config)}>Retry same wind</button></div><button aria-expanded={showWind} onClick={() => setShowWind(!showWind)}>{showWind ? 'Hide' : 'Show'} wind history</button></div>
      {phase === 'finished' && <Results boat={boat} benchmark={benchmark} error={error} />}
      {error && phase !== 'finished' && <p role="alert" className="error">{error}</p>}
      {showWind && <WindHistory scenario={scenario} time={boat.time} />}
      <details className="advanced"><summary>Advanced settings <span>Course, boat & scenario</span></summary><p>Settings apply to a new leg. A fixed seed reproduces the same wind. Positive shifts are clockwise. Applying settings resets this leg.</p><div className="settings-grid">
        {numberField('courseLength', 'Course length (m)', 100, 5000, 100)}
        {numberField('baseline', 'Baseline wind from (°)', 0, 359)}
        {numberField('speedKnots', 'Boat speed (kn)', 1, 20, 0.5)}
        {numberField('minAngle', 'Minimum true wind angle (°)', 30, 60)}
        {numberField('tackPenalty', 'Tack penalty (s)', 0, 30, 0.5)}
        {numberField('maxShift', 'Maximum wind shift (±°)', 0, 30)}
        {numberField('shiftDuration', 'Base transition duration (s)', 2, 300)}
        {numberField('boatLength', 'Boat length (m)', 1, 30)}
        {numberField('gateBoatLengths', 'Gate length (boatlengths)', 1, 30)}
        {numberField('seed', 'Scenario seed', 0, 4294967295)}
      </div><button className="apply-button" onClick={() => reset(draft)}>Apply settings & reset</button><p>Persistent start time, direction, magnitude (60–100% of maximum), and duration (70–130% of base) are seeded. Oscillation difficulty scales transition and hold times. Boatlength defaults to 5 m; the default gate is 100 m.</p></details>
      <footer className="page-footer"><span>UPWIND / Build your tactical instinct.</span><span>Scenario {scenario.config.seed} · Fixed-step sailing model</span></footer>
    </main>
  </div>;
}
