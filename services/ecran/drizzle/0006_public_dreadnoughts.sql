ALTER TYPE "language" ADD VALUE 'go';--> statement-breakpoint
ALTER TYPE "language" ADD VALUE 'rust';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid,
	"language" "language" NOT NULL,
	"starter_code" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "code_templates" ADD CONSTRAINT "code_templates_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
