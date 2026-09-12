import { createApp } from './app.js';
import { config } from './config.js';
import { getDatabase } from './db.js';

getDatabase(config.dbPath);

const app = createApp();

app.listen(config.port, () => {
  console.log(`[PAYMENTS SLICE] Server listening at http://localhost:${config.port}`);
  console.log(`[PAYMENTS SLICE] Environment: ${config.nodeEnv}`);
});
