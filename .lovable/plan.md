

## Fix Security Scan Issues

Six changes across one SQL migration and one auth config call.

### Migration SQL

```sql
-- (1) & (3) & (6): Drop all existing public storage policies on page-images
DROP POLICY IF EXISTS "Allow service role delete on page-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role insert on page-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access on page-images" ON storage.objects;

-- (6): Make bucket private
UPDATE storage.buckets SET public = false WHERE id = 'page-images';

-- (1): DELETE restricted to service role only (no client-side policy needed)
-- Edge functions use service role which bypasses RLS — no explicit policy needed.

-- (3): INSERT restricted to authenticated (safety net; edge functions use service role)
CREATE POLICY "Authenticated users insert page-images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'page-images');

-- (3) & (6): SELECT restricted to authenticated users
CREATE POLICY "Authenticated users read page-images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'page-images');

-- (2): Fix user_profiles self-escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND is_admin = (SELECT up.is_admin FROM public.user_profiles up WHERE up.id = auth.uid())
  );

-- (4): Remove Realtime from processing_sessions (app uses polling)
ALTER PUBLICATION supabase_realtime DROP TABLE public.processing_sessions;
```

### Auth config call

**(5)**: Use `configure_auth` tool to enable `password_hibp_enabled: true`.

### Why this works

- **Storage**: All storage access is via edge functions using the service role (bypasses RLS). The authenticated policies are a safety net. No client code references `page-images`.
- **DELETE**: No explicit DELETE policy = no one except service role can delete.
- **user_profiles**: The WITH CHECK subquery reads the user's *current* `is_admin` value, preventing them from changing it. Admins use the separate "Admins can update all profiles" policy.
- **Realtime**: The app doesn't use Realtime subscriptions — removing the publication eliminates the finding entirely.

### Files modified

| Target | Change |
|--------|--------|
| SQL migration | Drop public storage policies, make bucket private, add authenticated-only policies, fix user_profiles WITH CHECK, drop Realtime publication |
| Auth config | Enable leaked password protection (HIBP) |

No code changes needed — edge functions use service role which bypasses all policies.

