import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), '.mock-vps-store.json');

function ensure() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ jobs: {}, tokens: {} }, null, 2));
}

export function readStore() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function writeStore(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

export function createMockJob(job) {
  const s = readStore();
  s.jobs[job.jobId] = job;
  s.tokens[job.token] = { results: job.results, expiresAt: job.expiresAt, jobId: job.jobId, zipUrl: job.zipUrl };
  writeStore(s);
}

export function getMockJob(jobId) {
  return readStore().jobs[jobId];
}

export function updateMockJob(jobId, updater) {
  const s = readStore();
  if (!s.jobs[jobId]) return null;
  s.jobs[jobId] = updater(s.jobs[jobId]);
  s.tokens[s.jobs[jobId].token] = {
    results: s.jobs[jobId].results,
    expiresAt: s.jobs[jobId].expiresAt,
    jobId,
    zipUrl: s.jobs[jobId].zipUrl,
  };
  writeStore(s);
  return s.jobs[jobId];
}

export function getTokenRecord(token) {
  return readStore().tokens[token];
}

export function updateTokenRecord(token, updater) {
  const s = readStore();
  if (!s.tokens[token]) return null;
  s.tokens[token] = updater(s.tokens[token]);
  writeStore(s);
  return s.tokens[token];
}
