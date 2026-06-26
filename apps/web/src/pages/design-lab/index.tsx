import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
// 注意：ui 下同族 barrel 一律显式指向 index——遗留 Button.tsx / Field.tsx /
// Menu.tsx 在大小写不敏感文件系统上会截获裸目录导入。
import { Button, IconButton } from '@/ui/button/index';
import { DateTimeField, PasswordField, TextareaField, TextField } from '@/ui/field/index';
import { AlertDialog, Dialog, Sheet } from '@/ui/modal/index';
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';
import { Popover } from '@/ui/popover/index';
import { Tooltip } from '@/ui/tooltip/index';
import {
  Banner,
  DetailSkeleton,
  EmptyState,
  FeedSkeleton,
  InlineProgress,
  SettingsSkeleton,
  TimelineSkeleton,
  useToast,
} from '@/ui/feedback/index';

/**
 * Design Lab（plan Task 8）：开发期专用视觉脚手架，只挂在 /__design-lab，
 * 且只在 import.meta.env.DEV 注册（见 App.tsx）。固定 fixture props + 本地 state，
 * 不接 client / service / seed，不改生产导航。外层做 DEV 判断、内层承载 hooks，
 * 规避 hooks 条件调用规则。
 */
export function DesignLab(): JSX.Element | null {
  if (!import.meta.env.DEV) return null;
  return <DesignLabContent />;
}

export default DesignLab;

/** 四个带标签视口预设（plan Task 8；E2E 基线同名：design-lab/<theme>/<width>.png）。 */
const VIEWPORT_PRESETS = [390, 1024, 1440, 1895] as const;
type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{name}</h2>
      {children}
    </section>
  );
}

function DesignLabContent(): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const [viewport, setViewport] = useState<ViewportPreset>(1440);

  // Lab 本地明暗切换：直接写 documentElement.dataset.theme（与 ThemeService 同一约定），
  // 不写 localStorage、不触 Service；卸载时还原挂载前的主题。
  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = theme;
    return () => {
      if (previous === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = previous;
    };
  }, [theme]);

  return (
    <div className="flex min-h-screen flex-col gap-8 bg-bg p-8 text-ink">
      <header className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Design Lab</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">主题</span>
          <Button
            variant="quiet"
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            浅色
          </Button>
          <Button
            variant="quiet"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            深色
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">视口</span>
          {VIEWPORT_PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="quiet"
              aria-pressed={viewport === preset}
              onClick={() => setViewport(preset)}
            >
              {preset}
            </Button>
          ))}
        </div>
      </header>

      {/* 视口模拟容器：宽度即预设值本身（视口仿真，非布局间距 token） */}
      <div style={{ width: viewport }} className="mx-auto flex max-w-full flex-col gap-8">
        <ButtonSection />
        <FieldSection />
        <ModalSection />
        <MenuSection />
        <FeedbackSection />
      </div>
    </div>
  );
}

function ButtonSection(): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Section name="Button">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary">记下此刻</Button>
        <Button variant="secondary">次要动作</Button>
        <Button variant="quiet">轻操作</Button>
        <Button variant="danger">删除时刻</Button>
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 800);
          }}
        >
          点我进入提交中
        </Button>
        <Button disabled>不可用</Button>
        <IconButton icon={Plus} label="记下此刻" />
      </div>
    </Section>
  );
}

function FieldSection(): JSX.Element {
  const [happenedAt, setHappenedAt] = useState('2026-08-19T08:00');
  return (
    <Section name="Field">
      <div className="flex max-w-empty flex-col gap-4">
        <TextField label="链名" name="lab-chain" defaultValue="家里的饭" />
        <TextField
          label="邮箱"
          name="lab-email"
          isInvalid
          errorMessage="请填写正确的邮箱"
          defaultValue="not-an-email"
        />
        <PasswordField label="密码" name="lab-password" defaultValue="moment-lab" />
        <TextareaField
          label="一句话"
          name="lab-bio"
          description="会显示在链资料页"
          maxLength={120}
          defaultValue="这条链留给周末的早饭。"
        />
        <DateTimeField
          value={happenedAt}
          onChange={setHappenedAt}
          hint="本地墙钟，原样 round-trip"
        />
      </div>
    </Section>
  );
}

function ModalSection(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  return (
    <Section name="Modal">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          打开 Dialog
        </Button>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          打开 Sheet
        </Button>
        <Button variant="secondary" onClick={() => setAlertOpen(true)}>
          打开 AlertDialog
        </Button>
      </div>
      <Dialog
        open={dialogOpen}
        title="示例 Dialog"
        onRequestClose={() => setDialogOpen(false)}
        footer={
          <Button onClick={() => setDialogOpen(false)}>完成</Button>
        }
      >
        <p className="text-sm text-muted">Dialog 内容区域。</p>
      </Dialog>
      <Sheet
        open={sheetOpen}
        title="示例 Sheet"
        onRequestClose={() => setSheetOpen(false)}
      >
        <p className="text-sm text-muted">Sheet 内容区域。</p>
      </Sheet>
      <AlertDialog
        open={alertOpen}
        title="删除这条时刻？"
        body="删除后无法恢复，照片与评论会一并移除。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={() => setAlertOpen(false)}
        onCancel={() => setAlertOpen(false)}
      />
    </Section>
  );
}

function MenuSection(): JSX.Element {
  return (
    <Section name="Menu">
      <div className="flex flex-wrap items-center gap-3">
        <ResponsiveMenu
          aria-label="这条时刻的操作"
          sheetTitle="这条时刻"
          trigger={<IconButton icon={MoreHorizontal} label="更多操作" />}
          onAction={() => undefined}
        >
          <MenuItem id="share" textValue="分享时刻">
            分享时刻
          </MenuItem>
          <MenuItem id="delete" icon={Trash2} textValue="删除时刻" tone="danger">
            删除时刻
          </MenuItem>
        </ResponsiveMenu>
        <Popover
          aria-label="日期详情"
          trigger={<Button variant="secondary">打开 Popover</Button>}
        >
          <p className="text-sm text-ink">Popover 锚定内容。</p>
        </Popover>
        <Tooltip label="记下此刻">
          <IconButton icon={Plus} label="记下此刻" />
        </Tooltip>
      </div>
    </Section>
  );
}

function FeedbackSection(): JSX.Element {
  const toast = useToast();
  return (
    <Section name="Feedback">
      <Banner tone="error" action={{ label: '再试一次', onPress: () => undefined }}>
        没能刷新大家的日子
      </Banner>
      <Banner tone="warning">部分照片暂未同步</Banner>
      <Banner tone="info">这条链仅自己可见</Banner>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => toast.show({ key: 'lab-saved', message: '已记下此刻' })}
        >
          普通 Toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.show({
              key: 'lab-undo',
              message: '已删除「晚饭」',
              action: { label: '撤销', onPress: () => undefined },
            })
          }
        >
          可撤销 Toast
        </Button>
      </div>
      <EmptyState
        variant="plain"
        scope="section"
        title="还没有时刻"
        description="从第一条此刻开始。"
        action={{ label: '记下此刻', onPress: () => undefined, emphasis: 'primary' }}
      />
      <EmptyState
        variant="timeline"
        scope="section"
        title="今天还没有时刻"
        description="从今天的第一条开始。"
      />
      <TimelineSkeleton />
      <FeedSkeleton />
      <DetailSkeleton />
      <SettingsSkeleton />
      <InlineProgress variant="indeterminate" label="正在载入更多" />
      <InlineProgress variant="determinate" label="上传中" value={40} />
    </Section>
  );
}
