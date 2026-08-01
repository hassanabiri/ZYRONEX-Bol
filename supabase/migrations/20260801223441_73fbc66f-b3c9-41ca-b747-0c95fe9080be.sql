CREATE OR REPLACE FUNCTION public.shares_workspace(_user_id uuid, _other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members a
    JOIN public.workspace_members b ON a.workspace_id = b.workspace_id
    WHERE a.user_id = _user_id AND b.user_id = _other_user_id
  );
$$;

CREATE POLICY "profiles_select_workspace_peers" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.shares_workspace(auth.uid(), id));