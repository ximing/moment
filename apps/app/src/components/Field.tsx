import { StyleSheet, Text, TextInput, type TextInputProps } from 'react-native';

export function Field({ label, ...inputProps }: TextInputProps & { label: string }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#aaa" autoCapitalize="none" {...inputProps} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
});
