import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Field';

export function CreateChainDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<ChainColor>('coral');
  const [icon, setIcon] = useState<ChainIcon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      client.createChain({
        name: name.trim(),
        visibility: 'private',
        description: description.trim() || undefined,
        color,
        icon,
      }),
    onSuccess: (chain) => {
      void queryClient.invalidateQueries({ queryKey: qk.chains });
      onClose();
      navigate(`/chains/${chain.id}`);
    },
    onError: (e) => setError(humanError(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('给这条链起个名字');
      return;
    }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md space-y-3 rounded-card bg-surface p-5 shadow-card">
        <h2 className="font-display text-lg">开一条新的链</h2>
        <Field label="名字">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如「宝宝成长」" autoFocus />
        </Field>
        <Field label="一句话（可选）">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="min-h-0" />
        </Field>
        <ChainLookPicker color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
        {error && <Banner>{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? '创建中…' : '创建'}
          </Button>
        </div>
      </form>
    </div>
  );
}
