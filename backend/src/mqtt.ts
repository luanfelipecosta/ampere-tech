import mqtt from 'mqtt';
import { pool } from './db';

// telemetry/{user_id}/{device_id}/{circuit_id}
const TOPIC_REGEX = /^telemetry\/([^/]+)\/([^/]+)\/([^/]+)$/;

interface TelemetryPayload {
  voltage?: number;
  current?: number;
  power?: number;
  energy_kwh?: number;
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

  client.on('connect', () => {
    console.log('[MQTT] Connected to broker');
    client.subscribe('telemetry/#', { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log('[MQTT] Subscribed to telemetry/#');
    });
  });

  client.on('message', (topic: string, payload: Buffer) => {
    const match = topic.match(TOPIC_REGEX);
    if (!match) {
      console.warn(`[MQTT] Unexpected topic format: ${topic}`);
      return;
    }

    const [, userId, deviceId, circuit] = match;

    let data: TelemetryPayload;
    try {
      data = JSON.parse(payload.toString()) as TelemetryPayload;
    } catch {
      console.warn(`[MQTT] Invalid JSON on topic ${topic}`);
      return;
    }

    pool.query(
      `INSERT INTO telemetry (user_id, device_id, circuit, voltage, current, power, energy_kwh)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, deviceId, circuit, data.voltage ?? null, data.current ?? null, data.power ?? null, data.energy_kwh ?? null]
    ).catch((err: Error) => console.error('[MQTT] DB insert error:', err.message));
  });

  client.on('error', (err) => console.error('[MQTT] Error:', err.message));
  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('offline', () => console.warn('[MQTT] Offline'));
}
