export const STEP = 0.25;
export const KNOT_TO_MPS = 1852 / 3600;
export const EXPERT_TACK = {
    durationSeconds: 4.5, minSpeedFraction: 0.8, totalRecoverySeconds: 8,
    minimumAtTurnFraction: 0.8, integrationStepSeconds: 0.05,
};
export const DEFAULT_CONFIG = {
    courseLength: 1000, speedKnots: 5, minAngle: 45,
    // Keep the existing settings key; it now means moving turn duration.
    tackPenalty: EXPERT_TACK.durationSeconds,
    tackMinSpeedFraction: EXPERT_TACK.minSpeedFraction,
    tackRecoverySeconds: EXPERT_TACK.totalRecoverySeconds,
    baseline: 0, boatLength: 5, gateBoatLengths: 20,
    windMode: 'oscillating', difficulty: 'easy', maxShift: 15,
    shiftDuration: 40, seed: 314159,
    windField: 'uniform', propagationSpeed: 3, transitionWidth: 60,
    persistentShiftAngle: 12, shiftStartTime: 20,
    favoredSide: 'balanced', windBias: 65, windFrequency: 1.5,
    windSizeBL: 35, backgroundWindKnots: 10, windContrast: 30, pressureExponent: 0.5,
};
// Keep engine callers' legacy default stable; the decision tool starts with
// the integrated organic field, including pressure-dependent sailing speed.
export const DEFAULT_TRAINER_CONFIG = { ...DEFAULT_CONFIG, windField: 'organic' };
export function validateConfig(config) {
    const ranges = {
        courseLength: [100, 5000], speedKnots: [1, 20], minAngle: [30, 60],
        tackPenalty: [0, 30], tackMinSpeedFraction: [0.1, 1], tackRecoverySeconds: [0, 60],
        baseline: [0, 359], boatLength: [1, 30],
        gateBoatLengths: [1, 30], maxShift: [0, 30], shiftDuration: [2, 300],
        seed: [0, 4294967295],
        propagationSpeed: [0.5, 20], transitionWidth: [1, 500],
        persistentShiftAngle: [-30, 30], shiftStartTime: [0, 600],
        windBias: [50, 85], windFrequency: [0, 12], windSizeBL: [15, 75],
        backgroundWindKnots: [1, 30], windContrast: [0, 70], pressureExponent: [0, 1],
    };
    for (const [key, [min, max]] of Object.entries(ranges)) {
        const value = config[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
            throw new Error(`${key} must be between ${min} and ${max}.`);
    }
    if (!Number.isInteger(config.seed))
        throw new Error('Seed must be an integer.');
    if (!['steady', 'persistent', 'oscillating'].includes(config.windMode))
        throw new Error('Unknown wind mode.');
    if (!['easy', 'medium', 'hard'].includes(config.difficulty))
        throw new Error('Unknown difficulty.');
    if (!['uniform', 'traveling', 'organic'].includes(config.windField))
        throw new Error('Unknown wind field.');
    if (!['balanced', 'left', 'right'].includes(config.favoredSide))
        throw new Error('Unknown favored side.');
}
