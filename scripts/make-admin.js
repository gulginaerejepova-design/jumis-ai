// Make an existing user an admin:   npm run make-admin -- someone@example.com
import { loadEnv } from '../src/env.js';
loadEnv();
const { q } = await import('../src/db.js');

const email = (process.argv[2] || '').toLowerCase();
if (!email) { console.log('Usage: npm run make-admin -- email@example.com'); process.exit(1); }
const u = q.get('SELECT id FROM users WHERE email = ?', email);
if (!u) { console.log(`No user with email ${email}. Register on the site first.`); process.exit(1); }
q.run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
console.log(`✔ ${email} is now an admin.`);
