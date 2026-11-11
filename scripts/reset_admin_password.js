// Reset the admin password from the server's terminal (when you can't sign in).
//   npm run reset-admin -- "MyNewPassword123"
// Works while the app is running; no restart needed. Other admin devices are signed out.
const path = require('path');
require('../src/env').loadEnv(path.join(__dirname, '..', '.env'));

const password = process.argv.slice(2).join(' ').trim();
if (!password) {
  console.log('Usage: npm run reset-admin -- "MyNewPassword123"');
  process.exit(1);
}

const db = require('../src/db');
try {
  const s = db.setAdminPassword(password);
  console.log('\n  Admin password changed.');
  console.log(`  Username: ${s.admin_username}`);
  console.log('  Sign in at /admin with the new password.');
  console.log('  Locked out after wrong tries? Run: pm2 restart office-attendance\n');
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}
