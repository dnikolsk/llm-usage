import { pgTable, text, boolean, integer, timestamp, jsonb, real, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id:text('id').primaryKey(), ownerId:text('owner_id').notNull().default('personal'), provider:text('provider').notNull(),
  label:text('label').notNull(), plan:text('plan'), accountType:text('account_type').notNull().default('personal'),
  enabled:boolean('enabled').notNull().default(true), collectorType:text('collector_type').notNull().default('local_collector'),
  capabilities:jsonb('capabilities').$type<string[]>().notNull().default([]), modelClasses:jsonb('model_classes').$type<string[]>().notNull().default([]),
  priority:integer('priority').notNull().default(0), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
});
export const usageSnapshots = pgTable('usage_snapshots', {
  id:uuid('id').primaryKey().defaultRandom(), accountId:text('account_id').notNull().references(()=>accounts.id),
  idempotencyKey:text('idempotency_key').notNull(), payloadHash:text('payload_hash').notNull(), observedAt:timestamp('observed_at',{withTimezone:true}).notNull(),
  ingestedAt:timestamp('ingested_at',{withTimezone:true}).notNull().defaultNow(), status:text('status').notNull(),
  metadata:jsonb('raw_metadata').$type<Record<string,unknown>>().notNull().default({})
}, t => [uniqueIndex('snapshots_idempotency_key_uq').on(t.idempotencyKey),index('snapshots_account_observed_idx').on(t.accountId,t.observedAt)]);
export const usageBuckets = pgTable('usage_buckets', {
  id:uuid('id').primaryKey().defaultRandom(), snapshotId:uuid('snapshot_id').notNull().references(()=>usageSnapshots.id),
  providerBucketId:text('provider_bucket_id').notNull(), kind:text('kind').notNull(), scope:text('scope').notNull(),unit:text('unit').notNull(),
  used:real('used'), limit:real('limit_value'), remaining:real('remaining'), usedFraction:real('used_fraction'),remainingFraction:real('remaining_fraction'),
  windowStartedAt:timestamp('window_started_at',{withTimezone:true}),resetAt:timestamp('reset_at',{withTimezone:true}),
  source:text('source').notNull(), confidence:text('confidence').notNull(),metadata:jsonb('metadata').$type<Record<string,unknown>>().notNull().default({})
},t=>[uniqueIndex('buckets_snapshot_provider_id_uq').on(t.snapshotId,t.providerBucketId)]);
export const routingPolicies = pgTable('routing_policies', {
  id:uuid('id').primaryKey().defaultRandom(), ownerId:text('owner_id').notNull(),name:text('name').notNull(),
  isDefault:boolean('is_default').notNull().default(false), configuration:jsonb('configuration_json').$type<Record<string,unknown>>().notNull().default({}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
});
