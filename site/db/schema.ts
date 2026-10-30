import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  sourceName: text('source_name').notNull(),
  sourceText: text('source_text').notNull(),
  participantsJson: text('participants_json').notNull(),
  recipient: text('recipient').notNull(),
  responseText: text('response_text').notNull(),
  expenseKrw: integer('expense_krw').notNull().default(0),
  isSample: integer('is_sample').notNull().default(0),
  status: text('status').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [index('tasks_owner_updated').on(table.ownerId, table.updatedAt)]);

export const events = sqliteTable('task_events', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('events_owner_task').on(table.ownerId, table.taskId)]);

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  format: text('format').notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('artifacts_owner_task').on(table.ownerId, table.taskId)]);

export const providerSettings = sqliteTable('provider_settings', {
  ownerId: text('owner_id').primaryKey(),
  model: text('model').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  iv: text('iv').notNull(),
  updatedAt: text('updated_at').notNull(),
});
