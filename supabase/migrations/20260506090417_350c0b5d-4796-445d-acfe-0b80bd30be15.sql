CREATE TABLE public.snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  snapshot_data jsonb NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_conversation ON public.snapshots(conversation_id);
CREATE INDEX idx_snapshots_task ON public.snapshots(task_id);

ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snap select" ON public.snapshots FOR SELECT
USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = snapshots.conversation_id AND c.user_id = auth.uid()));

CREATE POLICY "snap insert" ON public.snapshots FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = snapshots.conversation_id AND c.user_id = auth.uid()));

CREATE POLICY "snap update" ON public.snapshots FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = snapshots.conversation_id AND c.user_id = auth.uid()));

CREATE POLICY "snap delete" ON public.snapshots FOR DELETE
USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = snapshots.conversation_id AND c.user_id = auth.uid()));

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES public.snapshots(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approved boolean;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS diff_original text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS diff_new text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS script_path text;