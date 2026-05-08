
-- Live console/log events streamed from the Roblox MCP bridge
CREATE TABLE public.studio_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL,
  task_id uuid,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_studio_logs_conv ON public.studio_logs(conversation_id, created_at DESC);
CREATE INDEX idx_studio_logs_task ON public.studio_logs(task_id, created_at DESC);
ALTER TABLE public.studio_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio_logs select" ON public.studio_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = studio_logs.conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "studio_logs insert" ON public.studio_logs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = studio_logs.conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "studio_logs delete" ON public.studio_logs FOR DELETE
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = studio_logs.conversation_id AND c.user_id = auth.uid()));

-- Audit trail for every MCP tool call
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  conversation_id uuid,
  task_id uuid,
  tool text NOT NULL,
  action text NOT NULL,
  arguments jsonb,
  result_status text,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_conv ON public.audit_logs(conversation_id, created_at DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs select own" ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "audit_logs insert own" ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Mark snapshot_data optionally compressed (gzip+base64 wrapped as { _gz: true, data: "..." })
COMMENT ON COLUMN public.snapshots.snapshot_data IS
  'Snapshot payload. If wrapped as {"_gz":true,"data":"<base64 gzip>"} it is compressed.';
