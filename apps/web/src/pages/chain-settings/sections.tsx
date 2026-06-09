import { useState } from 'react';
import { useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { ChainColor, ChainIcon, ShareLinkDto } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { humanError } from '@/lib/errors';
import { canInvite, isOwner, roleLabel } from '@/lib/roles';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { Field, Input, Textarea } from '@/ui/Field';
import { Avatar } from '@/ui/Avatar';
import { ChainSettingsService } from './chain-settings.service';

type Section = 'share' | 'members' | 'profile';

export const ChainSettingsSections = observer(function ChainSettingsSections() {
  const service = useService(ChainSettingsService);
  const chain = service.chain;
  const owner = chain ? isOwner(chain) : false;
  // 壳已保证链存在（index.tsx 三态判定后才渲染分区）；hook 需先于守卫调用
  const [section, setSection] = useState<Section>(owner ? 'share' : 'members');
  if (!chain) return null;
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
        {section === 'share' && owner && <ShareSection />}
        {section === 'members' && <MembersSection />}
        {section === 'profile' && owner && <ProfileSection />}
      </div>
    </div>
  );
});

const ShareSection = observer(function ShareSection() {
  const service = useService(ChainSettingsService);
  const [copied, setCopied] = useState<string | null>(null);
  const error = service.$model.createShareLink.error ?? service.$model.revokeShareLink.error;

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
            value={service.shareExpire}
            onChange={(e) => (service.shareExpire = e.target.value as typeof service.shareExpire)}
            className="h-10 min-w-0 rounded-sticker border border-line bg-bg px-3 text-sm text-ink focus:border-action"
          >
            <option value="never">永不过期</option>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="date">指定日期</option>
          </select>
          {service.shareExpire === 'date' && (
            <input
              type="date"
              value={service.shareDate}
              onChange={(e) => (service.shareDate = e.target.value)}
              className="h-10 min-w-0 rounded-sticker border border-line bg-bg px-3 text-sm text-ink focus:border-action"
            />
          )}
          <Button
            className="min-[560px]:ml-auto"
            disabled={service.$model.createShareLink.loading}
            onClick={() => void service.createShareLink()}
          >
            生成分享链接
          </Button>
        </div>
      </div>
      {error && <Banner>{humanError(error)}</Banner>}
      <ul className="space-y-2">
        {service.shareLinks.map((link) => {
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
                  <Button variant="quiet" size="sm" onClick={() => (service.revokeLinkId = link.id)}>
                    吊销
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {service.revokeLinkId && (
        <Confirm
          title="吊销这条链接？"
          body="长辈将立刻打不开这本相册。"
          confirmLabel="吊销"
          danger
          busy={service.$model.revokeShareLink.loading}
          onCancel={() => (service.revokeLinkId = null)}
          onConfirm={() => void service.revokeShareLink(service.revokeLinkId!)}
        />
      )}
    </div>
  );
});

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

const MembersSection = observer(function MembersSection() {
  const service = useService(ChainSettingsService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const chain = service.chain!;
  const owner = isOwner(chain);
  const inviteOk = canInvite(chain);
  const [copied, setCopied] = useState<string | null>(null);
  const error =
    service.$model.changeRole.error ??
    service.$model.removeMember.error ??
    service.$model.leaveChain.error ??
    service.$model.transferChain.error ??
    service.$model.createInvite.error ??
    service.$model.revokeInvite.error;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-medium">成员</h2>
      {error && <Banner>{humanError(error)}</Banner>}
      <ul className="space-y-2">
        {service.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar name={m.nickname} src={m.avatarUrl} size={28} />
            <span>{m.nickname}</span>
            <span className="text-muted">{roleLabel(m.role)}</span>
            {owner && m.role !== 'owner' && (
              <>
                <select
                  value={m.role}
                  onChange={(e) => void service.changeRole(m.userId, e.target.value as 'editor' | 'viewer')}
                  className="rounded-card border border-line bg-surface px-1 py-0.5 text-xs text-ink focus:border-action"
                >
                  <option value="editor">可记录</option>
                  <option value="viewer">只看</option>
                </select>
                <Button variant="quiet" size="sm" onClick={() => void service.removeMember(m.userId)}>
                  移除
                </Button>
                <Button variant="quiet" size="sm" onClick={() => (service.transferId = m.userId)}>
                  转让给他
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {auth.user && !owner && (
        <Button
          variant="ghost"
          disabled={service.$model.leaveChain.loading}
          onClick={() => void service.leaveChain(auth.user!.id).then(() => navigate('/'))}
        >
          离开这条链
        </Button>
      )}
      {inviteOk && (
        <div>
          <h3 className="mb-2 text-sm text-muted">邀请家人</h3>
          <div className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
            <Input
              value={service.inviteEmail}
              onChange={(e) => (service.inviteEmail = e.target.value)}
              placeholder="邮箱（可空，只生成链接）"
            />
            <Button
              className="w-full min-[520px]:w-auto"
              disabled={service.$model.createInvite.loading}
              onClick={() => void service.createInvite()}
            >
              生成邀请
            </Button>
          </div>
          <ul className="mt-3 space-y-2">
            {service.invites.map((inv) => (
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
                    <Button variant="quiet" size="sm" onClick={() => void service.revokeInvite(inv.id)}>
                      吊销
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {service.transferId && (
        <Confirm
          title="把创建者交给这个人？"
          body="请输入链的名字确认。"
          confirmLabel="转让"
          danger
          prompt={{ label: chain.name, expect: chain.name }}
          promptValue={service.transferName}
          onPromptChange={(v) => (service.transferName = v)}
          busy={service.$model.transferChain.loading}
          onCancel={() => {
            service.transferId = null;
            service.transferName = '';
          }}
          onConfirm={() => void service.transferChain(service.transferId!)}
        />
      )}
    </div>
  );
});

const ProfileSection = observer(function ProfileSection() {
  const service = useService(ChainSettingsService);
  const error = service.$model.saveProfile.error ?? service.$model.addTag.error ?? service.$model.deleteTag.error;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">资料</h2>
      <Field label="名字">
        <Input value={service.formName} onChange={(e) => (service.formName = e.target.value)} />
      </Field>
      <Field label="简介">
        <Textarea value={service.formDescription} onChange={(e) => (service.formDescription = e.target.value)} />
      </Field>
      <ChainLookPicker
        color={service.formColor}
        icon={service.formIcon}
        onColor={(c: ChainColor) => (service.formColor = c)}
        onIcon={(i: ChainIcon | null) => (service.formIcon = i)}
      />
      {error && <Banner>{humanError(error)}</Banner>}
      <Button disabled={service.$model.saveProfile.loading} onClick={() => void service.saveProfile()}>
        保存
      </Button>
      <div className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm text-muted">标签</h3>
        <ul className="space-y-1">
          {service.tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              #{t.name}
              <button type="button" className="text-xs text-muted" onClick={() => void service.deleteTag(t.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
          <Input value={service.newTagName} onChange={(e) => (service.newTagName = e.target.value)} placeholder="新标签" />
          <Button
            variant="ghost"
            className="w-full min-[480px]:w-auto"
            disabled={!service.newTagName.trim() || service.$model.addTag.loading}
            onClick={() => void service.addTag()}
          >
            添加
          </Button>
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <DangerSection />
      </div>
    </div>
  );
});

const DangerSection = observer(function DangerSection() {
  const service = useService(ChainSettingsService);
  const navigate = useNavigate();
  const chain = service.chain!;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <div className="space-y-3">
      <h2 className="text-sm text-muted">删除这条链</h2>
      <p className="text-sm text-muted">链里的时刻会一起消失。请输入链的名字确认。</p>
      {service.$model.deleteChain.error && <Banner>{humanError(service.$model.deleteChain.error)}</Banner>}
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
          busy={service.$model.deleteChain.loading}
          onCancel={() => setOpen(false)}
          onConfirm={() => void service.deleteChain().then(() => navigate('/')).catch(() => undefined)}
        />
      )}
    </div>
  );
});
