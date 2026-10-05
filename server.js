// Jumıs AI — start with:  npm start   (or: node server.js)
import http from 'node:http';
import { loadEnv, config } from './src/env.js';

loadEnv();
process.env.TZ = process.env.TZ || process.env.APP_TIMEZONE || 'Asia/Tashkent';

const { handle } = await import('./src/app.js');

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
  });
});
server.requestTimeout = 10 * 60 * 1000; // allow large uploads
server.listen(config.port, () => {
  console.log(`\n  Jumıs AI is running → http://localhost:${config.port}`);
  console.log(`  Public URL (SITE_URL): ${config.siteUrl}`);
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude API connected' : process.env.AI_MOCK === '1' ? 'demo mode' : 'not configured (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Email: ${process.env.RESEND_API_KEY ? 'Resend connected' : 'not configured (emails are printed here)'}\n`);
});
