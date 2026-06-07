import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainColor, ChainDto, ChainIcon, ShareLinkDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { fallbackChainColor } from '@/lib/chain-color';
import { humanError } from '@/lib/errors';
import { canInvite, isOwner, roleLabel } from '@/lib/roles';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { Field, Input, Textarea } from '@/ui/Field';
import { Avatar } from '@/ui/Avatar';

type Section = 'share' | 'members' | 'profile';

export function ChainSettings({ chain }: { chain: ChainDto }) {
  const owner = isOwner(chain);
  const [section, setSection] = useState<Section>(owner ? 'share' : 'members');
  const items: { key: Section; label: string; show: boolean }[] = [
    { key: 'share', label: '分享', show: owner },
    { key: 'members', label: '成员', show: true },
    { key: 'profile', label: '资料', show: owner },
  ];

  return (
    <div>
      <nav className="mb-6 flex flex-wrap gap-2">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => setSection(i.key)}
              className={
                section === i.key
                  ? 'whitespace-nowrap rounded-sticker bg-select px-3 py-1.5 text-sm text-select-fg'
                  : 'whitespace-nowrap rounded-sticker bg-surface px-3 py-1.5 text-sm text-muted elev-sm hover:text-ink'
              }
            >
              {i.label}
            </button>
          ))}
      </nav>
      <div>
        {section === 'share' && owner && <ShareSection chainId={chain.id} />}
        {section === 'members' && <MembersSection chain={chain} />}
        {section === 'profile' && owner && <ProfileSection chain={chain} />}
      </div>
    </div>
  );
}

function ShareSection({ chainId }: { chainId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [expire, setExpire] = useState<'never' | '7' | '30' | 'date'>('never');
  const [date, setDate] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: qk.shareLinks(chainId),
    queryFn: () => client.listShareLinks(chainId),
  });

  const create = useMutation({
    mutationFn: () => {
      let expiresAt: string | undefined;
      if (expire === '7') expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
      if (expire === '30') expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
      if (expire === 'date' && date) expiresAt = new Date(date).toISOString();
      return client.createShareLink(chainId, expiresAt ? { expiresAt } : {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.shareLinks(chainId) });
      setError(null);
    },
    onError: (e) => setError(humanError(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => client.revokeShareLink(id),
    onSuccess: () => {
      setRevokeId(null);
      void queryClient.invalidateQueries({ queryKey: qk.shareLinks(chainId) });
    },
    onError: (e) => setError(humanError(e)),
  });

  function copy(link: ShareLinkDto) {
    const url = `${window.location.origin}/share/${link.token}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(link.id);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="space-y-4">
      {/* 标题文字不在得意黑字形子集（scripts/font-glyphs.txt）内，不用 font-display */}
      <h2 className="text-lg font-medium">给长辈看这条链</h2>
      <p className="text-sm text-muted">生成一条链接，长辈不用登录就能顺着日子看。</p>
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 min-[560px]:flex-row min-[560px]:items-center">
          <select
            value={expire}
            onChange={(e) => setExpire(e.target.value as typeof expire)}
            className="h-10 min-w-0 rounded-sticker border border-line bg-bg px-3 text-sm text-ink focus:border-action"
          >
            <option value="never">永不过期</option>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="date">指定日期</option>
          </select>
          {expire === 'date' && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 min-w-0 rounded-sticker border border-line bg-bg px-3 text-sm text-ink focus:border-action"
            />
          )}
          <Button className="min-[560px]:ml-auto" disabled={create.isPending} onClick={() => create.mutate()}>
            生成分享链接
          </Button>
        </div>
      </div>
      {error && <Banner>{error}</Banner>}
      <ul className="space-y-2">
        {(data?.items ?? []).map((link) => {
          const status = linkStatus(link);
          return (
            <li key={link.id} className={`flex flex-wrap items-center gap-2 rounded-card border p-3 text-sm ${SHARE_STATUS_CLASS[status]}`}>
              <span className="min-w-0 text-muted">{new Date(link.createdAt).toLocaleString()}</span>
              <span>{status}</span>
              {link.expiresAt && <span className="text-muted">到期 {new Date(link.expiresAt).toLocaleDateString()}</span>}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {status === '有效' && (
                  <Button variant="ghost" size="sm" onClick={() => copy(link)}>
                    {copied === link.id ? '已复制' : '复制链接'}
                  </Button>
                )}
                {status !== '已吊销' && (
                  <Button variant="quiet" size="sm" onClick={() => setRevokeId(link.id)}>
                    吊销
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {revokeId && (
        <Confirm
          title="吊销这条链接？"
          body="长辈将立刻打不开这本相册。"
          confirmLabel="吊销"
          danger
          busy={revoke.isPending}
          onCancel={() => setRevokeId(null)}
          onConfirm={() => revoke.mutate(revokeId)}
        />
      )}
    </div>
  );
}

function linkStatus(link: ShareLinkDto): string {
  if (link.revokedAt) return '已吊销';
  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) return '已过期';
  return '有效';
}

/** 分享链接贴纸卡三态色（spec §7：有效=薄荷、已过期=黄、已吊销=灰）。 */
const SHARE_STATUS_CLASS: Record<string, string> = {
  有效: 'bg-sticker-mint border-sticker-mint-line',
  已过期: 'bg-select border-stroke',
  // 灰系：spec 无灰 token，用 --line 低饱和表达；color-mix arbitrary（var() 色值的 /40 修饰静默不生成，硬约束）
  已吊销: 'border-line bg-[color-mix(in_srgb,var(--line)_40%,transparent)] text-muted',
};

function MembersSection({ chain }: { chain: ChainDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const owner = isOwner(chain);
  const inviteOk = canInvite(chain);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferName, setTransferName] = useState('');
  const { data: members } = useQuery({
    queryKey: qk.chainMembers(chain.id),
    queryFn: () => client.listMembers(chain.id),
  });
  const { data: invites } = useQuery({
    queryKey: qk.chainInvites(chain.id),
    queryFn: () => client.listInvites(chain.id),
    enabled: inviteOk,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chainMembers(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chainInvites(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chain(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chains });
  };

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: 'editor' | 'viewer' }) => client.updateMemberRole(chain.id, v.userId, v.role),
    onSuccess: invalidate,
    onError: (e) => setError(humanError(e)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => client.removeMember(chain.id, userId),
    onSuccess: invalidate,
    onError: (e) => setError(humanError(e)),
  });
  const leave = useMutation({
    mutationFn: () => client.removeMember(chain.id, user!.id),
    onSuccess: () => {
      invalidate();
      navigate('/');
    },
    onError: (e) => setError(humanError(e)),
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => client.transferChain(chain.id, userId),
    onSuccess: () => {
      setTransferId(null);
      setTransferName('');
      invalidate();
    },
    onError: (e) => setError(humanError(e)),
  });
  const invite = useMutation({
    mutationFn: () => client.createInvite(chain.id, { email: email.trim() || undefined, role: 'editor' }),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
    onError: (e) => setError(humanError(e)),
  });
  const revokeInv = useMutation({
    mutationFn: (id: string) => client.revokeInvite(id),
    onSuccess: invalidate,
    onError: (e) => setError(humanError(e)),
  });

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-medium">成员</h2>
      {error && <Banner>{error}</Banner>}
      <ul className="space-y-2">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar name={m.nickname} src={m.avatarUrl} size={28} />
            <span>{m.nickname}</span>
            <span className="text-muted">{roleLabel(m.role)}</span>
            {owner && m.role !== 'owner' && (
              <>
                <select
                  value={m.role}
                  onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as 'editor' | 'viewer' })}
                  className="rounded-card border border-line bg-surface px-1 py-0.5 text-xs text-ink focus:border-action"
                >
                  <option value="editor">可记录</option>
                  <option value="viewer">只看</option>
                </select>
                <Button variant="quiet" size="sm" onClick={() => remove.mutate(m.userId)}>
                  移除
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setTransferId(m.userId)}>
                  转让给他
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {user && !owner && (
        <Button variant="ghost" onClick={() => leave.mutate()}>
          离开这条链
        </Button>
      )}
      {inviteOk && (
        <div>
          <h3 className="mb-2 text-sm text-muted">邀请家人</h3>
          <div className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱（可空，只生成链接）" />
            <Button className="w-full min-[520px]:w-auto" disabled={invite.isPending} onClick={() => invite.mutate()}>
              生成邀请
            </Button>
          </div>
          <ul className="mt-3 space-y-2">
            {(invites ?? []).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">{inv.email ?? '链接邀请'}</span>
                <span>{roleLabel(inv.role)}</span>
                {inv.acceptedAt ? (
                  <span>已加入</span>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(`${window.location.origin}/invites/${inv.token}`).then(() => {
                          setCopied(inv.id);
                          window.setTimeout(() => setCopied(null), 1500);
                        });
                      }}
                    >
                      {copied === inv.id ? '已复制' : '复制邀请'}
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => revokeInv.mutate(inv.id)}>
                      吊销
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {transferId && (
        <Confirm
          title="把创建者交给这个人？"
          body="请输入链的名字确认。"
          confirmLabel="转让"
          danger
          prompt={{ label: chain.name, expect: chain.name }}
          promptValue={transferName}
          onPromptChange={setTransferName}
          busy={transfer.isPending}
          onCancel={() => {
            setTransferId(null);
            setTransferName('');
          }}
          onConfirm={() => transfer.mutate(transferId)}
        />
      )}
    </div>
  );
}

function ProfileSection({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description ?? '');
  const [color, setColor] = useState<ChainColor>(chain.color ?? fallbackChainColor(chain.id));
  const [icon, setIcon] = useState<ChainIcon | null>(chain.icon);
  const [error, setError] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');
  const { data: tags } = useQuery({ queryKey: qk.tags(chain.id), queryFn: () => client.listTags(chain.id) });
  const save = useMutation({
    mutationFn: () =>
      client.updateChain(chain.id, {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.chain(chain.id) });
      void queryClient.invalidateQueries({ queryKey: qk.chains });
    },
    onError: (e) => setError(humanError(e)),
  });
  const addTag = useMutation({
    mutationFn: () => client.createTag(chain.id, tagName.trim()),
    onSuccess: () => {
      setTagName('');
      void queryClient.invalidateQueries({ queryKey: qk.tags(chain.id) });
    },
    onError: (e) => setError(humanError(e)),
  });
  const delTag = useMutation({
    mutationFn: (id: string) => client.deleteTag(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.tags(chain.id) }),
    onError: (e) => setError(humanError(e)),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">资料</h2>
      <Field label="名字">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="简介">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <ChainLookPicker color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
      {error && <Banner>{error}</Banner>}
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        保存
      </Button>
      <div className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm text-muted">标签</h3>
        <ul className="space-y-1">
          {(tags?.tags ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              #{t.name}
              <button type="button" className="text-xs text-muted" onClick={() => delTag.mutate(t.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
          <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="新标签" />
          <Button
            variant="ghost"
            className="w-full min-[480px]:w-auto"
            disabled={!tagName.trim() || addTag.isPending}
            onClick={() => addTag.mutate()}
          >
            添加
          </Button>
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <DangerSection chain={chain} />
      </div>
    </div>
  );
}

function DangerSection({ chain }: { chain: ChainDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => client.deleteChain(chain.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.chains });
      navigate('/');
    },
    onError: (e) => setError(humanError(e)),
  });

  return (
    <div className="space-y-3">
      <h2 className="text-sm text-muted">删除这条链</h2>
      <p className="text-sm text-muted">链里的时刻会一起消失。请输入链的名字确认。</p>
      {error && <Banner>{error}</Banner>}
      <Button variant="danger" onClick={() => setOpen(true)}>
        删除整条链
      </Button>
      {open && (
        <Confirm
          title="删除整条链？"
          body="这一家的记录都会没有。"
          confirmLabel="删除"
          danger
          prompt={{ label: chain.name, expect: chain.name }}
          promptValue={typed}
          onPromptChange={setTyped}
          busy={del.isPending}
          onCancel={() => setOpen(false)}
          onConfirm={() => del.mutate()}
        />
      )}
    </div>
  );
}
