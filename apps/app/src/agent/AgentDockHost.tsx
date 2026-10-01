import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MomentResponse } from '@moment/dto';
import { Button } from '../components/Button';
import { ErrorText } from '../components/ErrorText';
import { Icon } from '../components/Icon';
import { confirm } from '../components/feedback';
import { UserAvatar } from '../components/UserAvatar';
import { formatMomentTimeShort } from '../lib/format';
import { AuthService } from '../services/auth.service';
import { AgentDockService, agentDockText } from '../services/agent-dock.service';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { AgentMarkdown } from './markdown-text';
import { agentMarkdownTarget, type AgentMdLink } from './markdown';
import { agentNavHref, agentPageContext, agentSuggestions, showAgentDock } from './visibility';

/** (tabs)/_layout.tsx 的 Tab 栏内容高。沿用现有值，不新造 token。 */
const TAB_BAR_CONTENT_HEIGHT = 48;

export const AgentDockHost = observer(function AgentDockHost() {
  const auth = useService(AuthService);
  const dock = useService(AgentDockService);
  const pathname = usePathname();
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  const [history, setHistory] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const context = agentPageContext(pathname);
  const visible = showAgentDock(pathname, auth.user !== null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => setKeyboard(event.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!dock.open) setHistory(false);
  }, [dock.open]);

  useEffect(() => {
    const nav = dock.pendingNav;
    if (!nav) return;
    const href = agentNavHref(nav);
    dock.ackNav();
    router.push(href);
  }, [dock, dock.pendingNav]);

  if (!visible) return null;

  const openLink = (link: AgentMdLink): void => {
    const target = agentMarkdownTarget(link);
    if (target.external) {
      void Linking.openURL(target.href);
      return;
    }
    router.push(target.href);
  };

  const openMoment = (momentId: string): void => {
    router.push(`/moments/${momentId}`);
  };

  if (!dock.open) {
    return (
      <View pointerEvents="box-none" style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="问问时刻"
          onPress={() => {
            setHistory(false);
            void dock.openPanel();
          }}
          style={({ pressed }) => [
            styles.entry,
            { bottom: insets.bottom + TAB_BAR_CONTENT_HEIGHT + t.space4 },
            pressed && styles.entryPressed,
          ]}
        >
          <Icon name="message-circle" size={t.space6} color={t.actionFg} />
        </Pressable>
      </View>
    );
  }

  const current = dock.threads.find((thread) => thread.id === dock.threadId);
  const title = dock.threadId ? (current?.title ?? '新的对话') : '问问时刻';
  const panelHeight = Math.min(windowHeight * 0.7, windowHeight - keyboard);
  const suggestions = dock.messages.length === 0 && !history ? agentSuggestions(context) : [];

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View
        style={[
          styles.panel,
          {
            height: panelHeight,
            bottom: keyboard,
            paddingBottom: keyboard > 0 ? t.space3 : insets.bottom + t.space3,
          },
        ]}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.actions}>
          <Button variant="quiet" disabled={dock.streaming} onPress={() => { setHistory(false); dock.newChat(); }}>
            新对话
          </Button>
          <Button variant="quiet" onPress={() => setHistory((open) => !open)}>
            {history ? '返回' : '历史'}
          </Button>
          <Button variant="quiet" onPress={() => dock.closePanel()}>
            收起
          </Button>
        </View>

        {history ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.history} keyboardShouldPersistTaps="handled">
            {dock.threads.length === 0 ? <Text style={styles.hint}>还没有对话</Text> : null}
            {dock.threads.map((thread) => (
              <View key={thread.id} style={styles.historyRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={dock.streaming}
                  onPress={() => {
                    setHistory(false);
                    void dock.selectThread(thread.id);
                  }}
                  style={({ pressed }) => [styles.historyTitle, pressed && styles.pressedRow]}
                >
                  <Text numberOfLines={1} style={styles.body}>
                    {thread.title}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除${thread.title}`}
                  accessibilityState={{ disabled: dock.streaming }}
                  disabled={dock.streaming}
                  onPress={() => {
                    if (dock.streaming) return;
                    void confirm({
                      title: '删除这则对话？',
                      body: '删掉之后就不能再看了。',
                      confirmLabel: '删除',
                      danger: true,
                    }).then((ok) => {
                      if (ok && !dock.streaming) return dock.deleteThread(thread.id);
                      return undefined;
                    });
                  }}
                  style={[styles.deleteHit, dock.streaming && styles.disabled]}
                >
                  <Text style={styles.deleteText}>删除</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView
            ref={scroller}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          >
            {dock.messages.map((message) =>
              message.role === 'user' ? (
                <View key={message.id} style={styles.userBubble}>
                  <Text style={styles.userText}>{message.content}</Text>
                </View>
              ) : message.content.length === 0 && message.moments.length === 0 ? null : (
                <View key={message.id} style={styles.assistant}>
                  {message.content.length > 0 ? <AgentMarkdown content={message.content} onLink={openLink} /> : null}
                  {message.moments.map((moment) => (
                    <MomentChip key={moment.id} moment={moment} onPress={() => openMoment(moment.id)} />
                  ))}
                </View>
              ),
            )}
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="secondary"
                disabled={dock.streaming}
                onPress={() => void dock.send(suggestion, context)}
              >
                {suggestion}
              </Button>
            ))}
          </ScrollView>
        )}

        {dock.streaming && dock.statusText ? <Text style={styles.hint}>{dock.statusText}</Text> : null}
        {dock.unavailable ? <Text style={styles.hint}>{agentDockText.unavailable}</Text> : null}
        <ErrorText message={dock.error} />
        <View style={styles.composer}>
          <TextInput
            value={dock.draft}
            onChangeText={(value) => {
              dock.draft = value;
            }}
            editable={!dock.streaming}
            multiline
            placeholder={dock.unavailable ? agentDockText.unavailable : '问问家里的事'}
            placeholderTextColor={t.muted}
            textAlignVertical="top"
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            style={[styles.input, inputFocused && styles.inputFocused]}
          />
          {dock.streaming ? (
            <Button variant="primary" onPress={() => dock.stop()}>
              停止
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={dock.draft.trim().length === 0}
              onPress={() => {
                setHistory(false);
                void dock.send(dock.draft, context);
              }}
            >
              发送
            </Button>
          )}
        </View>
      </View>
    </View>
  );
});

function MomentChip({ moment, onPress }: { moment: MomentResponse; onPress: () => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="打开时刻" onPress={onPress} style={styles.card}>
      <UserAvatar url={moment.author.avatarUrl} name={moment.author.nickname} size={t.space8} />
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardAuthor}>
          {moment.author.nickname}
          <Text style={styles.hint}> · {formatMomentTimeShort(moment.happenedAt, moment.happenedTzOffset)}</Text>
        </Text>
        {moment.content.length > 0 ? (
          <Text numberOfLines={3} style={styles.body}>
            {moment.content}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject },
    entry: {
      position: 'absolute',
      right: t.space4,
      width: t.touchMin,
      height: t.touchMin,
      borderRadius: t.touchMin / 2,
      backgroundColor: t.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entryPressed: { opacity: 0.85 },
    panel: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'column',
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radiusLg,
      borderTopRightRadius: t.radiusLg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
      paddingHorizontal: t.space4,
      paddingTop: t.space4,
      gap: t.space3,
    },
    flex: { flex: 1, minHeight: 0 },
    title: { fontSize: t.fontInput, fontWeight: '700', color: t.ink },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 },
    messages: { gap: t.space3, paddingBottom: t.space2 },
    history: { gap: t.space2, paddingBottom: t.space2 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    historyTitle: { flex: 1, minWidth: 0, minHeight: t.touchMin, justifyContent: 'center' },
    pressedRow: { backgroundColor: t.pressedSoft },
    deleteHit: { minHeight: t.touchMin, justifyContent: 'center', paddingHorizontal: t.space2 },
    deleteText: { color: t.danger, fontSize: t.fontLabel, fontWeight: '600' },
    disabled: { opacity: t.disabledOpacity },
    assistant: { gap: t.space2, alignSelf: 'stretch' },
    userBubble: {
      alignSelf: 'flex-end',
      maxWidth: '100%',
      backgroundColor: t.fieldBg,
      borderRadius: t.radiusMd,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
    },
    userText: { fontSize: t.fontBody, color: t.ink },
    body: { fontSize: t.fontBody, color: t.ink },
    hint: { fontSize: t.fontCaption, color: t.muted },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      minHeight: t.touchMin,
      backgroundColor: t.bg,
      borderRadius: t.radiusMd,
      padding: t.space3,
    },
    cardBody: { flex: 1, minWidth: 0, gap: t.space1 },
    cardAuthor: { fontSize: t.fontLabel, fontWeight: '600', color: t.ink },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: t.space2 },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: t.fieldH,
      maxHeight: t.space8 * 4,
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: t.fieldRadius,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      fontSize: t.fontInput,
      color: t.ink,
      backgroundColor: t.fieldBg,
    },
    inputFocused: { borderColor: t.focus },
  });
