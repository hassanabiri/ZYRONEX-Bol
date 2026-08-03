CREATE OR REPLACE FUNCTION public.report_marketplace_review(_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.marketplace_reviews r
  SET reported = true
  WHERE r.id = _review_id
    AND EXISTS (
      SELECT 1 FROM public.marketplace_products p
      WHERE p.id = r.product_id
        AND (p.status = 'published' OR public.is_workspace_member(p.workspace_id, auth.uid()))
    );
END; $$;
REVOKE EXECUTE ON FUNCTION public.report_marketplace_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_marketplace_review(uuid) TO authenticated;