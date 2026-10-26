export interface Vec { x: number; y: number }
export type Tack = 'starboard' | 'port';
export type Mode = 'close' | 'gate';
export type Action = 'hold' | 'tack' | 'bear' | 'close';
export interface Config {
  courseLength: number;
  speedKnots: number;
  minAngle: number;
  tackPenalty: number;
  baseline: number;
  boatLength: number;
  gateBoatLengths: number;
  windMode: 'persistent' | 'oscillating' | 'steady';
  difficulty: 'easy' | 'medium' | 'hard';
  maxShift: number;
  shiftDuration: number;
  seed: number;
}
export interface WindKnot { time: number; direction: number }
export interface Scenario { config: Config; wind: WindKnot[] }
export interface Boat {
  position: Vec;
  time: number;
  tack: Tack;
  mode: Mode;
  penaltyRemaining: number;
  penaltyTime: number;
  distance: number;
  tacks: number;
  finished: boolean;
}
export interface Command { time: number; action: Action }
export interface Route { commands: Command[]; points: Boat[]; finish: Boat }
