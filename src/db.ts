import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {pgTable,text,jsonb,timestamp,primaryKey,integer} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
export const operations=pgTable("operations",{
 account:text("account").notNull(),key:text("key").notNull(),id:text("id").notNull().unique(),
 requestHash:text("request_hash").notNull(),status:text("status").notNull(),
 result:jsonb("result"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
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
let db:ReturnType<typeof drizzle>|undefined;
export function database(){
 if(!db){if(!process.env.DATABASE_URL)throw Error("Missing DATABASE_URL");db=drizzle(postgres(process.env.DATABASE_URL,{max:5,connect_timeout:10}));}
 return db;
}
export async function migrate(){
 await database().execute(sql`CREATE TABLE IF NOT EXISTS operations (
 account text NOT NULL, key text NOT NULL, id text NOT NULL UNIQUE, request_hash text NOT NULL,
 status text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,key))`);
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
}
