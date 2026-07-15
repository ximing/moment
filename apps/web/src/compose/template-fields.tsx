import { observer } from '@rabjs/react';
import { MapPin } from 'lucide-react';
import type { TemplateManifest, TemplateMomentField } from '@moment/dto';
import { Button } from '@/ui/button/index';
import { Field, Input } from '@/ui/field/index';
import type { ComposePanelService } from './compose-panel/compose-panel.service';

// 词表通用渲染器（spec §5 硬纪律）：按 manifest 的 momentFields / kinds 声明渲染，
// 不出现模板 key 分支。kind 表单渲染 payloadSchema 的受限子集：
// enum → chips、number → 数字输入、其余 string → 文本输入；payloadSchema 有 catalog_key
// 且 manifest 带 milestoneCatalog 时渲染目录 chips。词表/schema 子集外的声明静默不渲染
// （server 是最终校验，web 只做录入辅助）。

const CHIP_BASE =
  'rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus';
const CHIP_ON = 'border-transparent bg-select text-select-fg';
const CHIP_OFF = 'border-line text-ink hover:bg-floating-hover';

/** 词表内已知枚举值的展示文案（lib/template 的 METRIC_LABELS 超集；未知值用原文）。 */
const ENUM_LABELS: Record<string, string> = {
  height: '身高',
  weight: '体重',
  cm: 'cm',
  kg: 'kg',
  boy: '男宝',
  girl: '女宝',
  unknown: '未知',
};

/** 单个 momentField 的词表渲染（emoji-picker/geo/enum/date/number-unit/text）。 */
const MomentFieldControl = observer(function MomentFieldControl({
  service,
  field,
}: {
  service: ComposePanelService;
  field: TemplateMomentField;
}) {
  const value = service.payloadDraft[field.key];

  if (field.type === 'emoji-picker' || field.type === 'enum') {
    const options = field.options ?? [];
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={field.label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            onClick={() => service.setFieldValue(field.key, value === opt ? undefined : opt)}
            className={`${CHIP_BASE} ${value === opt ? CHIP_ON : CHIP_OFF}`}
          >
            {field.type === 'emoji-picker' ? opt : (ENUM_LABELS[opt] ?? opt)}
          </button>
        ))}
      </div>
    );
  }

  if (field.type === 'geo') {
    const geo = value as { lat: number; lng: number; place_name?: string } | undefined;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            leadingIcon={MapPin}
            loading={service.geoBusy}
            onClick={() => void service.pickGeo(field.key)}
          >
            {geo ? '重新定位' : field.label}
          </Button>
          {geo && (
            <span className="text-meta text-muted">
              已添加位置（{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}）
            </span>
          )}
          {geo && (
            <Button variant="quiet" onClick={() => service.setFieldValue(field.key, undefined)}>
              去掉位置
            </Button>
          )}
        </div>
        {geo && (
          <Input
            aria-label="地点名"
            value={geo.place_name ?? ''}
            onChange={(e) => service.setFieldValue(field.key, { ...geo, place_name: e.target.value || undefined })}
            placeholder="给这个位置起个名（可选）"
          />
        )}
      </div>
    );
  }

  if (field.type === 'number-unit') {
    const nu = value as { value?: number; unit?: string } | undefined;
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${field.label}数值`}
          type="number"
          value={nu?.value === undefined ? '' : String(nu.value)}
          onChange={(e) => {
            const num = e.target.value === '' ? undefined : Number(e.target.value);
            const unit = nu?.unit ?? field.options?.[0] ?? '';
            service.setFieldValue(field.key, num === undefined ? undefined : { value: num, unit });
          }}
          placeholder="数值"
        />
        <Input
          aria-label={`${field.label}单位`}
          value={nu?.unit ?? field.options?.[0] ?? ''}
          onChange={(e) =>
            // 先填单位会产生 {value:0, unit} 半成品（评审 S6）：value 缺省置 0 由 server 校验兜底拒收，
            // web 不做跨字段校验（spec §1.2：复杂校验在 server 业务层）
            service.setFieldValue(field.key, { value: nu?.value ?? 0, unit: e.target.value })
          }
          placeholder="单位"
          className="w-24"
        />
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <Input
        aria-label={field.label}
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => service.setFieldValue(field.key, e.target.value || undefined)}
      />
    );
  }

  // text
  return (
    <Input
      aria-label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => service.setFieldValue(field.key, e.target.value || undefined)}
    />
  );
});

/** kind payload 表单：渲染 payloadSchema 受限子集（object properties；enum→chips，number→数字，其余 string→文本）。 */
const KindPayloadForm = observer(function KindPayloadForm({
  service,
  manifest,
  kindKey,
}: {
  service: ComposePanelService;
  manifest: TemplateManifest;
  kindKey: string;
}) {
  const kindDef = (manifest.kinds ?? []).find((k) => k.key === kindKey);
  if (!kindDef) return null;
  const schema = kindDef.payloadSchema as {
    properties?: Record<string, { type?: string; enum?: string[]; pattern?: string; maxLength?: number }>;
  };
  const props = schema.properties ?? {};
  const catalog = manifest.milestoneCatalog ?? [];

  return (
    <div className="flex flex-col gap-3">
      {'catalog_key' in props && catalog.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="里程碑">
          {catalog.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={service.payloadDraft.catalog_key === c.key}
              onClick={() =>
                service.setFieldValue('catalog_key', service.payloadDraft.catalog_key === c.key ? undefined : c.key)
              }
              className={`${CHIP_BASE} ${service.payloadDraft.catalog_key === c.key ? CHIP_ON : CHIP_OFF}`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      )}
      {Object.entries(props).map(([key, prop]) => {
        if (key === 'catalog_key' && catalog.length > 0) return null; // 已由目录 chips 承担
        const value = service.payloadDraft[key];
        if (prop.enum) {
          return (
            <div key={key} className="flex flex-wrap items-center gap-2" role="group" aria-label={key}>
              {prop.enum.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={value === opt}
                  onClick={() => service.setFieldValue(key, value === opt ? undefined : opt)}
                  className={`${CHIP_BASE} ${value === opt ? CHIP_ON : CHIP_OFF}`}
                >
                  {ENUM_LABELS[opt] ?? opt}
                </button>
              ))}
            </div>
          );
        }
        if (prop.type === 'number') {
          return (
            <Input
              key={key}
              aria-label={key}
              type="number"
              value={typeof value === 'number' ? String(value) : ''}
              onChange={(e) =>
                service.setFieldValue(key, e.target.value === '' ? undefined : Number(e.target.value))
              }
              placeholder={key === 'value' ? '数值' : key}
            />
          );
        }
        return (
          <Input
            key={key}
            aria-label={key}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => service.setFieldValue(key, e.target.value || undefined)}
            placeholder={key === 'custom_label' ? '自定义里程碑（或从上面选）' : key === 'note' ? '随手记一句（可选）' : key}
          />
        );
      })}
    </div>
  );
});

/** 发布面板的模板扩展区：kinds 入口（publisher.label）+ 当前 kind 表单 / standard 的 momentFields。 */
export const TemplateFields = observer(function TemplateFields({
  service,
  edit,
}: {
  service: ComposePanelService;
  edit: boolean;
}) {
  const manifest = service.manifest;
  if (!manifest) return null;
  const kinds = manifest.kinds ?? [];
  const fields = manifest.momentFields ?? [];
  if (kinds.length === 0 && fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {!edit && kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((k) => (
            <Button
              key={k.key}
              variant={service.kind === k.key ? 'primary' : 'secondary'}
              onClick={() => service.setKind(service.kind === k.key ? 'standard' : k.key)}
            >
              {k.publisher?.label ?? k.label}
            </Button>
          ))}
        </div>
      )}
      {service.kind !== 'standard' ? (
        <KindPayloadForm service={service} manifest={manifest} kindKey={service.kind} />
      ) : (
        fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <MomentFieldControl service={service} field={f} />
          </Field>
        ))
      )}
    </div>
  );
});
