# Ampere Tech — Multi-Tenant IoT Energy Monitoring Platform

Production-ready, multi-tenant IoT energy monitoring platform using Node.js (TypeScript), PostgreSQL, and Eclipse Mosquitto MQTT broker, fully containerized with Docker Compose.

## Architecture

```
Devices → MQTT Broker → Backend Consumer → PostgreSQL → REST API → Client Apps
```

**Components:**
- **Eclipse Mosquitto 2.0** — MQTT broker with ACL-based multi-tenant isolation
- **Node.js/TypeScript (Express)** — REST API + MQTT consumer
- **PostgreSQL 16** — Persistent storage for users, devices, telemetry

**Topic structure:** `telemetry/{user_id}/{device_id}/{circuit_id}`

---

## Quick Start

```bash
docker-compose up --build
```

The API will be available at `http://localhost:3000`.

---

## Complete Test Walkthrough

### 1. Register a user

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}' | jq .
```

**Response includes:**
- `user_id` — your unique user ID
- `mqtt.username` / `mqtt.password` — MQTT credentials for subscribing to your telemetry
- `mqtt.subscribe_topic` — topic pattern to subscribe to

### 2. Login and get JWT

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}' | jq -r '.token')

echo "Token: $TOKEN"
```

### 3. Register a device

```bash
DEVICE=$(curl -s -X POST http://localhost:3000/devices/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .)

echo "$DEVICE"

DEVICE_USER=$(echo $DEVICE | jq -r '.mqtt.username')
DEVICE_PASS=$(echo $DEVICE | jq -r '.mqtt.password')
DEVICE_ID=$(echo $DEVICE | jq -r '.device_id')
USER_ID=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}' | jq -r '.user_id')
```

### 4. Publish telemetry (as device)

```bash
mosquitto_pub -h localhost -p 1883 \
  -u "$DEVICE_USER" -P "$DEVICE_PASS" \
  -t "telemetry/${USER_ID}/${DEVICE_ID}/circuit_01" \
  -m '{"voltage":220.5,"current":3.2,"power":705.6,"energy_kwh":12.5}'

mosquitto_pub -h localhost -p 1883 \
  -u "$DEVICE_USER" -P "$DEVICE_PASS" \
  -t "telemetry/${USER_ID}/${DEVICE_ID}/circuit_02" \
  -m '{"voltage":219.8,"current":5.1,"power":1120.98,"energy_kwh":8.3}'
```

### 5. Subscribe as user (read-only)

From the registration response, use the MQTT credentials:

```bash
# Replace <mqtt_password> with the password from the /auth/register response
mosquitto_sub -h localhost -p 1883 \
  -u "$USER_ID" -P "<mqtt_password_from_register>" \
  -t "telemetry/${USER_ID}/#" -v
```

### 6. Query telemetry via API

```bash
# All telemetry for this user
curl -s "http://localhost:3000/telemetry" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Filter by device
curl -s "http://localhost:3000/telemetry?device_id=${DEVICE_ID}" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Filter by circuit
curl -s "http://localhost:3000/telemetry?circuit=circuit_01" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Paginate
curl -s "http://localhost:3000/telemetry?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Aggregate energy per circuit
curl -s "http://localhost:3000/telemetry/aggregate?group_by=circuit" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Aggregate energy per device
curl -s "http://localhost:3000/telemetry/aggregate?group_by=device" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | None | Register user + provision MQTT credentials |
| POST | `/auth/login` | None | Login, returns JWT |

### Devices

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/devices/register` | Bearer JWT | Provision a new device with MQTT credentials |

### Telemetry

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/telemetry` | Bearer JWT | Query telemetry with optional filters |
| GET | `/telemetry/aggregate` | Bearer JWT | Aggregated energy per circuit or device |

**Telemetry query params:** `device_id`, `circuit`, `limit` (max 1000), `offset`

**Aggregate query params:** `device_id`, `group_by` (`circuit` or `device`)

---

## Security Model

- `allow_anonymous false` on Mosquitto — no unauthenticated connections
- Devices can only publish/subscribe to `telemetry/{their_user_id}/{their_device_id}/#`
- Users can only read `telemetry/{their_user_id}/#`
- `user_id` is always derived from the JWT — never trusted from request body
- All passwords hashed with bcrypt (12 rounds)
- JWT tokens expire in 7 days

---

## Project Structure

```
.
├── docker-compose.yml
├── .env                          # Secrets (not committed)
├── mosquitto/
│   ├── Dockerfile
│   ├── docker-entrypoint.sh      # Initializes passwd + ACL on startup
│   └── config/
│       └── mosquitto.conf
└── backend/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts              # Express app + startup
        ├── db.ts                 # PostgreSQL pool + schema init
        ├── mqtt.ts               # MQTT consumer (telemetry ingestion)
        ├── provisioning.ts       # MQTT user/ACL management
        ├── middleware/
        │   └── auth.ts           # JWT middleware
        └── routes/
            ├── auth.ts           # /auth/register, /auth/login
            ├── devices.ts        # /devices/register
            └── telemetry.ts      # /telemetry (query + aggregate)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `ampere_pass` | PostgreSQL password |
| `MQTT_BACKEND_PASSWORD` | `backend_strong_pass_change_me` | Backend service MQTT password |
| `JWT_SECRET` | `jwt_secret_change_in_production` | JWT signing secret |

Change all defaults before deploying to production.

---

## Database Schema

```sql
users       (id, email, password_hash, mqtt_password_hash, created_at)
devices     (id, user_id→users, mqtt_user, mqtt_password_hash, created_at)
telemetry   (id, user_id, device_id, circuit, voltage, current, power, energy_kwh, timestamp)

-- Indexes
idx_telemetry_user_device_ts  ON telemetry(user_id, device_id, timestamp DESC)
idx_telemetry_user_circuit    ON telemetry(user_id, circuit)
```

---

## How MQTT Provisioning Works

When a device is registered:
1. Backend generates a unique `device_id` and strong random password
2. Calls `mosquitto_passwd -b` to add credentials to the shared passwd file
3. Appends an ACL block (idempotent — skips if user block already present):
   ```
   user dev_abc123
   topic telemetry/user-uuid/dev_abc123/#
   ```
4. Sends `SIGHUP` to the Mosquitto process via `docker exec mosquitto kill -HUP 1` to hot-reload

The backend container has `mosquitto_passwd` installed and the Docker socket mounted for the HUP signal.
