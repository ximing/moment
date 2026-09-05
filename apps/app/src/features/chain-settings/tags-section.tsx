import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Banner, EmptyState, confirm, toast } from '../../components/feedback';
import { humanError } from '../../lib/errors';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainSettingsService } from './chain-settings.service';

export const TagsSection = observer(function TagsSection() {
  const service = useService(ChainSettingsService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const error = service.$model.addTag.error ?? service.$model.deleteTag.error;

  function onDelete(id: string, name: string): void {
    void confirm({
      title: '删除标签',
      body: `删除「${name}」将从相关时刻上移除`,
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service.deleteTag(id).catch((err) => toast.error(err));
    });
  }

  return (
    <View style={styles.block}>
      <Text style={styles.hint}>记下时刻时可以从这份名单里给这一刻贴标签。</Text>
      {error ? <Banner tone="error">{humanError(error)}</Banner> : null}
      {service.tags.length === 0 ? (
        <EmptyState
          variant="plain"
          scope="section"
          title="还没有标签"
          description="给这条链的时刻加上标签，方便以后翻找。"
        />
      ) : (
        service.tags.map((tag) => (
          <View key={tag.id} style={styles.row}>
            <Text style={styles.name}>#{tag.name}（{tag.momentCount} 条）</Text>
            <Pressable onPress={() => onDelete(tag.id, tag.name)} hitSlop={{ top: 10, bottom: 10 }}>
              <Text style={styles.danger}>删除</Text>
            </Pressable>
          </View>
        ))
      )}
      <Field
        label="新标签"
        value={service.newTagName}
        onChangeText={(v) => (service.newTagName = v)}
        placeholder="新标签"
      />
      <Button
        variant="secondary"
        disabled={!service.newTagName.trim()}
        loading={service.$model.addTag.loading}
        onPress={() => void service.addTag().catch((err) => toast.error(err))}
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
      justifyContent: 'space-between',
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
    },
    name: { flex: 1, fontSize: t.fontBody, color: t.ink },
    danger: { color: t.danger, fontSize: t.fontSupport },
  });
