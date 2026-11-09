import * as liveWind from './wind.js';

// Physics can consume an estimated environment without knowing how it was
// constructed. Live scenarios take the original path unchanged. Providers are
// realm-local capabilities, never observation data or policy inputs.
const providers = new WeakMap();
export function createPhysicsEnvironment(config, provider) {
  const environment = { config };
  providers.set(environment, provider);
  return environment;
}
export const hasEnvironmentProvider = environment => providers.has(environment);
export const physicsStepCallback = environment => providers.get(environment)?.beforeStep;
export const providedCourse = environment => providers.get(environment)?.course ?? null;

export function windSampleAtPosition(environment, x, y, time) {
  const provider = providers.get(environment);
  return provider ? provider.sample(x, y, time) : liveWind.windSampleAtPosition(environment, x, y, time);
}
export function windAtPosition(environment, x, y, time) {
  const provider = providers.get(environment);
  if (!provider) return liveWind.windAtPosition(environment, x, y, time);
  const angle = provider.sample(x, y, time).direction;
  return angle > 180 ? angle - 360 : angle;
}
export function windIntegrationStep(environment, y, time, maximum, speed, x = 0) {
  const provider = providers.get(environment);
  return provider ? maximum : liveWind.windIntegrationStep(environment, y, time, maximum, speed, x);
}
