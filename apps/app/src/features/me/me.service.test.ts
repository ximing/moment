import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import type { UserProfile } from '@moment/dto';
import { MeService } from './me.service';
import { AuthService } from '../../services/auth.service';

const api = vi.hoisted(() => ({
  updateMe: vi.fn(),
  changePassword: vi.fn(),
  me: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  client: api,
}));
vi.mock('../../lib/media', () => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
}));
vi.mock('../../lib/token-store', () => ({
  loadUser: vi.fn(async () => null),
  onAuthCleared: vi.fn(),
  saveUser: vi.fn(),
  secureTokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
}));

register(AuthService);
register(MeService);

const USER: UserProfile = {
  id: 'user-1',
  email: 'man@moment.test',
  nickname: '林晓满',
  avatarColor: null,
  avatarIcon: null,
  avatarUrl: null,
  avatarExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function svc(): MeService {
  return resolve(MeService);
}

beforeEach(() => {
  vi.clearAllMocks();
  const me = svc();
  me.nicknameDraft = '';
  me.oldPasswordDraft = '';
  me.newPasswordDraft = '';
  me.confirmPasswordDraft = '';
});

describe('MeService 账号边界', () => {
  it('空白或超长昵称不提交，首尾空白按 schema 去掉再提交', async () => {
    const me = svc();
    for (const nickname of ['', '   ', '名'.repeat(51)]) {
      me.nicknameDraft = nickname;
      await expect(me.saveNickname()).rejects.toThrow('昵称需 1–50 字');
    }
    expect(api.updateMe).not.toHaveBeenCalled();

    api.updateMe.mockResolvedValue({ ...USER, nickname: '小林' });
    me.nicknameDraft = '  小林  ';
    await me.saveNickname();
    expect(api.updateMe).toHaveBeenCalledWith({ nickname: '小林' });
    expect(me.nicknameDraft).toBe('  小林  ');
  });

  it('改密：空旧密码、长度、不一致不提交；超长旧密码仍提交并清空草稿', async () => {
    const me = svc();
    me.oldPasswordDraft = '';
    me.newPasswordDraft = '1234567';
    me.confirmPasswordDraft = '1234567';
    await expect(me.changePassword()).rejects.toThrow('请输入旧密码');

    me.oldPasswordDraft = 'old-secret';
    me.newPasswordDraft = '1234567';
    me.confirmPasswordDraft = '1234567';
    await expect(me.changePassword()).rejects.toThrow('新密码需 8–72 位');

    me.newPasswordDraft = 'a'.repeat(73);
    me.confirmPasswordDraft = 'a'.repeat(73);
    await expect(me.changePassword()).rejects.toThrow('新密码需 8–72 位');

    me.newPasswordDraft = 'new-secret-1';
    me.confirmPasswordDraft = 'new-secret-2';
    await expect(me.changePassword()).rejects.toThrow('两次输入的新密码不一致');
    expect(api.changePassword).not.toHaveBeenCalled();
    expect(me.oldPasswordDraft).toBe('old-secret');
    expect(me.newPasswordDraft).toBe('new-secret-1');
    expect(me.confirmPasswordDraft).toBe('new-secret-2');

    const oldPassword = 'o'.repeat(73);
    me.oldPasswordDraft = oldPassword;
    me.confirmPasswordDraft = 'new-secret-1';
    api.changePassword.mockResolvedValue(undefined);
    await me.changePassword();
    expect(api.changePassword).toHaveBeenCalledWith({
      oldPassword,
      newPassword: 'new-secret-1',
    });
    expect(me.oldPasswordDraft).toBe('');
    expect(me.newPasswordDraft).toBe('');
    expect(me.confirmPasswordDraft).toBe('');
  });
});
