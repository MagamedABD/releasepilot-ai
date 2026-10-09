import { fromPostgres, isUuid, noContent, notFound, unauthorized } from '@/lib/api/http';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(_request: Request, { params }: RouteContext<'/api/absences/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { error } = await supabase.from('absences').delete().eq('id', id);
  if (error) return fromPostgres(error);
  return noContent();
}
