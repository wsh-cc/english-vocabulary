import { readMobileVersion } from '@/db/mobile-sync';
import { mobileFailure, mobileJson, requireMobileAccount } from '@/lib/mobile-auth';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION, type MobileSyncVersion } from '@/lib/mobile-protocol';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { userId, name } = await requireMobileAccount(request);
    const { revision, generation } = await readMobileVersion(userId);
    const version: MobileSyncVersion = {
      revision, generation, user: { userId, name }, serverTime: Date.now(),
      contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION,
    };
    return mobileJson(version);
  } catch (error) { return mobileFailure(error); }
}
