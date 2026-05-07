import { startWorker } from './flow-worker-common.mjs';

await startWorker({
  workerName: 'flow-image-to-video-worker',
  supportedTools: ['image-to-video'],
  supportedWorkerTypes: ['image-to-video'],
});
