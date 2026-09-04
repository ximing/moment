import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { observer } from '@rabjs/react';
import type { ChainMemberDto, PersonResponse } from '@moment/dto';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/feedback';
import { useTheme } from '../../theme/use-theme';
import type { Theme } from '../../theme/theme';
import type { ComposeService } from './compose.service';

// 人物选择器 + 地点输入（spec people-place §7；UX 语义镜像 web P5 Task 4 已评审结论）：
// chip 多选、链成员置顶（选中 = 以该用户建/复用 person，P5 偏差 7）、词典搜索（前端过滤，
// P5 偏差 6）、自由文本回车新建（幂等 POST）；已选未入册行并入 chip 组可见可删（P5 偏差 8）；
// AI 抽取行带「AI」轻标识 + accessibilityLabel 提示（RN 无 hover，P6 偏差 8）。
// 地点：Field 文本输入 + EXIF chip（可移除，移除后本会话不再自动回填，P5 偏差 2）；
// 编辑回读的坐标 chip 文案与 EXIF 相同（P5 偏差 11）。
// 样式纪律（app design tokens spec）：全部上 token 档，chip 范式逐字镜像 template-fields.tsx
// （hoverSoft 底 / 选中 ink 色面 + bg 文字，primary 只留给发布/保存）。
// toggleMember/submitPersonQuery 的 POST 失败走 toast.error（对齐 compose 发布失败通道）。

function personPickerOnPressError(err: unknown): void {
  toast.error(err);
}

export const PersonPicker = observer(function PersonPicker({ service }: { service: ComposeService }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const query = service.personQuery.trim().toLowerCase();
  // 词典搜索（P5 偏差 6）：前端 includes 过滤；已由链成员 chip 代表的 userId 链接行不重复出现（P5 偏差 7）
  const linkedUserIds = new Set(service.members.map((m) => m.userId));
  const dictionary = service.personList.filter(
    (p) => (!p.userId || !linkedUserIds.has(p.userId)) && p.name.toLowerCase().includes(query),
  );
  // 已选但不在词典的行（编辑模式词典未加载时的 ai 人物等）并入 chip 组置顶渲染（P5 偏差 8）
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
    <View style={styles.section}>
      <Text style={styles.label}>和谁在一起</Text>
      <View style={styles.chipRow} accessibilityLabel="人物">
        {/* 链成员置顶（spec §7）：选中即建/复用 user_id 链接的 person */}
        {service.members.map((m) => (
          <Pressable
            key={m.userId}
            style={[styles.chip, memberSelected(m) && styles.chipActive]}
            onPress={() => void service.toggleMember(m).catch(personPickerOnPressError)}
          >
            <Text style={[styles.chipText, memberSelected(m) && styles.chipTextActive]}>{m.nickname}</Text>
          </Pressable>
        ))}
        {selectedOnly.map((p) => (
          <PersonChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
        ))}
        {dictionary.map((p) => (
          <PersonChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
        ))}
      </View>
      <Field
        label="搜索或新建人物"
        value={service.personQuery}
        onChangeText={(v) => (service.personQuery = v)}
        onSubmitEditing={() => void service.submitPersonQuery().catch(personPickerOnPressError)}
        placeholder="输入名字，回车新建"
        returnKeyType="done"
      />
      <Field
        label="在哪里"
        value={service.placeName}
        onChangeText={(v) => service.setPlaceName(v)}
        placeholder="比如：外婆家"
      />
      {service.placeCoords ? (
        <View style={styles.exifRow}>
          <View style={styles.exifChip}>
            <Icon name="map-pin" size={t.fontSupport} />
            <Text style={styles.exifChipText}>已从照片读取位置</Text>
          </View>
          <Button variant="quiet" onPress={() => service.removePlaceCoords()}>
            移除
          </Button>
        </View>
      ) : null}
    </View>
  );
});

/** 词典/已选 chip：选中的 ai 来源行带「AI」轻标识（spec §7），accessibilityLabel 承载来源提示。 */
const PersonChip = observer(function PersonChip({
  service,
  person,
  selected,
}: {
  service: ComposeService;
  person: PersonResponse;
  selected: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const source = service.selectedPersons.find((p) => p.id === person.id)?.source;
  const isAi = selected && source === 'ai';
  return (
    <Pressable
      accessibilityLabel={isAi ? `${person.name}（AI 从这条时刻的文字里认出来的人物）` : person.name}
      style={[styles.chip, selected && styles.chipActive]}
      onPress={() =>
        service.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: source ?? 'manual' })
      }
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
        {person.name}
        {isAi ? <Text style={styles.aiBadge}> AI</Text> : null}
      </Text>
    </Pressable>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    section: { gap: t.space2, marginBottom: t.space3 },
    label: { fontSize: t.fontLabel, color: t.ink },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    chip: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg, fontWeight: '600' },
    aiBadge: { color: t.muted, fontSize: t.fontCaption },
    exifRow: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    exifChip: { flexDirection: 'row', alignItems: 'center', gap: t.space1, paddingHorizontal: t.space3, paddingVertical: t.space2, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    exifChipText: { fontSize: t.fontSupport, color: t.ink },
  });
