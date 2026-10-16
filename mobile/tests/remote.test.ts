import { afterEach, describe, expect, it, vi } from 'vitest';
import { remote, RemoteError } from '../src/data';
import { native } from '../src/native';

afterEach(() => vi.restoreAllMocks());

describe('native HTTP response handling', () => {
  it('identifies an HTML access rejection instead of a generic service failure', async () => {
    vi.spyOn(native, 'request').mockResolvedValue({status: 403, body: '<html><title>Attention Required! | Cloudflare</title></html>'});
    await expect(remote.request('auth', 'POST', {action: 'login'})).rejects.toMatchObject({status: 403, code: 'access_blocked', message: expect.stringContaining('HTTP 403')});
  });

  it('rejects a non-object JSON success without treating it as account data', async () => {
    vi.spyOn(native, 'request').mockResolvedValue({status: 200, body: 'null'});
    await expect(remote.request('bootstrap', 'GET')).rejects.toMatchObject({status: 200, code: 'invalid_response'});
  });

  it('preserves an actual account authentication error', async () => {
    vi.spyOn(native, 'request').mockResolvedValue({status: 401, body: JSON.stringify({error: '用户名或密码不正确。', code: 'invalid_credentials'})});
    await expect(remote.request('auth', 'POST')).rejects.toEqual(new RemoteError('用户名或密码不正确。', 401, 'invalid_credentials'));
  });
});
