// Provisional 5 m, 470-inspired MAIN + JIB data supplied for this trainer.
// Knots throughout. This is editable model data, not measured telemetry.
export const MAIN_JIB_DINGHY = {
    id: 'dinghy-main-jib', lengthMeters: 5, sailPlan: 'Main + jib',
    windSpeeds: [6, 10, 14, 18],
    polar: [
        [0, 0, 0, 0, 0],
        [30, 0.8, 1.2, 1.5, 1.7],
        [35, 1.8, 2.5, 2.9, 3.0],
        [40, 3.0, 4.1, 4.5, 4.6],
        [45, 3.4, 4.6, 5.1, 5.3],
        [50, 3.6, 4.9, 5.5, 5.8],
        [60, 3.8, 5.2, 6.0, 6.7],
        [75, 4.0, 5.6, 7.0, 8.5],
        [90, 4.1, 5.9, 7.8, 9.5],
        [105, 4.0, 6.0, 8.2, 10.0],
        [120, 3.7, 5.7, 7.8, 9.7],
        [135, 3.3, 5.2, 7.1, 8.8],
        [150, 3.0, 4.7, 6.4, 7.8],
        [165, 2.7, 4.2, 5.6, 6.9],
        [180, 2.5, 3.8, 5.0, 6.1],
    ],
    accelerationSeconds: 3, decelerationSeconds: 2, highWindTailKnots: 8,
};
export const BOAT_PROFILES = { [MAIN_JIB_DINGHY.id]: MAIN_JIB_DINGHY };
