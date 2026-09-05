import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { observer } from '@rabjs/react';
import type { ChainMemberDto, PersonResponse } from '@moment/dto';
import { Field } from '../../components/Field';
import { toast } from '../../components/feedback';
import { useTheme } from '../../theme/use-theme';
import type { Theme } from '../../theme/theme';
import type { ComposeService } from './compose.service';

// 人物选择器（spec people-place §7；地点行在 compose 主页）：
// chip 多选、链成员置顶、词典搜索、自由文本回车新建；已选未入册行并入 chip 组。
// AI 抽取行带「AI」轻标识。toggleMember/submitPersonQuery 失败走 toast.error。

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
      <View style={styles.chipRow} accessibilityLabel="和谁在一起">
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
        accessibilityLabel="搜索或新建人物"
        value={service.personQuery}
        onChangeText={(v) => (service.personQuery = v)}
        onSubmitEditing={() => void service.submitPersonQuery().catch(personPickerOnPressError)}
        placeholder="输入名字，回车添加"
        returnKeyType="done"
      />
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
    section: { gap: t.space3 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    chip: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg, fontWeight: '600' },
    aiBadge: { color: t.muted, fontSize: t.fontCaption },
  });
