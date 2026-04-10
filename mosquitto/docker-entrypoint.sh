#!/bin/sh
set -e

PASSWD_FILE="/mosquitto/config/passwd"
ACL_FILE="/mosquitto/config/acl"

# Create passwd file if it doesn't exist
touch "$PASSWD_FILE"
chown mosquitto:mosquitto "$PASSWD_FILE"
chmod 640 "$PASSWD_FILE"
chown mosquitto:mosquitto /mosquitto/config/acl-test 2>/dev/null || true
chmod 640 /mosquitto/config/acl-test 2>/dev/null || true

# Always ensure backend_service user exists (idempotent)
mosquitto_passwd -b "$PASSWD_FILE" backend_service "$MQTT_BACKEND_PASSWORD"

# Create ACL file if it doesn't exist with backend_service entry
if [ ! -f "$ACL_FILE" ]; then
  cat > "$ACL_FILE" <<'EOF'
# Backend service - full access to all telemetry
user backend_service
topic telemetry/#

EOF
fi
chown mosquitto:mosquitto "$ACL_FILE"
chmod 640 "$ACL_FILE"

exec mosquitto -c /mosquitto/config/mosquitto.conf
