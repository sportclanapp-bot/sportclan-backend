-- SC-350 · multi-image posts.
--
-- The composer has always offered 4 attachments ("IMAGES · n/4") but
-- community_posts only had a single `image_url` column, and createPost stored
-- `media_urls[0]`. Images 2-4 were silently dropped — the API returned 201 with
-- no warning and the extra uploads were orphaned in R2.
--
-- `image_url` STAYS as the first image so every existing reader (feed card,
-- detail, share preview, story counts) keeps working untouched; `media_urls`
-- carries the full ordered set and the readers prefer it when present.
--
-- Backfill makes existing single-image posts self-consistent, so a reader can
-- rely on media_urls alone for any post that has an image.

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_urls TEXT[];

UPDATE community_posts
   SET media_urls = ARRAY[image_url]
 WHERE image_url IS NOT NULL
   AND image_url <> ''
   AND media_urls IS NULL;

COMMENT ON COLUMN community_posts.media_urls IS
  'SC-350: ordered post images (max 4). image_url mirrors media_urls[1] for legacy readers.';
