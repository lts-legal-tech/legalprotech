#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const files = ['.env.local', '.env.example', '.env.local.example'];

for (const file of files) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  s = s.replace(/^FLOW_KEEP_BROWSER_OPEN=.*/m, 'FLOW_KEEP_BROWSER_OPEN=false');
  s = s.replace(/^FLOW_WORKER_POLL_INTERVAL_MS=.*/m, 'FLOW_WORKER_POLL_INTERVAL_MS=15000');
  s = s.replace(/^FLOW_RESULT_READY_POLL_MS=.*/m, 'FLOW_RESULT_READY_POLL_MS=10000');

  if (!/^FLOW_KEEP_BROWSER_OPEN=/m.test(s)) {
    s += '\nFLOW_KEEP_BROWSER_OPEN=false\n';
  }

  if (s !== before) {
    fs.writeFileSync(p, s, 'utf8');
    console.log(`Patched ${file}`);
  } else {
    console.log(`No change ${file}`);
  }
}

console.log('\nOK: Chrome sẽ đóng sau mỗi job để tránh lỗi profile/user-data-dir bị chiếm.');
console.log('Nếu Chrome đang bị treo lock, chạy thêm: powershell -ExecutionPolicy Bypass -File scripts\\reset-chrome-flow-lock.ps1');
