import { optimize } from './engine/optimizer';
import type { Command, Scenario } from './engine/types';

self.onmessage = (event: MessageEvent<{ scenario: Scenario; commands: Command[]; time: number }>) => {
  try {
    self.postMessage({ result: optimize(event.data.scenario, event.data.commands, event.data.time) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
