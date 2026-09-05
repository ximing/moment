import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { INTENT_MAX_QUERY_CHARS } from '@moment/dto';
import { Field } from './Field';

/** 时间线搜索：复用 Field + returnKeyType=search，不是新的 SearchBar。 */
export function TimelineSearchField({
  onSubmit,
  onClear,
}: {
  onSubmit: (q: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');

  function submit(): void {
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <View style={styles.wrap}>
      <Field
        accessibilityLabel="搜索时刻"
        value={q}
        onChangeText={(next) => {
          setQ(next);
          if (next === '') onClear();
        }}
        placeholder="搜索时刻，例如 去年今天和外婆"
        returnKeyType="search"
        onSubmitEditing={submit}
        clearButtonMode="while-editing"
        autoCorrect={false}
        enablesReturnKeyAutomatically
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 0 },
});
