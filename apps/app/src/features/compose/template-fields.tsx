import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { observer } from '@rabjs/react';
import type { TemplateManifest, TemplateMomentField } from '@moment/dto';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { AppIcon } from '../../components/AppIcon';
import { useTheme } from '../../theme/use-theme';
import type { ComposeService } from './compose.service';

// 词表通用渲染器（spec §5 硬纪律）：按 manifest 的 momentFields / kinds 声明渲染，
// 不出现模板 key 分支。kind 表单渲染 payloadSchema 的受限子集：
// enum → chips、number → 数字输入、其余 string → 文本输入；payloadSchema 有 catalog_key
// 且 manifest 带 milestoneCatalog 时渲染目录 chips。词表/schema 子集外的声明静默不渲染
// （server 是最终校验，app 只做录入辅助）。

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

function useChipStyles() {
  const t = useTheme();
  return useMemo(
    () =>
      // 尺寸全部上 token 档（H1：新文件不吃旧值的迁移平移豁免）；
      // 选中态对齐 SegmentBar：ink 色面 + bg 文字（primary 只留给发布/保存）
      StyleSheet.create({
        chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space2 },
        chip: { paddingHorizontal: t.space3, paddingVertical: t.space2, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft, minHeight: t.touchMin, justifyContent: 'center' as const },
        chipActive: { backgroundColor: t.ink },
        chipText: { fontSize: t.fontSupport, color: t.muted },
        chipTextActive: { color: t.bg, fontWeight: '600' as const },
        chipInner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space1 },
        label: { fontSize: t.fontLabel, color: t.ink, marginBottom: t.space1 },
        geoText: { fontSize: t.fontSupport, color: t.muted },
        section: { gap: t.space2, marginBottom: t.space3 },
      }),
    [t],
  );
}

/** 单个 momentField 的词表渲染（emoji-picker/geo/enum/date/number-unit/text）。 */
const MomentFieldControl = observer(function MomentFieldControl({
  service,
  field,
}: {
  service: ComposeService;
  field: TemplateMomentField;
}) {
  const styles = useChipStyles();
  const t = useTheme();
  const value = service.payloadDraft[field.key];

  if (field.type === 'emoji-picker' || field.type === 'enum') {
    return (
      <View style={styles.chipRow} accessibilityLabel={field.label}>
        {(field.options ?? []).map((opt) => (
          <Pressable
            key={opt}
            style={[styles.chip, value === opt && styles.chipActive]}
            onPress={() => service.setFieldValue(field.key, value === opt ? undefined : opt)}
          >
            {/* emoji-picker 的数据值走 AppIcon（P3-2）；写回草稿的仍是 emoji 原文 */}
            {field.type === 'emoji-picker' ? (
              <AppIcon value={opt} size={t.fontSupport} />
            ) : (
              <Text style={[styles.chipText, value === opt && styles.chipTextActive]}>
                {ENUM_LABELS[opt] ?? opt}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    );
  }

  if (field.type === 'geo') {
    const geo = value as { lat: number; lng: number; place_name?: string } | undefined;
    return (
      <View style={styles.section}>
        <View style={styles.chipRow}>
          <Button
            variant="secondary"
            loading={service.geoBusy}
            // pickGeo 返回问题文案（null=成功），照 compose/index.tsx onPickVideo 模式接住并 Alert（评审 B1）
            onPress={() =>
              void service.pickGeo(field.key).then((problem) => {
                if (problem) Alert.alert('提示', problem);
              })
            }
          >
            {geo ? '重新定位' : field.label}
          </Button>
          {geo ? (
            <Button variant="quiet" onPress={() => service.setFieldValue(field.key, undefined)}>
              去掉位置
            </Button>
          ) : null}
        </View>
        {geo ? (
          <>
            <Text style={styles.geoText}>
              已添加位置（{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}）
            </Text>
            <Field
              label="地点名（可选）"
              value={geo.place_name ?? ''}
              onChangeText={(v) => service.setFieldValue(field.key, { ...geo, place_name: v || undefined })}
              placeholder="给这个位置起个名"
            />
          </>
        ) : null}
      </View>
    );
  }

  if (field.type === 'number-unit') {
    const nu = value as { value?: number; unit?: string } | undefined;
    return (
      <View style={styles.section}>
        <Field
          label={`${field.label}数值`}
          keyboardType="numeric"
          value={nu?.value === undefined ? '' : String(nu.value)}
          onChangeText={(v) => {
            const num = v === '' ? undefined : Number(v);
            const unit = nu?.unit ?? field.options?.[0] ?? '';
            service.setFieldValue(field.key, num === undefined || Number.isNaN(num) ? undefined : { value: num, unit });
          }}
          placeholder="数值"
        />
        <Field
          label={`${field.label}单位`}
          value={nu?.unit ?? field.options?.[0] ?? ''}
          onChangeText={(v) =>
            // 先填单位会产生 {value:0, unit} 半成品（P4 S6 同口径）：server 校验兜底拒收，端上不做跨字段校验
            service.setFieldValue(field.key, { value: nu?.value ?? 0, unit: v })
          }
          placeholder="单位"
        />
      </View>
    );
  }

  if (field.type === 'date') {
    // 官方模板暂不使用 date 词表；文本输入 YYYY-MM-DD，server 校验格式（简化取舍，报告声明）
    return (
      <Field
        label={field.label}
        value={typeof value === 'string' ? value : ''}
        onChangeText={(v) => service.setFieldValue(field.key, v || undefined)}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  // text
  return (
    <Field
      label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChangeText={(v) => service.setFieldValue(field.key, v || undefined)}
    />
  );
});

/** kind payload 表单：渲染 payloadSchema 受限子集（object properties；enum→chips，number→数字，其余 string→文本）。 */
const KindPayloadForm = observer(function KindPayloadForm({
  service,
  manifest,
  kindKey,
}: {
  service: ComposeService;
  manifest: TemplateManifest;
  kindKey: string;
}) {
  const styles = useChipStyles();
  const t = useTheme();
  const kindDef = (manifest.kinds ?? []).find((k) => k.key === kindKey);
  if (!kindDef) return null;
  const schema = kindDef.payloadSchema as {
    properties?: Record<string, { type?: string; enum?: string[] }>;
  };
  const props = schema.properties ?? {};
  const catalog = manifest.milestoneCatalog ?? [];

  return (
    <View style={styles.section}>
      {'catalog_key' in props && catalog.length > 0 ? (
        <View style={styles.chipRow} accessibilityLabel="里程碑">
          {catalog.map((c) => (
            <Pressable
              key={c.key}
              style={[styles.chip, service.payloadDraft.catalog_key === c.key && styles.chipActive]}
              onPress={() =>
                service.setFieldValue('catalog_key', service.payloadDraft.catalog_key === c.key ? undefined : c.key)
              }
            >
              {/* 目录 icon 是数据值（key / 存量 emoji 两种形态），走 AppIcon（P3-2）；写回仍是 catalog key */}
              <View style={styles.chipInner}>
                {c.icon ? <AppIcon value={c.icon} size={t.fontSupport} /> : null}
                <Text style={[styles.chipText, service.payloadDraft.catalog_key === c.key && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {Object.entries(props).map(([key, prop]) => {
        if (key === 'catalog_key' && catalog.length > 0) return null; // 已由目录 chips 承担
        const value = service.payloadDraft[key];
        if (prop.enum) {
          return (
            <View key={key} style={styles.chipRow} accessibilityLabel={key}>
              {prop.enum.map((opt) => (
                <Pressable
                  key={opt}
                  style={[styles.chip, value === opt && styles.chipActive]}
                  onPress={() => service.setFieldValue(key, value === opt ? undefined : opt)}
                >
                  <Text style={[styles.chipText, value === opt && styles.chipTextActive]}>{ENUM_LABELS[opt] ?? opt}</Text>
                </Pressable>
              ))}
            </View>
          );
        }
        if (prop.type === 'number') {
          return (
            <Field
              key={key}
              label={key === 'value' ? '数值' : key}
              keyboardType="numeric"
              value={typeof value === 'number' ? String(value) : ''}
              onChangeText={(v) => {
                const num = v === '' ? undefined : Number(v);
                service.setFieldValue(key, num === undefined || Number.isNaN(num) ? undefined : num);
              }}
            />
          );
        }
        return (
          <Field
            key={key}
            label={key === 'custom_label' ? '自定义里程碑（或从上面选）' : key === 'note' ? '随手记一句（可选）' : key}
            value={typeof value === 'string' ? value : ''}
            onChangeText={(v) => service.setFieldValue(key, v || undefined)}
          />
        );
      })}
    </View>
  );
});

/** 发布面板的模板扩展区：kinds 入口（publisher.label）+ 当前 kind 表单 / standard 的 momentFields。 */
export const TemplateFields = observer(function TemplateFields({
  service,
  edit,
}: {
  service: ComposeService;
  edit: boolean;
}) {
  const styles = useChipStyles();
  const manifest = service.manifest;
  if (!manifest) return null;
  const kinds = manifest.kinds ?? [];
  const fields = manifest.momentFields ?? [];
  if (kinds.length === 0 && fields.length === 0) return null;

  return (
    <View style={styles.section}>
      {!edit && kinds.length > 0 ? (
        <View style={styles.chipRow}>
          {kinds.map((k) => (
            // 选中态对齐 SegmentBar（ink 色面 + bg 文字，评审 H2）；primary 只留给发布/保存
            <Pressable
              key={k.key}
              style={[styles.chip, service.kind === k.key && styles.chipActive]}
              onPress={() => service.setKind(service.kind === k.key ? 'standard' : k.key)}
            >
              <Text style={[styles.chipText, service.kind === k.key && styles.chipTextActive]}>
                {k.publisher?.label ?? k.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {service.kind !== 'standard' ? (
        <KindPayloadForm service={service} manifest={manifest} kindKey={service.kind} />
      ) : (
        fields.map((f) => (
          <View key={f.key}>
            <Text style={styles.label}>{f.label}</Text>
            <MomentFieldControl service={service} field={f} />
          </View>
        ))
      )}
    </View>
  );
});
