import { StyleSheet, Text } from 'react-native';

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({ error: { color: '#d33', fontSize: 13 } });
