import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Field';
import { CreateChainDialogService } from './create-chain-dialog.service';

const CreateChainDialogContent = observer(function CreateChainDialogContent({ onClose }: { onClose: () => void }) {
  const service = useService(CreateChainDialogService);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null); // 名字为空等本地校验错误

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
      .catch((e) => setError(humanError(e)));
  }

  // 遮罩 30% 墨：var() 色值的 /30 修饰静默不生成 CSS，用 color-mix（硬约束）
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md space-y-3 rounded-card bg-surface p-5 shadow-card">
        <h2 className="font-display text-lg">开一条新的链</h2>
        <Field label="名字">
          <Input value={service.name} onChange={(e) => (service.name = e.target.value)} placeholder="比如「宝宝成长」" autoFocus />
        </Field>
        <Field label="一句话（可选）">
          <Textarea value={service.description} onChange={(e) => (service.description = e.target.value)} rows={2} className="min-h-0" />
        </Field>
        <ChainLookPicker
          color={service.color}
          icon={service.icon}
          onColor={(c) => (service.color = c)}
          onIcon={(i) => (service.icon = i)}
        />
        {error && <Banner>{error}</Banner>}
        {service.$model.submit.error && <Banner>{humanError(service.$model.submit.error)}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={service.$model.submit.loading}>
            {service.$model.submit.loading ? '创建中…' : '创建'}
          </Button>
        </div>
      </form>
    </div>
  );
});

export const CreateChainDialog = bindServices(CreateChainDialogContent, [CreateChainDialogService]);
