import { z } from 'zod';
import { restoreMobileState } from '@/db/mobile-sync';
import { stateSchema } from '@/lib/validation';
import { mobileFailure, mobileJson, readMobileJson, requireMobileAccount } from '@/lib/mobile-auth';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION } from '@/lib/mobile-protocol';
export const dynamic = 'force-dynamic';
const requestSchema = z.object({ operationId: z.string().uuid(), revision: z.number().int().min(0), generation: z.number().int().min(1), backup: stateSchema }).strict();
export async function POST(request: Request) {
  try {
    const { userId, name } = await requireMobileAccount(request);
    const parsed = requestSchema.safeParse(await readMobileJson(request));
    if (!parsed.success) return mobileJson({ error: '备份内容或恢复版本无效。', code: 'invalid_backup' }, 400);
    const { operationId, backup, revision: oldRevision, generation: oldGeneration } = parsed.data;
    const { state, revision, generation } = await restoreMobileState(userId, operationId, backup, oldRevision, oldGeneration);
    return mobileJson({ state, revision, generation, user: { userId, name }, serverTime: Date.now(), contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION });
  } catch (error) { return mobileFailure(error); }
}
