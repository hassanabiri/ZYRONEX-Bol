REVOKE EXECUTE ON FUNCTION public.shares_workspace(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_workspace(uuid, uuid) TO authenticated;