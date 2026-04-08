import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { provisionDeviceMqtt } from '../provisioning';

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

  res.status(201).json({
    device_id: deviceId,
    mqtt: {
      broker: 'localhost',
      port: 1883,
      username: deviceId,
      password: mqttPassword,
    },
    topic: `telemetry/${userId}/${deviceId}/#`,
    circuit_topic_example: `telemetry/${userId}/${deviceId}/circuit_01`,
  });
});

export default router;
