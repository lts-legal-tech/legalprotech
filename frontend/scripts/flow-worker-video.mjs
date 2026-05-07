import { startWorker } from './flow-worker-common.mjs';

await startWorker({
  workerName: 'flow-video-worker',
  supportedTools: ['text-to-video'],
  supportedWorkerTypes: ['video'],
});
