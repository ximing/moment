import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// RN 最小 Markdown 渲染（spec §10 演进项）。
// 处理 ## / ### 标题、- 列表、**加粗**（去标记纯文本）、段落。
// 不引新依赖；全部消费 theme token。
// RN 无 dangerouslySetInnerHTML，天然防 XSS。

/** 去除 ** 标记（RN Text 不支持 inline 样式拆分，简化为去标记纯文本） */
function stripBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

export function RecapMarkdownText({ content }: { content: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  const blocks = content.split(/\n\n+/);

  return (
    <View style={styles.container}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const first = lines[0] ?? '';

        if (first.startsWith('### ')) {
          return <Text key={bi} style={styles.h3}>{stripBold(first.slice(4))}</Text>;
        }
        if (first.startsWith('## ')) {
          return <Text key={bi} style={styles.h2}>{stripBold(first.slice(3))}</Text>;
        }
        if (first.startsWith('# ')) {
          return <Text key={bi} style={styles.h1}>{stripBold(first.slice(2))}</Text>;
        }
        // 列表
        const listLines = lines.filter((l) => l.startsWith('- '));
        if (listLines.length > 0 && lines.every((l) => l.startsWith('- ') || l.startsWith('  '))) {
          return (
            <View key={bi} style={styles.list}>
              {listLines.map((l, li) => (
                <Text key={li} style={styles.listItem}>· {stripBold(l.slice(2))}</Text>
              ))}
            </View>
          );
        }
        // 段落
        return <Text key={bi} style={styles.paragraph}>{stripBold(block)}</Text>;
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: { gap: t.space3 },
    h1: { fontSize: t.fontBody, fontWeight: '700', color: t.ink },
    h2: { fontSize: t.fontBody, fontWeight: '600', color: t.ink },
    h3: { fontSize: t.fontLabel, fontWeight: '600', color: t.ink },
    paragraph: { fontSize: t.fontBody, lineHeight: 24, color: t.ink },
    list: { gap: t.space1, paddingLeft: t.space2 },
    listItem: { fontSize: t.fontBody, lineHeight: 24, color: t.ink },
  });
