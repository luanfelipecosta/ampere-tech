import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

const PASSWD_FILE = '/mosquitto/config/passwd';
const ACL_FILE = '/mosquitto/config/acl';
const MOSQUITTO_CONTAINER = process.env.MOSQUITTO_CONTAINER || 'mosquitto';

async function createMqttCredentials(username: string, password: string): Promise<void> {
  // mosquitto_passwd -b: batch mode (non-interactive)
  // Quote arguments to prevent shell injection
  await execAsync(`mosquitto_passwd -b '${PASSWD_FILE}' '${username}' '${password}'`);
}

async function appendAclBlock(username: string, topicLines: string[]): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(ACL_FILE, 'utf8');
  } catch {
    content = '';
  }

  // Idempotency check: skip if user block already present
  const userMarker = `\nuser ${username}\n`;
  const startMarker = `user ${username}\n`;
  if (content.includes(userMarker) || content.startsWith(startMarker)) {
    return;
  }

  const block = `\nuser ${username}\n${topicLines.join('\n')}\n`;
  await fs.appendFile(ACL_FILE, block);
}

async function reloadMosquitto(): Promise<void> {
  // Send SIGHUP to PID 1 inside the mosquitto container to reload config
  await execAsync(`docker exec '${MOSQUITTO_CONTAINER}' kill -HUP 1`);
}

export async function provisionDeviceMqtt(
  userId: string,
  deviceId: string,
  password: string
): Promise<void> {
  await createMqttCredentials(deviceId, password);
  await appendAclBlock(deviceId, [
    `topic telemetry/${userId}/${deviceId}/#`,
  ]);
  await reloadMosquitto();
}

export async function provisionUserMqtt(
  userId: string,
  password: string
): Promise<void> {
  await createMqttCredentials(userId, password);
  await appendAclBlock(userId, [
    `topic read telemetry/${userId}/#`,
  ]);
  await reloadMosquitto();
}
