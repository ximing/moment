import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { parseAgentMarkdown, type AgentMdInline, type AgentMdLink } from './markdown';

/** 助手 Markdown。内部链接只回调宿主，本组件不调用 Linking。 */
export function AgentMarkdown({ content, onLink }: { content: string; onLink: (link: AgentMdLink) => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const blocks = parseAgentMarkdown(content);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const heading = block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
          return (
            <Text key={index} style={heading}>
              <Inlines inlines={block.inlines} onLink={onLink} />
            </Text>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <Text key={itemIndex} style={styles.body}>
                  {block.ordered ? `${itemIndex + 1}. ` : '· '}
                  <Inlines inlines={item} onLink={onLink} />
                </Text>
              ))}
            </View>
          );
        }
        return (
          <Text key={index} style={styles.body}>
            <Inlines inlines={block.inlines} onLink={onLink} />
          </Text>
        );
      })}
    </View>
  );
}

function Inlines({ inlines, onLink }: { inlines: AgentMdInline[]; onLink: (link: AgentMdLink) => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.type === 'text') return <Text key={index}>{inline.text}</Text>;
        if (inline.type === 'bold') {
          return (
            <Text key={index} style={styles.bold}>
              <Inlines inlines={inline.children} onLink={onLink} />
            </Text>
          );
        }
        if (inline.type === 'code') {
          return (
            <Text key={index} style={styles.code}>
              {inline.text}
            </Text>
          );
        }
        return (
          <Text key={index} accessibilityRole="link" style={styles.link} onPress={() => onLink(inline)}>
            {inline.text}
          </Text>
        );
      })}
    </>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space3 },
    h1: { fontSize: t.fontInput, fontWeight: '700', color: t.ink },
    h2: { fontSize: t.fontBody, fontWeight: '700', color: t.ink },
    h3: { fontSize: t.fontLabel, fontWeight: '700', color: t.ink },
    body: { fontSize: t.fontBody, color: t.ink },
    list: { gap: t.space1, paddingLeft: t.space2 },
    bold: { fontWeight: '700' },
    code: { fontSize: t.fontSupport, color: t.ink, backgroundColor: t.fieldBg },
    link: { color: t.action },
  });
