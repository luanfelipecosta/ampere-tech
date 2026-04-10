import { Router, Response } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /telemetry?device_id=...&circuit=...&limit=100&offset=0
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { device_id, circuit, limit = '100', offset = '0' } = req.query as Record<string, string>;

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIdx = 2;

  if (device_id) {
    conditions.push(`device_id = $${paramIdx++}`);
    params.push(device_id);
  }
  if (circuit) {
    conditions.push(`circuit = $${paramIdx++}`);
    params.push(circuit);
  }

  const where = conditions.join(' AND ');
  params.push(limitNum, offsetNum);

  const result = await pool.query(
    `SELECT id, user_id, device_id, circuit,
            voltage, current, power, energy_kwh,
            frequency, power_factor, import_energy, export_energy,
            timestamp
     FROM telemetry
     WHERE ${where}
     ORDER BY timestamp DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params
  );

  // Count total for pagination metadata
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM telemetry WHERE ${where}`,
    params.slice(0, -2)
  );

  res.json({
    data: result.rows,
    pagination: {
      total: parseInt((countResult.rows[0] as { total: string }).total, 10),
      limit: limitNum,
      offset: offsetNum,
    },
  });
});

// GET /telemetry/aggregate?device_id=...&group_by=circuit|device
router.get('/aggregate', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { device_id, group_by = 'circuit' } = req.query as Record<string, string>;

  const validGroupBy = ['circuit', 'device_id'];
  const groupColumn = group_by === 'device' ? 'device_id' : 'circuit';

  if (!validGroupBy.includes(groupColumn)) {
    res.status(400).json({ error: 'group_by must be "circuit" or "device"' });
    return;
  }

  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];

  if (device_id) {
    conditions.push(`device_id = $2`);
    params.push(device_id);
  }

  const where = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT ${groupColumn},
            SUM(import_energy) AS total_import_kwh,
            SUM(export_energy) AS total_export_kwh,
            SUM(energy_kwh)    AS total_energy_kwh,
            AVG(voltage)       AS avg_voltage,
            AVG(current)       AS avg_current,
            AVG(power)         AS avg_power,
            AVG(frequency)     AS avg_frequency,
            AVG(power_factor)  AS avg_power_factor,
            COUNT(*)           AS reading_count,
            MAX(timestamp)     AS last_reading
     FROM telemetry
     WHERE ${where}
     GROUP BY ${groupColumn}
     ORDER BY total_import_kwh DESC NULLS LAST`,
    params
  );

  res.json({ data: result.rows });
});

export default router;
