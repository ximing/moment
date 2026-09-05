import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Banner, EmptyState, confirm, toast } from '../../components/feedback';
import { humanError } from '../../lib/errors';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainSettingsService } from './chain-settings.service';

export const PeopleSection = observer(function PeopleSection() {
  const service = useService(ChainSettingsService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const error = service.$model.addPerson.error ?? service.$model.renamePerson.error ?? service.$model.removePerson.error;

  function onDelete(id: string, name: string): void {
    void confirm({
      title: `去掉「${name}」？`,
      body: '已经记在时刻上的「和谁在一起」也会一起去掉，时刻本身还在。',
      confirmLabel: '去掉',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service.removePerson(id).catch((err) => toast.error(err));
    });
  }

  return (
    <View style={styles.block}>
      <Text style={styles.hint}>记下时刻时可以从这份名单里勾选和谁在一起。</Text>
      {error ? <Banner tone="error">{humanError(error)}</Banner> : null}
      {service.persons.length === 0 ? (
        <EmptyState variant="plain" scope="section" title="还没有人物" description="先加上外婆、妈妈这些常用的名字。" />
      ) : (
        service.persons.map((p) => (
          <View key={p.id} style={styles.row}>
            {editingId === p.id ? (
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                onBlur={() => {
                  void service.renamePerson(p.id, draft).catch((err) => toast.error(err));
                  setEditingId(null);
                }}
                autoFocus
                maxLength={50}
              />
            ) : (
              <Pressable
                style={styles.rowMain}
                onPress={() => {
                  setEditingId(p.id);
                  setDraft(p.name);
                }}
              >
                <Text style={styles.name}>{p.name}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => onDelete(p.id, p.name)} hitSlop={{ top: 10, bottom: 10 }}>
              <Text style={styles.danger}>去掉</Text>
            </Pressable>
          </View>
        ))
      )}
      <Field
        label="新人物"
        value={service.newPersonName}
        onChangeText={(v) => (service.newPersonName = v)}
        placeholder="新人物"
        maxLength={50}
      />
      <Button
        variant="secondary"
        disabled={!service.newPersonName.trim()}
        loading={service.$model.addPerson.loading}
        onPress={() => void service.addPerson().catch((err) => toast.error(err))}
      >
        添加
      </Button>
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    block: { gap: t.space3 },
    hint: { fontSize: t.fontCaption, color: t.muted },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
    },
    rowMain: { flex: 1, minWidth: 0 },
    name: { fontSize: t.fontBody, color: t.ink },
    input: {
      flex: 1,
      minWidth: 0,
      borderRadius: t.fieldRadius,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      backgroundColor: t.fieldBg,
      color: t.ink,
      fontSize: t.fontBody,
    },
    danger: { color: t.danger, fontSize: t.fontSupport },
  });
