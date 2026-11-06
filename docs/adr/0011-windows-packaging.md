# ADR-0011 — Windows packaging
Status: Accepted · 2026-11-06

## Decision
Inno Setup installer named from `PRODUCT_NAME`. It contains the official `node.exe` (LTS), the compiled API + production dependencies and PostgreSQL 16 portable binaries (EDB zip; the PostgreSQL licence allows redistribution). WinSW (MIT) registers two services, DB and API, with auto-start and restart on failure. The DB listens on 127.0.0.1 on a private port. DB passwords and the JWT secret are generated at install into a config file whose ACL allows only the service account and Administrators. Data, logs and backups live under `%ProgramData%\<PRODUCT_NAME>\`.

## Consequences
No Docker on lab machines. Code signing is a pre-production task. All paths and ports come from config, so the same API also runs in Docker or the cloud.
