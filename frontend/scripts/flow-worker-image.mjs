import { startWorker } from './flow-worker-common.mjs';

await startWorker({
  workerName: 'flow-image-worker',
  supportedTools: ['text-to-image'],
  supportedWorkerTypes: ['image'],
});
