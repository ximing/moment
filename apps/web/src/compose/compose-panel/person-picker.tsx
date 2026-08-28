import { observer } from '@rabjs/react';
import type { ChainMemberDto, PersonResponse } from '@moment/dto';
import { MapPin, X } from 'lucide-react';
import { IconButton } from '@/ui/button/index';
import { Input, TextField } from '@/ui/field/index';
import { Tooltip } from '@/ui/tooltip/index';
import type { ComposePanelService } from './compose-panel.service';

// 人物选择器 + 地点输入（spec people-place §7）：chip 多选、链成员置顶（选中 = 以该
// 用户建/复用 person）、词典搜索（前端过滤）、自由文本回车新建（幂等 POST）。
// AI 抽取行带「AI」角标（轻标识），悬停提示走 ui/tooltip（Menu/Popover/Tooltip 规范 §9）。
//
// 视觉全部复用既有模式，不新增 token：chip 与 TemplateFields 词表 chip 同一形状
// （template-fields.tsx 既有 CHIP_BASE/CHIP_ON/CHIP_OFF，类名逐字一致）；地点文本框走
// Field 家族 TextField（Field/Input 规范 §2.2/§8，label 可见 + isOptional）；
// EXIF chip 移除走 IconButton（Button 规范）。
// props-driven observer（镜像 template-fields.tsx 的 service prop 范式）。

const CHIP_BASE =
  'rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus';
const CHIP_ON = 'border-transparent bg-select text-select-fg';
const CHIP_OFF = 'border-line text-ink hover:bg-floating-hover';

export const PersonPicker = observer(function PersonPicker({ service }: { service: ComposePanelService }) {
  const query = service.personQuery.trim().toLowerCase();
  // 词典搜索（偏差 6）：前端 includes 过滤；已由链成员 chip 代表的 user_id 链接行不重复出现（偏差 7）
  const linkedUserIds = new Set(service.members.map((m) => m.userId));
  const dictionary = service.personList.filter(
    (p) => (!p.userId || !linkedUserIds.has(p.userId)) && p.name.toLowerCase().includes(query),
  );
  // 已选但不在词典的行（编辑模式词典未加载时的 ai 人物等）仍可见可删：
  // 纯前端并入词典 chip 组并置顶渲染（PersonBrief 结构上含 PersonResponse 全字段，直用）
  const dictionaryIds = new Set(service.personList.map((p) => p.id));
  const selectedOnly = service.selectedPersons.filter(
    (p) =>
      !dictionaryIds.has(p.id) &&
      (!p.userId || !linkedUserIds.has(p.userId)) &&
      p.name.toLowerCase().includes(query),
  );
  const selectedIds = new Set(service.selectedPersons.map((p) => p.id));
  const memberSelected = (m: ChainMemberDto) => service.selectedPersons.some((p) => p.userId === m.userId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-meta text-muted">和谁在一起</p>
        <div className="flex flex-wrap items-center gap-2" aria-label="人物">
          {/* 链成员置顶（spec §7）：选中即建/复用 user_id 链接的 person */}
          {service.members.map((m) => (
            <button
              key={m.userId}
              type="button"
              aria-pressed={memberSelected(m)}
              onClick={() => void service.toggleMember(m)}
              className={`${CHIP_BASE} ${memberSelected(m) ? CHIP_ON : CHIP_OFF}`}
            >
              {m.nickname}
            </button>
          ))}
          {selectedOnly.map((p) => (
            <DictionaryChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
          ))}
          {dictionary.map((p) => (
            <DictionaryChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void service.submitPersonQuery();
            }}
          >
            <Input
              aria-label="搜索或新建人物"
              value={service.personQuery}
              onChange={(e) => (service.personQuery = e.target.value)}
              placeholder="搜索或回车新建"
              className="w-40"
            />
          </form>
        </div>
      </div>

      <TextField
        label="在哪里"
        name="place"
        isOptional
        value={service.placeName}
        onChange={(v) => service.setPlaceName(v)}
        placeholder="比如：外婆家"
      />
      {service.placeCoords && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-caption text-ink">
            <MapPin aria-hidden="true" size={16} />
            已从照片读取位置
          </span>
          <IconButton icon={X} label="移除照片位置" variant="secondary" onClick={() => service.removePlaceCoords()} />
        </div>
      )}
    </div>
  );
});

/** 词典 chip：选中的 ai 来源行带「AI」角标（spec §7 轻标识），Tooltip 悬停提示来源。 */
const DictionaryChip = observer(function DictionaryChip({
  service,
  person,
  selected,
}: {
  service: ComposePanelService;
  person: PersonResponse;
  selected: boolean;
}) {
  const source = service.selectedPersons.find((p) => p.id === person.id)?.source;
  const chip = (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() =>
        service.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: source ?? 'manual' })
      }
      className={`${CHIP_BASE} ${selected ? CHIP_ON : CHIP_OFF}`}
    >
      {person.name}
      {selected && source === 'ai' && <span className="ml-1 text-muted">AI</span>}
    </button>
  );
  return selected && source === 'ai' ? (
    <Tooltip label="AI 从这条时刻的文字里认出来的人物">{chip}</Tooltip>
  ) : (
    chip
  );
});
