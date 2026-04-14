import mqtt from 'mqtt';
import { pool } from './db';

// Meters publish to:  updev/{MAC}          e.g. updev/74E9D840D09E
// Backend publishes to: downdev/{MAC}      e.g. downdev/74E9D840D09E
const DATA_TOPIC_REGEX = /^updev\/([A-Fa-f0-9]{12})$/;

// Raw payload format sent by the meter firmware
interface RawTelemetryPayload {
  'ID'?: string;
  'Voltage'?: number;
  'Frequency'?: number;
  'Current'?: number;
  'Active power'?: number;
  'Apparent power'?: number;
  'Reactive power'?: number;
  'Power factor'?: number;
  'Import active energy'?: number;
  'Import reactive energy'?: number;
  'Export active energy'?: number;
  'Export reactive energy'?: number;
  'Total active energy'?: number;
  'DO status'?: number;
  'Sn'?: number | string;
}

interface TelemetryPayload {
  voltage?: number;
  current?: number;
  power?: number;
  apparent_power?: number;
  reactive_power?: number;
  energy_kwh?: number;
  frequency?: number;
  power_factor?: number;
  import_energy?: number;
  import_reactive_energy?: number;
  export_energy?: number;
  export_reactive_energy?: number;
  do_status?: number;
  serial_number?: string;
}

function mapRawPayload(raw: RawTelemetryPayload): TelemetryPayload {
  return {
    voltage:                raw['Voltage'],
    frequency:              raw['Frequency'],
    current:                raw['Current'],
    power:                  raw['Active power'],
    apparent_power:         raw['Apparent power'],
    reactive_power:         raw['Reactive power'],
    power_factor:           raw['Power factor'],
    import_energy:          raw['Import active energy'],
    import_reactive_energy: raw['Import reactive energy'],
    export_energy:          raw['Export active energy'],
    export_reactive_energy: raw['Export reactive energy'],
    energy_kwh:             raw['Total active energy'],
    do_status:              raw['DO status'],
    serial_number:          raw['Sn'] != null ? String(raw['Sn']) : undefined,
  };
}

let mqttClient: mqtt.MqttClient | null = null;

export function publishControl(mac: string, state: 'on' | 'off'): void {
  if (!mqttClient) throw new Error('MQTT client not initialized');
  const topic = `downdev/${mac.toUpperCase()}`;
  const payload = JSON.stringify({ do: state });
  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) console.error(`[MQTT] Failed to publish control to ${topic}:`, err.message);
    else console.log(`[MQTT] DO command sent to ${mac}: ${state}`);
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
    client.subscribe('updev/+', { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log('[MQTT] Subscribed to updev/+');
    });
  });

  client.on('message', async (topic: string, payload: Buffer) => {
    const match = topic.match(DATA_TOPIC_REGEX);
    if (!match) return;

    const [, mac] = match;

    let data: TelemetryPayload;
    try {
      const raw = JSON.parse(payload.toString()) as RawTelemetryPayload;
      data = mapRawPayload(raw);
    } catch {
      console.warn(`[MQTT] Invalid JSON on topic ${topic}`);
      return;
    }

    // Look up device by MAC address, auto-registering anonymous devices on first seen
    let userId: string | null;
    let deviceId: string;
    const macUpper = mac.toUpperCase();
    try {
      await pool.query(
        `INSERT INTO devices (id, mac_address) VALUES ($1, $1) ON CONFLICT DO NOTHING`,
        [macUpper]
      );
      const result = await pool.query<{ id: string; user_id: string | null }>(
        'SELECT id, user_id FROM devices WHERE mac_address = $1',
        [macUpper]
      );
      if (result.rowCount === 0) {
        console.warn(`[MQTT] Could not resolve device for MAC: ${mac}`);
        return;
      }
      ({ id: deviceId, user_id: userId } = result.rows[0]);
    } catch (err: unknown) {
      console.error('[MQTT] Device lookup error:', (err as Error).message);
      return;
    }

    pool.query(
      `INSERT INTO telemetry
         (user_id, device_id, voltage, current, power, apparent_power, reactive_power,
          energy_kwh, frequency, power_factor, import_energy, import_reactive_energy,
          export_energy, export_reactive_energy, do_status, serial_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        userId, deviceId,
        data.voltage              ?? null,
        data.current              ?? null,
        data.power                ?? null,
        data.apparent_power       ?? null,
        data.reactive_power       ?? null,
        data.energy_kwh           ?? null,
        data.frequency            ?? null,
        data.power_factor         ?? null,
        data.import_energy        ?? null,
        data.import_reactive_energy ?? null,
        data.export_energy        ?? null,
        data.export_reactive_energy ?? null,
        data.do_status            ?? null,
        data.serial_number        ?? null,
      ]
    ).catch((err: Error) => console.error('[MQTT] DB insert error:', err.message));
  });

  client.on('error', (err) => console.error('[MQTT] Error:', err.message));
  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('offline', () => console.warn('[MQTT] Offline'));
}
