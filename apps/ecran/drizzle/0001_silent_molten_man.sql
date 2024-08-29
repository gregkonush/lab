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
ALTER TABLE "problems" ALTER COLUMN "difficulty" SET DATA TYPE difficulty;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "tags" tags[] DEFAULT '{}';