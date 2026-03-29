#!/bin/bash
printf 'YT_API_KEY=%s\nGOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\nRESEND_API_KEY=%s\nADMIN_EMAIL=%s\nADMIN_SECRET=%s\n' \
  "$GOOGLE_API_KEY" "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET" \
  "$RESEND_API_KEY" "$ADMIN_EMAIL" "$ADMIN_SECRET" > .dev.vars

export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

exec npx wrangler pages dev dist --d1=DB --local --ip 0.0.0.0 --port 5000
