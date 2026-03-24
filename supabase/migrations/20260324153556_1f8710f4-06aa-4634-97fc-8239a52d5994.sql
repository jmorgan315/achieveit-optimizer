
INSERT INTO storage.buckets (id, name, public)
VALUES ('page-images', 'page-images', true);

CREATE POLICY "Allow public read access on page-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'page-images');

CREATE POLICY "Allow service role insert on page-images"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'page-images');

CREATE POLICY "Allow service role delete on page-images"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'page-images');
