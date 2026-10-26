import { optimize } from './engine/optimizer.js';

self.onmessage = event => {
  try {
    const { scenario, commands, time, computer } = event.data;
    self.postMessage({ result: optimize(scenario, commands, time, computer ? [computer] : []) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
