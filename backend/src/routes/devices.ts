import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { provisionDeviceMqtt } from '../provisioning';
import { publishControl } from '../mqtt';

const router = Router();
const BCRYPT_ROUNDS = 12;

router.post('/register', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  // user_id is always derived from the JWT — never trust the request body
  const userId = req.user!.userId;

  // Verify user exists in DB
  const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rowCount === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Generate device identity
  const deviceId = `dev_${crypto.randomBytes(6).toString('hex')}`;
  const mqttPassword = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c] ?? c));
  const mqttPasswordHash = await bcrypt.hash(mqttPassword, BCRYPT_ROUNDS);

  await pool.query(
    `INSERT INTO devices (id, user_id, mqtt_user, mqtt_password_hash)
     VALUES ($1, $2, $3, $4)`,
    [deviceId, userId, deviceId, mqttPasswordHash]
  );

  // Provision MQTT credentials and ACL
  try {
    await provisionDeviceMqtt(userId, deviceId, mqttPassword);
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Provisioning] MQTT setup failed:', error.message);
    // Device is registered in DB; MQTT provisioning can be retried
    res.status(207).json({
      warning: 'Device registered but MQTT provisioning failed. Retry device registration.',
      device_id: deviceId,
    });
    return;
  }

  const brokerHost = process.env.PUBLIC_BROKER_HOST || 'localhost';

  res.status(201).json({
    device_id: deviceId,
    mqtt: {
      broker: brokerHost,
      port: 1883,
      username: deviceId,
      password: mqttPassword,
      publish_topic: `telemetry/${deviceId}/data`,
      control_topic: `telemetry/${deviceId}/control`,
    },
    meter_configuration: {
      note: 'Open the meter web interface (default http://10.10.100.254, password 123456) and apply these MQTT settings:',
      broker_host: brokerHost,
      broker_port: 1883,
      client_id: deviceId,
      username: deviceId,
      password: mqttPassword,
      publish_topic: `telemetry/${deviceId}/data`,
      subscribe_topic: `telemetry/${deviceId}/control`,
    },
    test_without_credentials: {
      note: 'For initial connectivity testing only — connect to port 1884 (no credentials required)',
      broker_port: 1884,
      publish_topic: `telemetry/test/${deviceId}/data`,
    },
  });
});

router.post('/:deviceId/do', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { deviceId } = req.params;
  const { state } = req.body as { state?: string };

  if (state !== 'on' && state !== 'off') {
    res.status(400).json({ error: 'state must be "on" or "off"' });
    return;
  }

  // Verify the device belongs to this user
  const result = await pool.query(
    'SELECT id FROM devices WHERE id = $1 AND user_id = $2',
    [deviceId, userId]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  try {
    publishControl(deviceId, state);
    res.json({ device_id: deviceId, do: state });
  } catch (err: unknown) {
    res.status(503).json({ error: (err as Error).message });
  }
});

export default router;
