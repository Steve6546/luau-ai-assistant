
-- Conversations
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  project_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conv select" ON public.conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own conv insert" ON public.conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own conv update" ON public.conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own conv delete" ON public.conversations FOR DELETE USING (auth.uid() = user_id);

-- Messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msg select" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);
CREATE POLICY "msg insert" ON public.messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);
CREATE POLICY "msg delete" ON public.messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);

-- Tasks
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tool TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task select" ON public.tasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);
CREATE POLICY "task insert" ON public.tasks FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);
CREATE POLICY "task update" ON public.tasks FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);
CREATE POLICY "task delete" ON public.tasks FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
);

-- Projects
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proj select" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "proj insert" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "proj update" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "proj delete" ON public.projects FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at);
CREATE INDEX idx_conv_user ON public.conversations(user_id, updated_at DESC);
CREATE INDEX idx_tasks_conv ON public.tasks(conversation_id, created_at);
