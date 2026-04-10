import mqtt from 'mqtt';
import { pool } from './db';

// Meters publish to:  telemetry/{device_id}/data
// Backend publishes to: telemetry/{device_id}/control
const DATA_TOPIC_REGEX = /^telemetry\/([^/]+)\/data$/;

interface TelemetryPayload {
  voltage?: number;
  current?: number;
  power?: number;
  energy_kwh?: number;
  frequency?: number;
  power_factor?: number;
  import_energy?: number;
  export_energy?: number;
}

let mqttClient: mqtt.MqttClient | null = null;

export function publishControl(deviceId: string, state: 'on' | 'off'): void {
  if (!mqttClient) throw new Error('MQTT client not initialized');
  const topic = `telemetry/${deviceId}/control`;
  const payload = JSON.stringify({ do: state });
  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) console.error(`[MQTT] Failed to publish control to ${topic}:`, err.message);
    else console.log(`[MQTT] DO command sent to ${deviceId}: ${state}`);
  });
}

export function startMqttConsumer(): void {
  const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
  const username = process.env.MQTT_BACKEND_USER || 'backend_service';
  const password = process.env.MQTT_BACKEND_PASSWORD || '';

  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    clientId: `backend_consumer_${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
  });

  mqttClient = client;

  client.on('connect', () => {
    console.log('[MQTT] Connected to broker');
    // Subscribe only to data topics; ignore control topics
    client.subscribe('telemetry/+/data', { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log('[MQTT] Subscribed to telemetry/+/data');
    });
  });

  client.on('message', async (topic: string, payload: Buffer) => {
    const match = topic.match(DATA_TOPIC_REGEX);
    if (!match) return;

    const [, deviceId] = match;

    let data: TelemetryPayload;
    try {
      data = JSON.parse(payload.toString()) as TelemetryPayload;
    } catch {
      console.warn(`[MQTT] Invalid JSON on topic ${topic}`);
      return;
    }

    // Look up user_id from device registry
    let userId: string;
    try {
      const result = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM devices WHERE id = $1',
        [deviceId]
      );
      if (result.rowCount === 0) {
        console.warn(`[MQTT] Unknown device: ${deviceId}`);
        return;
      }
      userId = result.rows[0].user_id;
    } catch (err: unknown) {
      console.error('[MQTT] Device lookup error:', (err as Error).message);
      return;
    }

    pool.query(
      `INSERT INTO telemetry
         (user_id, device_id, voltage, current, power, energy_kwh,
          frequency, power_factor, import_energy, export_energy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId, deviceId,
        data.voltage ?? null, data.current ?? null,
        data.power ?? null, data.energy_kwh ?? null,
        data.frequency ?? null, data.power_factor ?? null,
        data.import_energy ?? null, data.export_energy ?? null,
      ]
    ).catch((err: Error) => console.error('[MQTT] DB insert error:', err.message));
  });

  client.on('error', (err) => console.error('[MQTT] Error:', err.message));
  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('offline', () => console.warn('[MQTT] Offline'));
}
