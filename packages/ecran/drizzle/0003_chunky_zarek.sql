DO $$ BEGIN
 CREATE TYPE "public"."language" AS ENUM('python', 'java', 'javascript', 'typescript');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"output" text NOT NULL,
	"language" "language" NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
