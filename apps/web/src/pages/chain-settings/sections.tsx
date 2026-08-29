import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { MoreHorizontal, X } from 'lucide-react';
import type { ShareLinkDto } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainAppearanceEditor, type ChainAppearanceActions } from '@/chain/ChainAppearanceEditor';
import { humanError } from '@/lib/errors';
import { canInvite, isOwner, roleLabel } from '@/lib/roles';
import { Avatar } from '@/ui/Avatar';
import { Button, IconButton } from '@/ui/button/index';
import { Banner, EmptyState, useToast } from '@/ui/feedback/index';
import { Field, Input, Select, SelectField, Textarea } from '@/ui/field/index';
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';
import { AlertDialog, Dialog } from '@/ui/modal/index';
import { ChainSettingsService } from './chain-settings.service';
import { JobsSection } from './jobs-section';

// 链设置分区（plan Task 12）：service 调用、server 错误映射与 owner/editor/viewer
// 角色门控原样保留；分区导航、输入、按钮与确认弹层全部改走设计系统基元
// （Field/Button/ResponsiveMenu/Banner/AlertDialog），不再堆 sticker 卡片与小实体按钮。
// 确认态（吊销链接 / 转让 / 删除）是纯 UI 确认态，留在组件本地 state，不进 service
// （同 MomentPageContent 先例）；危险操作结果由 Banner / 列表变化表达，不重复弹 Toast。

type Section = 'share' | 'members' | 'profile' | 'jobs';

export const ChainSettingsSections = observer(function ChainSettingsSections() {
  const service = useService(ChainSettingsService);
  const chain = service.chain;
  const owner = chain ? isOwner(chain) : false;
  // 壳已保证链存在（index.tsx 三态判定后才渲染分区）；hook 需先于守卫调用
  const [section, setSection] = useState<Section>(owner ? 'share' : 'members');
  // 离开设置页（unmount）：回收未持久化的 temp 上传（abort 在途 + best-effort DELETE）；
  // 已保存/已绑定资源为 persisted，dispose 不会误删（spec §7.1，同创建链弹窗）
  useEffect(() => () => service.disposeAppearanceDraft(), [service]);
  if (!chain) return null;
  const items: { key: Section; label: string; show: boolean }[] = [
    { key: 'share', label: '分享', show: owner },
    { key: 'members', label: '成员', show: true },
    { key: 'profile', label: '资料', show: owner },
    { key: 'jobs', label: '处理中', show: owner },
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
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
                section === i.key
                  ? 'bg-select text-select-fg'
                  : 'text-muted hover:bg-floating-hover hover:text-ink'
              }`}
            >
              {i.label}
            </button>
          ))}
      </nav>
      <div>
        {section === 'share' && owner && <ShareSection />}
        {section === 'members' && <MembersSection />}
        {section === 'profile' && owner && <ProfileSection />}
        {section === 'jobs' && owner && <JobsSection />}
      </div>
    </div>
  );
});

const SHARE_EXPIRE_OPTIONS = [
  { value: 'never', label: '永不过期' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: 'date', label: '指定日期' },
];

const ShareSection = observer(function ShareSection() {
  const service = useService(ChainSettingsService);
  const [copied, setCopied] = useState<string | null>(null);
  // 待确认吊销的链接 id：纯 UI 确认态
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
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
      <div className="flex flex-col gap-3 min-[560px]:flex-row min-[560px]:items-end">
        <SelectField
          label="有效期"
          name="share-expire"
          value={service.shareExpire}
          onChange={(v) => (service.shareExpire = v as typeof service.shareExpire)}
          options={SHARE_EXPIRE_OPTIONS}
          className="min-w-0 flex-1"
        />
        {service.shareExpire === 'date' && (
          <Input
            type="date"
            aria-label="到期日期"
            value={service.shareDate}
            onChange={(e) => (service.shareDate = e.target.value)}
            className="min-w-0 flex-1"
          />
        )}
        <Button
          className="min-[560px]:ml-auto"
          loading={service.$model.createShareLink.loading}
          onClick={() => void service.createShareLink().catch(() => undefined)} // 错误读 $model.createShareLink.error
        >
          生成分享链接
        </Button>
      </div>
      {error && <Banner tone="error">{humanError(error)}</Banner>}
      {service.shareLinks.length === 0 ? (
        <EmptyState
          variant="plain"
          scope="section"
          title="还没有分享链接"
          description="生成一条链接，长辈不用登录就能顺着日子看。"
        />
      ) : (
        <ul className="space-y-1">
          {service.shareLinks.map((link) => {
            const status = linkStatus(link);
            return (
              <li
                key={link.id}
                className={`flex flex-wrap items-center gap-2 py-2 text-sm ${status === '已吊销' ? 'text-muted' : ''}`}
              >
                <span className="min-w-0 text-muted">{new Date(link.createdAt).toLocaleString()}</span>
                <span>{status}</span>
                {link.expiresAt && <span className="text-muted">到期 {new Date(link.expiresAt).toLocaleDateString()}</span>}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {status === '有效' && (
                    <Button variant="quiet" onClick={() => copy(link)}>
                      {copied === link.id ? '已复制' : '复制链接'}
                    </Button>
                  )}
                  {status !== '已吊销' && (
                    <Button variant="quiet" onClick={() => setConfirmRevokeId(link.id)}>
                      吊销
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={confirmRevokeId !== null}
        title="吊销这条链接？"
        body="长辈将立刻打不开这本相册。"
        confirmLabel="吊销"
        cancelLabel="取消"
        danger
        busy={service.$model.revokeShareLink.loading}
        onCancel={() => setConfirmRevokeId(null)}
        onConfirm={() => {
          const id = confirmRevokeId;
          setConfirmRevokeId(null);
          if (id) void service.revokeShareLink(id).catch(() => undefined); // 错误读 $model.revokeShareLink.error
        }}
      />
    </div>
  );
});

function linkStatus(link: ShareLinkDto): string {
  if (link.revokedAt) return '已吊销';
  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) return '已过期';
  return '有效';
}

const MEMBER_ROLE_OPTIONS = [
  { value: 'editor', label: '可记录' },
  { value: 'viewer', label: '只看' },
];

const MembersSection = observer(function MembersSection() {
  const service = useService(ChainSettingsService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const chain = service.chain!;
  const owner = isOwner(chain);
  const inviteOk = canInvite(chain);
  const [copied, setCopied] = useState<string | null>(null);
  // 待确认转让的成员 id 与确认输入：纯 UI 确认态
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [transferName, setTransferName] = useState('');
  const error =
    service.$model.changeRole.error ??
    service.$model.removeMember.error ??
    service.$model.leaveChain.error ??
    service.$model.transferChain.error ??
    service.$model.createInvite.error ??
    service.$model.revokeInvite.error;
  const transferBusy = service.$model.transferChain.loading;

  function closeTransfer() {
    setConfirmTransferId(null);
    setTransferName('');
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-medium">成员</h2>
      {error && <Banner tone="error">{humanError(error)}</Banner>}
      <ul className="space-y-1">
        {service.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <Avatar name={m.nickname} src={m.avatarUrl} size={24} />
            <span>{m.nickname}</span>
            <span className="text-muted">{roleLabel(m.role)}</span>
            {owner && m.role !== 'owner' && (
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Select
                  aria-label={`${m.nickname} 的角色`}
                  value={m.role}
                  onChange={(v) => void service.changeRole(m.userId, v as 'editor' | 'viewer').catch(() => undefined)}
                  options={MEMBER_ROLE_OPTIONS}
                />
                <ResponsiveMenu
                  aria-label={`管理 ${m.nickname}`}
                  sheetTitle={m.nickname}
                  trigger={<IconButton icon={MoreHorizontal} label={`管理 ${m.nickname}`} />}
                  onAction={(key) => {
                    if (key === 'remove') void service.removeMember(m.userId).catch(() => undefined);
                    if (key === 'transfer') setConfirmTransferId(m.userId);
                  }}
                >
                  <MenuItem id="remove" textValue="移除" tone="danger">
                    移除
                  </MenuItem>
                  <MenuItem id="transfer" textValue="转让给他">
                    转让给他
                  </MenuItem>
                </ResponsiveMenu>
              </span>
            )}
          </li>
        ))}
      </ul>
      {auth.user && !owner && (
        <div>
          <Button
            variant="quiet"
            loading={service.$model.leaveChain.loading}
            onClick={() => void service.leaveChain(auth.user!.id).then(() => navigate('/')).catch(() => undefined)}
          >
            离开这条链
          </Button>
        </div>
      )}
      {inviteOk && (
        <div>
          <h3 className="mb-2 text-sm text-muted">邀请家人</h3>
          <div className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
            <Input
              aria-label="邀请邮箱"
              value={service.inviteEmail}
              onChange={(e) => (service.inviteEmail = e.target.value)}
              placeholder="邮箱（可空，只生成链接）"
              className="min-w-0 flex-1"
            />
            <Button
              className="w-full min-[520px]:w-auto"
              loading={service.$model.createInvite.loading}
              onClick={() => void service.createInvite().catch(() => undefined)}
            >
              生成邀请
            </Button>
          </div>
          {service.invites.length > 0 && (
            <ul className="mt-3 space-y-1">
              {service.invites.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="text-muted">{inv.email ?? '链接邀请'}</span>
                  <span>{roleLabel(inv.role)}</span>
                  {inv.acceptedAt ? (
                    <span>已加入</span>
                  ) : (
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="quiet"
                        onClick={() => {
                          void navigator.clipboard.writeText(`${window.location.origin}/invites/${inv.token}`).then(() => {
                            setCopied(inv.id);
                            window.setTimeout(() => setCopied(null), 1500);
                          });
                        }}
                      >
                        {copied === inv.id ? '已复制' : '复制邀请'}
                      </Button>
                      <Button variant="quiet" onClick={() => void service.revokeInvite(inv.id).catch(() => undefined)}>
                        吊销
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* 转让需要输入链名确认：AlertDialog 无内容槽，走 Dialog + danger 终确认 */}
      <Dialog
        open={confirmTransferId !== null}
        title="把创建者交给这个人？"
        busy={transferBusy}
        onRequestClose={closeTransfer}
        footer={
          <>
            <Button variant="quiet" disabled={transferBusy} onClick={closeTransfer}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={transferName !== chain.name}
              loading={transferBusy}
              onClick={() => {
                const id = confirmTransferId;
                if (!id) return;
                void service
                  .transferChain(id)
                  .then(closeTransfer)
                  .catch(() => undefined); // 错误读 $model.transferChain.error
              }}
            >
              转让
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">转让后你不再是创建者。请输入链的名字确认。</p>
        <Field label={`链的名字（${chain.name}）`}>
          <Input value={transferName} onChange={(e) => setTransferName(e.target.value)} placeholder={chain.name} />
        </Field>
      </Dialog>
    </div>
  );
});

const ProfileSection = observer(function ProfileSection() {
  const service = useService(ChainSettingsService);
  const toast = useToast();
  const error = service.$model.saveProfile.error ?? service.$model.addTag.error ?? service.$model.deleteTag.error;

  // 外观编辑器是纯受控组件：draft 只读，所有变更经 action 回调进 service（组件不碰 client）
  const appearanceActions: ChainAppearanceActions = {
    onSetAvatarMode: (mode) => service.setAvatarMode(mode),
    onSelectEmoji: (emoji) => service.selectEmoji(emoji),
    onSelectColor: (color) => service.selectColor(color),
    onPickImage: (placement, file) => service.selectAppearanceImage(placement, file),
    onRemoveImage: (placement) => service.discardAppearanceImage(placement),
    onRetryImage: (placement) => service.retryAppearanceImage(placement),
    onSetFocus: (placement, focus) => service.setAppearanceFocus(placement, focus),
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">资料</h2>
      <Field label="名字">
        <Input value={service.formName} onChange={(e) => (service.formName = e.target.value)} />
      </Field>
      <Field label="简介">
        <Textarea value={service.formDescription} onChange={(e) => (service.formDescription = e.target.value)} />
      </Field>
      <ChainAppearanceEditor draft={service.appearance} actions={appearanceActions} />
      {error && <Banner tone="error">{humanError(error)}</Banner>}
      <div>
        <Button
          disabled={!service.canSave}
          loading={service.$model.saveProfile.loading}
          onClick={() =>
            void service
              .saveProfile()
              // 保存结果在页面上不可见：成功给结构化 Toast（Task 8 挂 Provider）；
              // 失败由上方 Banner 表达，不弹 Toast
              .then(() => toast.show({ key: 'settings-saved', message: '设置已保存' }))
              .catch(() => undefined)
          }
        >
          保存
        </Button>
      </div>
      <div className="pt-4">
        <h3 className="mb-2 text-sm text-muted">标签</h3>
        {service.tags.length === 0 ? (
          <EmptyState
            variant="plain"
            scope="section"
            title="还没有标签"
            description="给这条链的时刻加上标签，方便以后翻找。"
          />
        ) : (
          <ul className="space-y-1">
            {service.tags.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="text-ink">#{t.name}</span>
                <IconButton
                  icon={X}
                  label={`删除标签 ${t.name}`}
                  onClick={() => void service.deleteTag(t.id).catch(() => undefined)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
          <Input
            aria-label="新标签"
            value={service.newTagName}
            onChange={(e) => (service.newTagName = e.target.value)}
            placeholder="新标签"
            className="min-w-0 flex-1"
          />
          <Button
            variant="quiet"
            className="w-full min-[480px]:w-auto"
            disabled={!service.newTagName.trim()}
            loading={service.$model.addTag.loading}
            onClick={() => void service.addTag().catch(() => undefined)}
          >
            添加
          </Button>
        </div>
      </div>
      <div className="pt-4">
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
  const busy = service.$model.deleteChain.loading;

  function close() {
    setOpen(false);
    setTyped('');
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm text-muted">删除这条链</h2>
      <p className="text-sm text-muted">链里的时刻会一起消失。请输入链的名字确认。</p>
      {service.$model.deleteChain.error && <Banner tone="error">{humanError(service.$model.deleteChain.error)}</Banner>}
      <div>
        {/* 危险入口用文字级 danger 链接触达（Button 规范 §3.1），实心 danger 只留给最终确认 */}
        <button
          type="button"
          className="text-sm text-danger transition-colors duration-[var(--ease)] hover:text-ink focus-visible:outline-none focus-visible:ring-focus"
          onClick={() => setOpen(true)}
        >
          删除整条链
        </button>
      </div>
      {/* 删除需要输入链名确认：AlertDialog 无内容槽，走 Dialog + danger 终确认 */}
      <Dialog
        open={open}
        title="删除整条链？"
        busy={busy}
        onRequestClose={close}
        footer={
          <>
            <Button variant="quiet" disabled={busy} onClick={close}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={typed !== chain.name}
              loading={busy}
              onClick={() => void service.deleteChain().then(() => navigate('/')).catch(() => undefined)}
            >
              删除
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">这一家的记录都会没有。请输入链的名字确认。</p>
        <Field label={`链的名字（${chain.name}）`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={chain.name} />
        </Field>
      </Dialog>
    </div>
  );
});
