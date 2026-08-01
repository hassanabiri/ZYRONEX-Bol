-- avatars: files stored under <user_id>/...
CREATE POLICY "avatars_own_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_own_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_own_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_own_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- workspace-scoped buckets: files stored under <workspace_id>/...
CREATE POLICY "workspace_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('workspace-assets','knowledge-files','voice-recordings','documents')
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );
CREATE POLICY "workspace_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('workspace-assets','knowledge-files','voice-recordings','documents')
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.has_workspace_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])
  );
CREATE POLICY "workspace_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('workspace-assets','knowledge-files','voice-recordings','documents')
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.has_workspace_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])
  )
  WITH CHECK (
    bucket_id IN ('workspace-assets','knowledge-files','voice-recordings','documents')
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.has_workspace_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])
  );
CREATE POLICY "workspace_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('workspace-assets','knowledge-files','voice-recordings','documents')
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.has_workspace_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner','admin','member']::workspace_role[])
  );