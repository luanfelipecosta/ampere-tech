import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

const PASSWD_FILE = '/mosquitto/config/passwd';
const ACL_FILE = '/mosquitto/config/acl';
const MOSQUITTO_CONTAINER = process.env.MOSQUITTO_CONTAINER || 'mosquitto';

async function createMqttCredentials(username: string, password: string): Promise<void> {
  // execFile passes args as an array — never interpolated into a shell, no injection risk
  await execFileAsync('mosquitto_passwd', ['-b', PASSWD_FILE, username, password]);
}

async function appendAclBlock(username: string, topicLines: string[]): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(ACL_FILE, 'utf8');
  } catch {
    content = '';
  }

  const userMarker = `\nuser ${username}\n`;
  const startMarker = `user ${username}\n`;
  if (content.includes(userMarker) || content.startsWith(startMarker)) {
    return; // block already exists; topics are added separately via addUserTopic
  }

  const lines = topicLines.length > 0 ? topicLines.join('\n') + '\n' : '';
  await fs.appendFile(ACL_FILE, `\nuser ${username}\n${lines}`);
}

/**
 * Insert a topic line into an existing user's ACL block.
 * Called when a new device is registered so the owner gains read access.
 */
async function addUserTopic(userId: string, topicLine: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(ACL_FILE, 'utf8');
  } catch {
    return;
  }

  if (content.includes(topicLine)) return; // already present

  const userLine = `user ${userId}`;
  const idx = content.indexOf(userLine);
  if (idx === -1) return; // user block not yet provisioned — topics will be added at provisioning time

  const endOfUserLine = content.indexOf('\n', idx) + 1;
  const updated = content.slice(0, endOfUserLine) + topicLine + '\n' + content.slice(endOfUserLine);
  await fs.writeFile(ACL_FILE, updated);
}

async function reloadMosquitto(): Promise<void> {
  await execFileAsync('docker', ['exec', MOSQUITTO_CONTAINER, 'kill', '-HUP', '1']);
}

export async function provisionDeviceMqtt(
  userId: string,
  deviceId: string,
  mac: string,
  password: string
): Promise<void> {
  const macUpper = mac.toUpperCase();
  await createMqttCredentials(deviceId, password);
  await appendAclBlock(deviceId, [
    `topic write updev/${macUpper}`,
    `topic read downdev/${macUpper}`,
  ]);
  // Grant the owning user read access to exactly this device's telemetry topic
  await addUserTopic(userId, `topic read updev/${macUpper}`);
  await reloadMosquitto();
}

export async function provisionUserMqtt(
  userId: string,
  password: string
): Promise<void> {
  await createMqttCredentials(userId, password);
  // Empty block — topic lines are added per-device as devices are registered
  await appendAclBlock(userId, []);
  await reloadMosquitto();
}
