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
  const userId = req.user!.userId;
  const { mac_address } = req.body as { mac_address?: string };

  if (!mac_address) {
    res.status(400).json({ error: 'mac_address is required (12 hex chars, e.g. 74E9D840D09E)' });
    return;
  }
  const mac = mac_address.toUpperCase().replace(/:/g, '');
  if (!/^[A-F0-9]{12}$/.test(mac)) {
    res.status(400).json({ error: 'mac_address must be 12 hex characters (colons optional)' });
    return;
  }

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

  try {
    await pool.query(
      `INSERT INTO devices (id, user_id, mac_address, mqtt_user, mqtt_password_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, userId, mac, deviceId, mqttPasswordHash]
    );
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      res.status(409).json({ error: 'A device with this MAC address is already registered' });
      return;
    }
    throw err;
  }

  // Provision MQTT credentials and ACL
  try {
    await provisionDeviceMqtt(userId, deviceId, mac, mqttPassword);
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Provisioning] MQTT setup failed:', error.message);
    res.status(207).json({
      warning: 'Device registered but MQTT provisioning failed. Retry device registration.',
      device_id: deviceId,
    });
    return;
  }

  const brokerHost = process.env.PUBLIC_BROKER_HOST || 'localhost';

  res.status(201).json({
    device_id: deviceId,
    mac_address: mac,
    mqtt: {
      broker: brokerHost,
      port: 1883,
      username: deviceId,
      password: mqttPassword,
      publish_topic: `updev/${mac}`,
      control_topic: `downdev/${mac}`,
    },
    meter_configuration: {
      note: 'Open the meter web interface (default http://10.10.100.254, password 123456) and apply these MQTT settings:',
      broker_host: brokerHost,
      broker_port: 1883,
      client_id: deviceId,
      username: deviceId,
      password: mqttPassword,
      publish_topic: `updev/${mac}`,
      subscribe_topic: `downdev/${mac}`,
    },
    test_without_credentials: {
      note: 'For initial connectivity testing only — connect to port 1884 (no credentials required)',
      broker_port: 1884,
      publish_topic: `updev/${mac}`,
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

  // Verify the device belongs to this user and fetch MAC for topic routing
  const result = await pool.query<{ mac_address: string }>(
    'SELECT mac_address FROM devices WHERE id = $1 AND user_id = $2',
    [deviceId, userId]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  const { mac_address: mac } = result.rows[0];
  if (!mac) {
    res.status(409).json({ error: 'Device has no MAC address — please re-register the device' });
    return;
  }

  try {
    publishControl(mac, state);
    res.json({ device_id: deviceId, mac_address: mac, do: state });
  } catch (err: unknown) {
    res.status(503).json({ error: (err as Error).message });
  }
});

export default router;
