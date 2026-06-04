import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainDto, ShareLinkDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import { canInvite, isOwner, roleLabel } from '@/lib/roles';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { Field, Input, Textarea } from '@/ui/Field';
import { Avatar } from '@/ui/Avatar';

type Section = 'share' | 'members' | 'profile' | 'danger';

export function ChainSettings({ chain }: { chain: ChainDto }) {
  const owner = isOwner(chain);
  const [section, setSection] = useState<Section>(owner ? 'share' : 'members');
  const items: { key: Section; label: string; show: boolean }[] = [
    { key: 'share', label: '分享', show: owner },
    { key: 'members', label: '成员', show: true },
    { key: 'profile', label: '资料', show: owner },
    { key: 'danger', label: '危险区', show: owner },
  ];

  return (
    <div className="flex gap-8">
      <nav className="w-28 shrink-0 space-y-1">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => setSection(i.key)}
              className={`block w-full rounded-paper px-2 py-1.5 text-left text-sm ${
                section === i.key ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink'
              }`}
            >
              {i.label}
            </button>
          ))}
      </nav>
      <div className="min-w-0 flex-1">
        {section === 'share' && owner && <ShareSection chainId={chain.id} />}
        {section === 'members' && <MembersSection chain={chain} />}
        {section === 'profile' && owner && <ProfileSection chain={chain} />}
        {section === 'danger' && owner && <DangerSection chain={chain} />}
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
      <h2 className="font-display text-lg">给长辈的相册链接</h2>
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={expire}
          onChange={(e) => setExpire(e.target.value as typeof expire)}
          className="rounded-paper border border-line bg-white/70 px-2 py-2 text-sm"
        >
          <option value="never">永不过期</option>
          <option value="7">7 天</option>
          <option value="30">30 天</option>
          <option value="date">指定日期</option>
        </select>
        {expire === 'date' && (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-paper border border-line px-2 py-2 text-sm" />
        )}
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          生成分享链接
        </Button>
      </div>
      {error && <Banner>{error}</Banner>}
      <ul className="space-y-2">
        {(data?.items ?? []).map((link) => {
          const status = linkStatus(link);
          return (
            <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-paper border border-line bg-white/50 px-3 py-2 text-sm">
              <span className="text-muted">{new Date(link.createdAt).toLocaleString()}</span>
              <span>{status}</span>
              {link.expiresAt && <span className="text-muted">到期 {new Date(link.expiresAt).toLocaleDateString()}</span>}
              {status === '有效' && (
                <Button variant="ghost" onClick={() => copy(link)}>
                  {copied === link.id ? '已复制' : '复制链接'}
                </Button>
              )}
              {status !== '已吊销' && (
                <Button variant="quiet" onClick={() => setRevokeId(link.id)}>
                  吊销
                </Button>
              )}
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
      <h2 className="font-display text-lg">成员</h2>
      {error && <Banner>{error}</Banner>}
      <ul className="space-y-2">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="flex items-center gap-2 text-sm">
            <Avatar name={m.nickname} size={28} />
            <span>{m.nickname}</span>
            <span className="text-muted">{roleLabel(m.role)}</span>
            {owner && m.role !== 'owner' && (
              <>
                <select
                  value={m.role}
                  onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as 'editor' | 'viewer' })}
                  className="rounded border border-line bg-white px-1 py-0.5 text-xs"
                >
                  <option value="editor">可记录</option>
                  <option value="viewer">只看</option>
                </select>
                <Button variant="quiet" onClick={() => remove.mutate(m.userId)}>
                  移除
                </Button>
                <Button variant="quiet" onClick={() => setTransferId(m.userId)}>
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
          <h3 className="mb-2 text-sm text-muted">邀请一起记</h3>
          <div className="flex gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱（可空，只生成链接）" />
            <Button disabled={invite.isPending} onClick={() => invite.mutate()}>
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
                      onClick={() => {
                        void navigator.clipboard.writeText(`${window.location.origin}/invites/${inv.token}`).then(() => {
                          setCopied(inv.id);
                          window.setTimeout(() => setCopied(null), 1500);
                        });
                      }}
                    >
                      {copied === inv.id ? '已复制' : '复制邀请'}
                    </Button>
                    <Button variant="quiet" onClick={() => revokeInv.mutate(inv.id)}>
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
  const [error, setError] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');
  const { data: tags } = useQuery({ queryKey: qk.tags(chain.id), queryFn: () => client.listTags(chain.id) });
  const save = useMutation({
    mutationFn: () => client.updateChain(chain.id, { name: name.trim(), description: description.trim() || null }),
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
      <h2 className="font-display text-lg">资料</h2>
      <Field label="名字">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="简介">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
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
        <div className="mt-2 flex gap-2">
          <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="新标签" />
          <Button variant="ghost" disabled={!tagName.trim() || addTag.isPending} onClick={() => addTag.mutate()}>
            添加
          </Button>
        </div>
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
      <h2 className="font-display text-lg">删除这条链</h2>
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
