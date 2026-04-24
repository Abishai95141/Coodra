ALTER TABLE "run_events" DROP CONSTRAINT "run_events_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_events" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;