import { readMobileState } from '@/db/mobile-sync';
import { mobileFailure, mobileJson, requireMobileAccount } from '@/lib/mobile-auth';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION } from '@/lib/mobile-protocol';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { userId, name } = await requireMobileAccount(request);
    const { state, revision, generation } = await readMobileState(userId);
    return mobileJson({ state, revision, generation, user: { userId, name }, serverTime: Date.now(), contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION });
  } catch (error) { return mobileFailure(error); }
}
