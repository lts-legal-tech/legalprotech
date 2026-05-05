import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), '.mock-registrations.json');

function ensure() {
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ registrations: [] }, null, 2));
  }
}

export function readRegistrationStore() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function writeRegistrationStore(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function createRegistration(payload) {
  const store = readRegistrationStore();
  const record = {
    id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  store.registrations.unshift(record);
  writeRegistrationStore(store);
  return record;
}

export function listRegistrations() {
  return readRegistrationStore().registrations || [];
}

export function updateRegistration(id, updater) {
  const store = readRegistrationStore();
  const idx = store.registrations.findIndex((item) => item.id === id);
  if (idx < 0) return null;
  store.registrations[idx] = updater(store.registrations[idx]);
  writeRegistrationStore(store);
  return store.registrations[idx];
}


export function findRegistrationByEmail(email) {
  return listRegistrations().find((item) => String(item.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
}
