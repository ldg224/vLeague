-- vLeague 0.4.0: managers may only ADD crest files (each upload gets a new name); only the league office may
-- replace or delete one. Before this, a manager could overwrite their club's live crest file and skip approval.
-- Safe to re-run.

drop policy if exists crests_update on storage.objects;
create policy crests_update on storage.objects for update to authenticated
  using (bucket_id = 'crests' and public.is_office());

drop policy if exists crests_delete on storage.objects;
create policy crests_delete on storage.objects for delete to authenticated
  using (bucket_id = 'crests' and public.is_office());
