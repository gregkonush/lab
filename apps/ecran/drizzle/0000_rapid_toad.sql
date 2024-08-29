DO $$ BEGIN
 CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tags" AS ENUM('array', 'binary', 'bitwise', 'dynamic-programming', 'graph', 'greedy', 'hash-table', 'heap', 'math', 'number-theory', 'parsing', 'simulation', 'sorting', 'string', 'tree', 'two-pointers', 'binary-search', 'divide-and-conquer', 'depth-first-search', 'breadth-first-search', 'union-find', 'topological-sort', 'binary-tree', 'binary-search-tree', 'segment-tree', 'binary-indexed-tree', 'tree-decomposition', 'trie', 'djikstra', 'bellman-ford', 'floyd-warshall');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"tags" tags[] DEFAULT '{}'
);
