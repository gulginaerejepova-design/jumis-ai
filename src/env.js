// Loads variables from a .env file (if present) into process.env.
// Real environment variables always win over values in the file.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export const config = {
  get port() { return Number(process.env.PORT || 3000); },
  get siteUrl() { return (process.env.SITE_URL || `http://localhost:${this.port}`).replace(/\/$/, ''); },
  get dataDir() { return path.resolve(process.env.DATA_DIR || 'data'); },
  get isProd() { return process.env.NODE_ENV === 'production'; },
  get maxUploadMb() { return Number(process.env.MAX_UPLOAD_MB || 100); },
  get googleVerification() { return process.env.GOOGLE_SITE_VERIFICATION || ''; },
  get siteName() { return process.env.SITE_NAME || 'Jumıs AI'; },
};
