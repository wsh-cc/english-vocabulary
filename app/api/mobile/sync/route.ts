import { z } from 'zod';
import { applyMobileOperation, mobileOperationSchema, readMobileState } from '@/db/mobile-sync';
import { mobileFailure, mobileJson, readMobileJson, requireMobileAccount } from '@/lib/mobile-auth';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_SYNC_BATCH_SIZE, type MobileConflict } from '@/lib/mobile-protocol';
export const dynamic = 'force-dynamic';
const requestSchema = z.object({ operations: z.array(mobileOperationSchema).max(MOBILE_SYNC_BATCH_SIZE) }).strict();
export async function POST(request: Request) {
  try {
    const user = await requireMobileAccount(request);
    const parsed = requestSchema.safeParse(await readMobileJson(request));
    if (!parsed.success) return mobileJson({ error: `同步格式不正确，每批最多 ${MOBILE_SYNC_BATCH_SIZE} 条操作。`, code: 'invalid_request' }, 400);
    if (parsed.data.operations.some(operation => operation.deviceId !== user.deviceId)) return mobileJson({ error: '操作设备与登录会话不一致。', code: 'device_mismatch' }, 403);
    const accepted: string[] = [], conflicts: MobileConflict[] = [], idMap: Record<string, string> = {};
    for (const operation of parsed.data.operations) {
      const result = await applyMobileOperation(user.userId, operation, 'mobile', undefined, idMap);
      if (result.accepted) { accepted.push(operation.operationId); Object.assign(idMap, result.idMap); }
      else if (result.conflict) conflicts.push(result.conflict);
    }
    const { state, revision, generation } = await readMobileState(user.userId);
    return mobileJson({ state, revision, generation, user: { userId: user.userId, name: user.name }, serverTime: Date.now(), contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION, accepted, conflicts, idMap });
  } catch (error) { return mobileFailure(error); }
}
