export const BOAT_COLORS = { Ocean: '#246caa', Teal: '#26766e', Clay: '#ad6049', Slate: '#536577', Ochre: '#9b7d31' };
export const DEFAULT_PREFERENCES = { boatColor: BOAT_COLORS.Ocean, windDisplay: 'streaks', showWind: false, follow: false, laylineMode: 'wind-only' };
export function loadPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem('upwind.preferences') || '{}');
    return { boatColor: Object.values(BOAT_COLORS).includes(saved.boatColor) ? saved.boatColor : DEFAULT_PREFERENCES.boatColor,
      windDisplay: ['streaks', 'boundaries', 'hidden'].includes(saved.windDisplay) ? saved.windDisplay : 'streaks',
      showWind: saved.showWind === true, follow: saved.follow === true,
      laylineMode: saved.laylineMode === 'wind-current' ? 'wind-current' : 'wind-only' };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}
export function savePreferences(storage, preferences) {
  try { storage.setItem('upwind.preferences', JSON.stringify(preferences)); return true; } catch { return false; }
}
