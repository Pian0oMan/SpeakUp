-- UPDATE: pictures on flashcards (from imported Anki decks).
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN.
--
-- The pictures are shrunk IN THE BROWSER (to small WebP images, a few KB each) and
-- uploaded straight to Supabase Storage, so our own server never handles them.
-- Each person's pictures live in their own folder:  card-images/<their user id>/<deck id>/...

-- Which picture a card shows (a path inside the card-images bucket), or null
alter table flashcards add column if not exists image text;

-- The bucket ("folder") for the pictures.
--   public = true: a picture can be shown with a plain link (the links are long and random)
--   file_size_limit: 100 KB per picture, so nobody can upload huge files
--   allowed_mime_types: pictures only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 102400, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- I can only add, see the list of, and delete pictures in MY OWN folder
drop policy if exists "Upload my card pictures" on storage.objects;
create policy "Upload my card pictures" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "List my card pictures" on storage.objects;
create policy "List my card pictures" on storage.objects
  for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Delete my card pictures" on storage.objects;
create policy "Delete my card pictures" on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
