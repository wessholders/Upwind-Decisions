// Bridge browser worker messaging to a real Node worker for protocol tests.
import { parentPort } from 'node:worker_threads';

globalThis.self = { postMessage: value => parentPort.postMessage(value) };
await import('../src/optimizer.worker.js');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ ready: true });
