# Database schema and upgrade boundaries

The evaluation implementation uses PostgreSQL via Drizzle and the postgres client. The schema definitions, initial DDL and existing compatibility upgrades are centralized in [src/db.ts](../src/db.ts); there is no separate Drizzle migration directory or external SQL migration runner to merge in. This document describes the qualified behavior, not a new schema or upgrade certification.

## Current schema

| Tables | Purpose |
| --- | --- |
| `operations` | Durable idempotency keys, operation intent, target and observations |
| `account_keys`, `console_tickets`, `input_leases` | Scoped credentials, console grants and input ownership |
| `recordings` | Consented recording lifecycle and integrity metadata |
| `media_transfers`, `media_artifacts`, `media_stages` | Transfer/import status, registered artifacts and resumable staging |
| `network_grants`, `vm_activity`, `audit_events`, `api_rate` | Private connectivity, activity tracking, audit and account rate control |

The runtime reads `DATABASE_URL` from the environment and creates a bounded connection pool. Initialization creates tables and indexes if absent; legacy operation and console columns are added if absent. The media transfer byte column is widened to bigint and the original one-slot primary key is replaced with the composite computer/slot key, under a transaction-scoped advisory lock for that key change. The initialization is single-flight per process via [once-successful.ts](../src/once-successful.ts); failures allow a later readiness probe to retry. `databaseReady()` performs a live query after initialization. This is not a global lock around every DDL statement or a versioned transactional migration ledger.

## Evidence and limitations

The exact [hosted core workflow](https://github.com/everhush/vm_interface/actions/runs/46077980605) qualified fresh disposable deployment, durable operation behavior and restart recovery. Static tests and evidence were reviewed on `34652dc2fffd585e8e95aac1a2df63b3552da8f8`. These results do not certify every historical database version, concurrent upgrade pattern, rolling downgrade, point-in-time restore or production migration.

For fresh evaluation, follow the [device guide](device-validation.md); the application performs its initialization as part of normal readiness. Do not independently run extracted SQL against an existing database, substitute a new migration framework, change constraints, or make destructive schema changes to the qualified source simply to reorganize files. Keep database credentials and data outside source control.

For an existing installation, stop and plan an upgrade separately: identify its exact version and schema, back up database and persistent guest storage with authorized operator procedures, prove restore on a separate disposable environment, and test migration and concurrent service initialization on a representative copy before touching real data. Do not assume rolling upgrades or downgrades are safe. Production schema-version tracking, upgrade/rollback qualification and backup/recovery policy are additional release-hardening work, not evidence of independent native-device acceptance.
