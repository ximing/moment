import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { humanError } from '@/lib/errors';
// 必须显式指向 barrel：src/ui/ 下遗留 Button.tsx / Field.tsx / Banner.tsx
// 会截获裸目录导入（见 ui/menu/index.ts 注释）
import { Banner } from '@/ui/feedback/index';
import { Button } from '@/ui/button/index';
import { Field, Input, Textarea } from '@/ui/field/index';
import { Dialog } from '@/ui/modal/index';
import { CreateChainDialogService } from './create-chain-dialog.service';

const FORM_ID = 'create-chain-form';

const CreateChainDialogContent = observer(function CreateChainDialogContent({ onClose }: { onClose: () => void }) {
  const service = useService(CreateChainDialogService);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null); // 名字为空等本地校验错误
  useEffect(() => {
    void service.loadTemplates().catch(() => undefined); // 失败静默：选择器不渲染，默认 daily
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时一次性加载
  }, []);
  const submitting = service.$model.submit.loading;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!service.name.trim()) {
      setError('给这条链起个名字');
      return;
    }
    void service
      .submit()
      .then((chainId) => {
        onClose();
        navigate(`/chains/${chainId}`);
      })
      .catch(() => undefined); // API 错误横幅读 $model.submit.error，不双写本地 state
  }

  // 遮罩、焦点圈禁、滚动锁、Escape/外部点击关闭全部由 ui/modal 的 Dialog 承担；
  // 提交中 busy 抑制一切关闭请求（Modal 规范 §9/§12）
  return (
    <Dialog
      open
      title="开一条新的链"
      busy={submitting}
      onRequestClose={() => onClose()}
      footer={
        <>
          <Button variant="quiet" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting}>
            创建
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-field-stack">
        {service.templates.length > 0 && (
          <Field label="这条链记什么" description="模板选定后不可更改">
            <div className="grid grid-cols-3 gap-2">
              {service.templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={service.template === t.key}
                  onClick={() => (service.template = t.key)}
                  className={`flex flex-col items-start gap-1 rounded-surface-md border px-3 py-2 text-left transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
                    service.template === t.key
                      ? 'border-action bg-bg'
                      : 'border-line bg-surface hover:bg-floating-hover'
                  }`}
                >
                  <span className="text-body">
                    {t.icon} {t.name}
                  </span>
                  {t.description && <span className="text-caption text-muted">{t.description}</span>}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="名字">
          <Input value={service.name} onChange={(e) => (service.name = e.target.value)} placeholder="比如「宝宝成长」" autoFocus />
        </Field>
        <Field label="一句话（可选）">
          <Textarea value={service.description} onChange={(e) => (service.description = e.target.value)} />
        </Field>
        <ChainLookPicker
          color={service.color}
          icon={service.icon}
          onColor={(c) => (service.color = c)}
          onIcon={(i) => (service.icon = i)}
        />
        {error && <Banner tone="error">{error}</Banner>}
        {service.$model.submit.error && <Banner tone="error">{humanError(service.$model.submit.error)}</Banner>}
      </form>
    </Dialog>
  );
});

export const CreateChainDialog = bindServices(CreateChainDialogContent, [CreateChainDialogService]);
