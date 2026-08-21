import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const app = buildServer();

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => {
    console.log(`Cadence Overlay Resolver API on http://127.0.0.1:${port}`);
    console.log('SYNTHETIC DATA ONLY. This prototype is not authorized to process PHI.');
  })
  .catch((err) => {
    console.error('failed to start', err);
    process.exit(1);
  });
