import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {pgTable,text,jsonb,timestamp,primaryKey,integer,bigint} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
export const operations=pgTable("operations",{
 account:text("account").notNull(),key:text("key").notNull(),id:text("id").notNull().unique(),
 requestHash:text("request_hash").notNull(),status:text("status").notNull(),
 result:jsonb("result"),intent:jsonb("intent"),target:jsonb("target"),observation:jsonb("observation"),observedAt:timestamp("observed_at",{withTimezone:true}),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
},t=>[primaryKey({columns:[t.account,t.key]})]);
export const consoleTickets=pgTable("console_tickets",{
 id:text("id").primaryKey(),account:text("account").notNull(),computerId:text("computer_id").notNull(),
 instanceUid:text("instance_uid").notNull(),scope:text("scope").notNull().default("screenshot-only"),actor:text("actor").notNull().default("observer"),issuedKeyId:text("issued_key_id"),tokenHash:text("token_hash").notNull().unique(),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
 expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true})
});
export const accountKeys=pgTable("account_keys",{
 id:text("id").primaryKey(),account:text("account").notNull(),label:text("label").notNull(),
 permission:text("permission").notNull(),tokenHash:text("token_hash").notNull().unique(),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
 expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true}),
 lastUsedAt:timestamp("last_used_at",{withTimezone:true})
});
export const inputLeases=pgTable("input_leases",{
 computerId:text("computer_id").primaryKey(),account:text("account").notNull(),
 instanceUid:text("instance_uid").notNull(),ticketId:text("ticket_id").notNull(),
 actor:text("actor").notNull(),generation:integer("generation").notNull(),
 expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
 updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()
});
export const recordings=pgTable("recordings",{
 id:text("id").primaryKey(),account:text("account").notNull(),computerId:text("computer_id").notNull(),
 instanceUid:text("instance_uid").notNull(),status:text("status").notNull(),
 maxSeconds:integer("max_seconds").notNull(),consentAt:timestamp("consent_at",{withTimezone:true}).notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
 startedAt:timestamp("started_at",{withTimezone:true}),stopRequestedAt:timestamp("stop_requested_at",{withTimezone:true}),
 finishedAt:timestamp("finished_at",{withTimezone:true}),heartbeatAt:timestamp("heartbeat_at",{withTimezone:true}),
 workerId:text("worker_id"),durationMs:integer("duration_ms"),bytes:integer("bytes"),sha256:text("sha256"),error:text("error")
});
export const mediaTransfers=pgTable("media_transfers",{
 computerId:text("computer_id").notNull(),account:text("account").notNull(),slot:text("slot").notNull(),
 dvUid:text("dv_uid").notNull(),operationId:text("operation_id").notNull(),sha256:text("sha256").notNull(),
 bytes:bigint("bytes",{mode:"number"}).notNull(),state:text("state").notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()
},t=>[primaryKey({columns:[t.computerId,t.slot]})]);
export const mediaArtifacts=pgTable("media_artifacts",{
 id:text("id").primaryKey(),account:text("account").notNull(),spec:jsonb("spec").notNull(),
 bytes:bigint("bytes",{mode:"number"}).notNull(),state:text("state").notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
export const mediaStages=pgTable("media_stages",{
 computerId:text("computer_id").primaryKey(),account:text("account").notNull(),slot:text("slot").notNull(),dvUid:text("dv_uid").notNull(),stageId:text("stage_id").notNull().unique(),sha256:text("sha256").notNull(),bytes:bigint("bytes",{mode:"number"}).notNull(),received:bigint("received",{mode:"number"}).notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()
});
export const networkGrants=pgTable("network_grants",{
 id:text("id").primaryKey(),account:text("account").notNull(),computerId:text("computer_id").notNull(),instanceUid:text("instance_uid").notNull(),
 port:integer("port").notNull(),tokenHash:text("token_hash").notNull().unique(),
 issuedKeyId:text("issued_key_id"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
 expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true})
});
export const vmActivity=pgTable("vm_activity",{
 computerId:text("computer_id").primaryKey(),account:text("account").notNull(),vmUid:text("vm_uid").notNull(),
 instanceUid:text("instance_uid"),lastActivity:timestamp("last_activity",{withTimezone:true}).notNull()
});
export const auditEvents=pgTable("audit_events",{
 id:text("id").primaryKey(),account:text("account").notNull(),actor:text("actor").notNull(),
 method:text("method").notNull(),group:text("route_group").notNull(),computerId:text("computer_id"),
 status:integer("status").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
let db:ReturnType<typeof drizzle>|undefined;
export function database(){
 if(!db){if(!process.env.DATABASE_URL)throw Error("Missing DATABASE_URL");db=drizzle(postgres(process.env.DATABASE_URL,{max:5,connect_timeout:10}));}
 return db;
}
export async function migrate(){
 await database().execute(sql`CREATE TABLE IF NOT EXISTS operations (
 account text NOT NULL, key text NOT NULL, id text NOT NULL UNIQUE, request_hash text NOT NULL,
 status text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,key))`);
 await database().execute(sql`ALTER TABLE operations ADD COLUMN IF NOT EXISTS intent jsonb`);
 await database().execute(sql`ALTER TABLE operations ADD COLUMN IF NOT EXISTS target jsonb`);
 await database().execute(sql`ALTER TABLE operations ADD COLUMN IF NOT EXISTS observation jsonb`);
 await database().execute(sql`ALTER TABLE operations ADD COLUMN IF NOT EXISTS observed_at timestamptz`);
 await database().execute(sql`ALTER TABLE operations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS operations_account_created_idx ON operations(account,created_at DESC)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS operations_reconcile_idx ON operations(status,observed_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS console_tickets (
 id text PRIMARY KEY, account text NOT NULL, computer_id text NOT NULL, instance_uid text NOT NULL,
 token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz)`);
 await database().execute(sql`ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'screenshot-only'`);
 await database().execute(sql`ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'observer'`);
 await database().execute(sql`ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS issued_key_id text`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS console_tickets_owner_idx ON console_tickets(account,computer_id,expires_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS account_keys (
 id text PRIMARY KEY, account text NOT NULL, label text NOT NULL, permission text NOT NULL CHECK (permission IN ('read','manage')),
 token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, last_used_at timestamptz)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS account_keys_owner_idx ON account_keys(account,expires_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS input_leases (
 computer_id text PRIMARY KEY, account text NOT NULL, instance_uid text NOT NULL, ticket_id text NOT NULL,
 actor text NOT NULL, generation integer NOT NULL, expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now())`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS recordings (
 id text PRIMARY KEY, account text NOT NULL, computer_id text NOT NULL, instance_uid text NOT NULL,
 status text NOT NULL, max_seconds integer NOT NULL CHECK(max_seconds BETWEEN 3 AND 120), consent_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, stop_requested_at timestamptz,
 finished_at timestamptz, heartbeat_at timestamptz, worker_id text, duration_ms integer, bytes integer, sha256 text, error text)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS recordings_owner_idx ON recordings(account,computer_id,created_at)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS recordings_worker_idx ON recordings(status,created_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS media_transfers (
 computer_id text NOT NULL, account text NOT NULL, slot text NOT NULL, dv_uid text NOT NULL,
 operation_id text NOT NULL, sha256 text NOT NULL, bytes bigint NOT NULL, state text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(computer_id,slot))`);
 await database().execute(sql`ALTER TABLE media_transfers ALTER COLUMN bytes TYPE bigint`);
 // Migrate the original one-slot primary key atomically, preserving all media evidence.
 await database().execute(sql`DO $media_migration$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vm-interface:media-schema',0));
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='media_transfers'::regclass AND contype='p' AND array_length(conkey,1)=1) THEN
 ALTER TABLE media_transfers DROP CONSTRAINT media_transfers_pkey, ADD PRIMARY KEY(computer_id,slot);
 END IF;
 END; $media_migration$`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS media_artifacts (id text PRIMARY KEY, account text NOT NULL, spec jsonb NOT NULL, bytes bigint NOT NULL CHECK(bytes BETWEEN 512 AND 67108864), state text NOT NULL CHECK(state IN ('registered','verified')), created_at timestamptz NOT NULL DEFAULT now())`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS media_artifacts_owner_idx ON media_artifacts(account)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS media_stages (computer_id text PRIMARY KEY, account text NOT NULL, slot text NOT NULL, dv_uid text NOT NULL, stage_id text NOT NULL UNIQUE, sha256 text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0), received bigint NOT NULL CHECK(received>=0 AND received<=bytes), updated_at timestamptz NOT NULL DEFAULT now())`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS media_stages_updated_idx ON media_stages(updated_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS network_grants (
 id text PRIMARY KEY, account text NOT NULL, computer_id text NOT NULL, instance_uid text NOT NULL,
 port integer NOT NULL CHECK(port BETWEEN 1 AND 65535), token_hash text NOT NULL UNIQUE, issued_key_id text,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS network_grants_owner_idx ON network_grants(account,computer_id,expires_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS vm_activity (computer_id text PRIMARY KEY, account text NOT NULL, vm_uid text NOT NULL, instance_uid text, last_activity timestamptz NOT NULL)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS vm_activity_last_idx ON vm_activity(last_activity)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, account text NOT NULL, actor text NOT NULL, method text NOT NULL, route_group text NOT NULL, computer_id text, status integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS audit_owner_idx ON audit_events(account,created_at DESC)`);
 await database().execute(sql`CREATE INDEX IF NOT EXISTS audit_age_idx ON audit_events(created_at)`);
 await database().execute(sql`CREATE TABLE IF NOT EXISTS api_rate (account text PRIMARY KEY, window_start bigint NOT NULL, count integer NOT NULL)`);
}
