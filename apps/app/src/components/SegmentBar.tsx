import { Pressable, StyleSheet, Text, View } from 'react-native';

export function SegmentBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} style={[styles.seg, value === o.value && styles.segActive]} onPress={() => onChange(o.value)}>
          <Text style={[styles.segText, value === o.value && styles.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f2f2f2', alignItems: 'center' },
  segActive: { backgroundColor: '#4a90d9' },
  segText: { color: '#444', fontSize: 13 },
  segTextActive: { color: '#fff', fontWeight: '600' },
});
