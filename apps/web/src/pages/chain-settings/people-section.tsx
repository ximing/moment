import { useState } from 'react';
import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { humanError } from '@/lib/errors';
import { Button, IconButton } from '@/ui/button/index';
import { Banner, EmptyState } from '@/ui/feedback/index';
import { Input } from '@/ui/field/index';
import { AlertDialog } from '@/ui/modal/index';
import { ChainSettingsService } from './chain-settings.service';

// 链设置「人物」：维护记下时「和谁在一起」用的链级名单（增删改名）。
// 删除会拆掉已记时刻上的关联，不删时刻本身。editor/owner 可改。

export const PeopleSection = observer(function PeopleSection() {
  const service = useService(ChainSettingsService);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const error =
    service.$model.addPerson.error ?? service.$model.renamePerson.error ?? service.$model.removePerson.error;
  const removing = service.persons.find((p) => p.id === removeId);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">人物</h2>
      <p className="text-meta text-muted">记下时刻时可以从这份名单里勾选和谁在一起。</p>
      {error && <Banner tone="error">{humanError(error)}</Banner>}
      {service.persons.length === 0 ? (
        <EmptyState variant="plain" scope="section" title="还没有人物" description="先加上外婆、妈妈这些常用的名字。" />
      ) : (
        <ul className="space-y-2">
          {service.persons.map((p) => (
            <li key={`${p.id}-${p.name}`} className="flex items-center gap-2">
              <Input
                aria-label={`人物 ${p.name}`}
                defaultValue={p.name}
                maxLength={50}
                className="min-w-0 flex-1"
                onBlur={(e) => void service.renamePerson(p.id, e.target.value).catch(() => undefined)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <IconButton icon={X} label={`删除 ${p.name}`} onClick={() => setRemoveId(p.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
        <Input
          aria-label="新人物"
          value={service.newPersonName}
          onChange={(e) => (service.newPersonName = e.target.value)}
          placeholder="新人物"
          maxLength={50}
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void service.addPerson().catch(() => undefined);
          }}
        />
        <Button
          variant="quiet"
          className="w-full min-[480px]:w-auto"
          disabled={!service.newPersonName.trim()}
          loading={service.$model.addPerson.loading}
          onClick={() => void service.addPerson().catch(() => undefined)}
        >
          添加
        </Button>
      </div>
      <AlertDialog
        open={removeId !== null}
        title={removing ? `去掉「${removing.name}」？` : '去掉这个人？'}
        body="已经记在时刻上的「和谁在一起」也会一起去掉，时刻本身还在。"
        confirmLabel="去掉"
        cancelLabel="留着"
        danger
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          const id = removeId;
          setRemoveId(null);
          if (id) void service.removePerson(id).catch(() => undefined);
        }}
      />
    </div>
  );
});
