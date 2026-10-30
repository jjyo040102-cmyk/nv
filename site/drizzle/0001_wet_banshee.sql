CREATE TABLE `provider_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` text NOT NULL
);
