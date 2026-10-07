/**
 * Stage 8 (Oct 2026) · a sport's slug from its id, cached for the process
 * (the sports table changes only with a migration).
 */
import { supabase } from './supabase';

const cache = new Map<string, string | null>();

export async function sportSlugOf(sportId: string | null | undefined): Promise<string | null> {
  if (!sportId) return null;
  if (cache.has(sportId)) return cache.get(sportId) ?? null;
  const { data } = await supabase.from('sports').select('slug').eq('id', sportId).maybeSingle();
  const slug = (data as { slug?: string } | null)?.slug ?? null;
  if (slug) cache.set(sportId, slug);
  return slug;
}
