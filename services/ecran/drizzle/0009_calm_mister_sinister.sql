CREATE TYPE "public"."platform" AS ENUM('leetcode', 'codewars');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authenticator" DROP CONSTRAINT "authenticator_userId_credentialID_pk";--> statement-breakpoint
ALTER TABLE "problems" ALTER COLUMN "tags" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "problems" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_userid_credentialid_pk" PRIMARY KEY("userId","credentialID");--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "description_html" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "title_slug" varchar(256);--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "platform" "platform" DEFAULT 'leetcode' NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hints" ADD CONSTRAINT "hints_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TYPE "public"."tags";