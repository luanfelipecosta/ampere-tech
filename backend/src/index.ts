import express from 'express';
import { initDb } from './db';
import { startMqttConsumer } from './mqtt';
import authRoutes from './routes/auth';
import deviceRoutes from './routes/devices';
import telemetryRoutes from './routes/telemetry';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/telemetry', telemetryRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function start(): Promise<void> {
  console.log('[Startup] Initializing database...');
  await initDb();
  console.log('[Startup] Database ready');

  startMqttConsumer();

  app.listen(PORT, () => {
    console.log(`[Startup] API listening on port ${PORT}`);
  });
}

start().catch((err: Error) => {
  console.error('[Startup] Fatal error:', err.message);
  process.exit(1);
});
