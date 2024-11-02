DO $$
BEGIN
  IF NOT EXISTS(
    SELECT
      1
    FROM
      pg_type
    WHERE
      typname = 'platform') THEN
  CREATE TYPE "public"."platform" AS ENUM(
    'leetcode',
    'codewars'
);
END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "hints"(
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "problem_id" uuid NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "authenticator"
  DROP CONSTRAINT IF EXISTS "authenticator_userId_credentialID_pk";

--> statement-breakpoint
ALTER TABLE "problems"
  ALTER COLUMN "tags" TYPE jsonb
  USING tags::jsonb;

--> statement-breakpoint
ALTER TABLE "problems"
  ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT
      1
    FROM
      information_schema.table_constraints
    WHERE
      constraint_name = 'authenticator_userid_credentialid_pk'
      AND table_name = 'authenticator') THEN
  ALTER TABLE "authenticator"
    ADD CONSTRAINT "authenticator_userid_credentialid_pk" PRIMARY KEY("userId", "credentialID");
END IF;
END
$$;

--> statement-breakpoint
ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "description_html" text;

--> statement-breakpoint
ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "title_slug" varchar(256);

--> statement-breakpoint
ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "platform" "platform" DEFAULT 'leetcode' NOT NULL;

--> statement-breakpoint
ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "stats" jsonb;

--> statement-breakpoint
ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "hints"
    ADD CONSTRAINT "hints_problem_id_problems_id_fk" FOREIGN KEY("problem_id") REFERENCES "public"."problems"("id") ON DELETE NO action ON UPDATE NO action;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;

--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tags";

