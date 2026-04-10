import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          VARCHAR(36)  PRIMARY KEY,
        email       VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        mqtt_password_hash VARCHAR(255),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
        id                 VARCHAR(50)  PRIMARY KEY,
        user_id            VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mac_address        VARCHAR(20)  UNIQUE,
        mqtt_user          VARCHAR(100) NOT NULL UNIQUE,
        mqtt_password_hash VARCHAR(255) NOT NULL,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        id         BIGSERIAL PRIMARY KEY,
        user_id    VARCHAR(36)   NOT NULL,
        device_id  VARCHAR(50)   NOT NULL,
        circuit    VARCHAR(50)   NOT NULL,
        voltage    NUMERIC(10,3),
        current    NUMERIC(10,3),
        power      NUMERIC(10,3),
        energy_kwh NUMERIC(12,4),
        timestamp  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_user_device_ts
        ON telemetry(user_id, device_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_user_circuit
        ON telemetry(user_id, circuit);
    `);

    // Schema migrations — safe to run repeatedly
    await client.query(`
      ALTER TABLE telemetry ALTER COLUMN circuit DROP NOT NULL;
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS frequency     NUMERIC(8,3);
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS power_factor  NUMERIC(6,4);
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS import_energy NUMERIC(12,4);
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS export_energy NUMERIC(12,4);
      ALTER TABLE devices   ADD COLUMN IF NOT EXISTS mac_address   VARCHAR(20) UNIQUE;
    `);
  } finally {
    client.release();
  }
}
