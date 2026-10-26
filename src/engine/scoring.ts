import type { Boat } from './types';

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export function compareRoutes(player: Boat, reference: Boat) {
  return { time: player.time - reference.time, distance: player.distance - reference.distance, tacks: player.tacks - reference.tacks, penalty: player.penaltyTime - reference.penaltyTime };
}
