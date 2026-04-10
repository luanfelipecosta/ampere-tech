import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { provisionUserMqtt } from '../provisioning';

const router = Router();
const BCRYPT_ROUNDS = 12;

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters' });
    return;
  }

  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Generate MQTT credentials for this user (read-only subscriber)
  const mqttPassword = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c] ?? c));
  const mqttPasswordHash = await bcrypt.hash(mqttPassword, BCRYPT_ROUNDS);

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, mqtt_password_hash)
       VALUES ($1, $2, $3, $4)`,
      [userId, email, passwordHash, mqttPasswordHash]
    );
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    throw err;
  }

  // Provision MQTT credentials asynchronously — don't block registration
  provisionUserMqtt(userId, mqttPassword).catch((err: Error) =>
    console.error('[Provisioning] Failed to create user MQTT creds:', err.message)
  );

  res.status(201).json({
    user_id: userId,
    email,
    message: 'User registered. Use POST /devices/register to provision meters.',
  });
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const result = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (result.rowCount === 0) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const user = result.rows[0] as { id: string; email: string; password_hash: string };
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const secret = process.env.JWT_SECRET!;
  const token = jwt.sign({ userId: user.id, email: user.email }, secret, {
    expiresIn: '7d',
  });

  res.json({ token, user_id: user.id, email: user.email });
});

export default router;
