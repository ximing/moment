import { useEffect, useMemo } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { CHAIN_COLORS, CHAIN_ICONS } from '@moment/dto';
import { webUrl } from '../../lib/api';
import { AuthService } from '../../services/auth.service';
import { formatRelative } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { RequireAuth } from '../../components/RequireAuth';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { OverlayNav } from '../../components/OverlayNav';
import { confirm, toast } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { chainSheetItems, chainSheetTitle, type ChainSheetSection } from '../chain-home/chain-sheet';
import { ChainSettingsService } from './chain-settings.service';
import { JobsSection } from './jobs-section';
import { PeopleSection } from './people-section';
import { TagsSection } from './tags-section';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

/**
 * 文字入口（textBtn：fontSupport + paddingVertical space1 ≈ 26pt）命中区不足 touchMin 44pt，
 * 只纵向 hitSlop 补齐——不动视觉 padding，避免改变行内布局；
 * 横向不扩，防止 rowSide 内相邻文字按钮命中区交叠（spec §6 拍板项 4）。
 */
const textBtnHitSlop = { top: 10, bottom: 10 } as const;

function resolveSection(raw: string | undefined, role: string | undefined): ChainSheetSection {
  const allowed = chainSheetItems(role).map((i) => i.key);
  if (raw && allowed.includes(raw as ChainSheetSection)) return raw as ChainSheetSection;
  return role === 'owner' ? 'share' : 'members';
}

const Content = observer(function Content() {
  const { chainId, section: sectionParam } = useLocalSearchParams<{ chainId: string; section?: string }>();
  const service = useService(ChainSettingsService);
  const auth = useService(AuthService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  function onError(err: unknown, action: string): void {
    toast.error(err, action);
  }

  if (!service.chain && !service.$model.loadChain.error) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="这条链" />
        <Loading />
      </View>
    );
  }
  if (!service.chain) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="这条链" />
        <View style={styles.center}>
        <Text style={styles.muted}>链加载失败</Text>
        <Button variant="secondary" style={styles.centerBtn} onPress={() => void service.loadChain().catch(() => undefined)}>
          重试
        </Button>
        </View>
      </View>
    );
  }

  const isOwner = service.myRole === 'owner';
  // 服务端事实：createInvite 是 requireChainRole('editor')——owner/editor 都能生成；
  // 但 listInvites 仅 owner，editor 生成后看不到列表（吊销也只能 owner）。
  const canInvite = isOwner || service.myRole === 'editor';
  const myUserId = auth.user?.id;

  function onRolePress(userId: string, nickname: string, role: string): void {
    if (!isOwner || role === 'owner') return;
    Alert.alert('修改角色', `${nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => void service.changeRole(userId, r).catch((err) => onError(err, '改角色失败')),
        })),
      ...(userId === myUserId
        ? [
            {
              text: '退出链',
              style: 'destructive' as const,
              onPress: () =>
                void service
                  .leaveChain(userId)
                  .then(() => router.back())
                  .catch((err) => onError(err, '退出失败')),
            },
          ]
        : [
            {
              text: '移出链',
              style: 'destructive' as const,
              onPress: () => void service.removeMember(userId).catch((err) => onError(err, '移出失败')),
            },
          ]),
    ]);
  }

  function onTransfer(userId: string, nickname: string): void {
    void confirm({
      title: '转让链',
      body: `把主理人转让给 ${nickname}？转让后你变为编辑`,
      confirmLabel: '转让',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service.transferChain(userId).catch((err) => onError(err, '转让失败'));
    });
  }

  function onDeleteChain(): void {
    void confirm({
      title: '删除链',
      body: '删除后所有成员都无法访问这条链，确认？',
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service
        .deleteChain()
        .then(() => router.replace('/chains'))
        .catch((err) => onError(err, '删除失败'));
    });
  }

  /** url 是完整地址：分享链接走 `${webUrl}/share/${token}`（浏览器打开），邀请走 `moment://invites/${token}`。 */
  async function onShare(url: string): Promise<void> {
    try {
      await Share.share({ message: url });
    } catch {
      // 用户取消分享面板：静默
    }
  }

  const section = resolveSection(Array.isArray(sectionParam) ? sectionParam[0] : sectionParam, service.myRole);

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <OverlayNav title={chainSheetTitle(section)} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.body}>

      {section === 'profile' ? (
      <>
      <Text style={styles.sectionTitle}>资料{isOwner ? '' : '（仅主理人可修改）'}</Text>
      {isOwner ? (
        <>
          <TextInput style={styles.input} value={service.formName} onChangeText={(v) => (service.formName = v)} placeholder="链名（1–100 字）" placeholderTextColor={t.muted} />
          <TextInput style={styles.input} value={service.formDescription} onChangeText={(v) => (service.formDescription = v)} placeholder="描述（可选）" placeholderTextColor={t.muted} multiline />
          <View style={styles.chipRow}>
            {CHAIN_COLORS.map((c) => (
              // 选色同时清 Emoji（三模式互斥）；选 Emoji 保留颜色由服务端归一化
              <Pressable key={c} style={[styles.chip, service.formColor === c && service.formIcon === null && styles.chipActive]} onPress={() => service.selectFormColor(c)}>
                <Text style={[styles.chipText, service.formColor === c && service.formIcon === null && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRow}>
            {CHAIN_ICONS.map((i) => (
              <Pressable key={i} style={[styles.chip, service.formIcon === i && styles.chipActive]} onPress={() => service.selectFormIcon(i)}>
                <Text style={styles.chipText}>{i}</Text>
              </Pressable>
            ))}
          </View>
          <Button loading={service.$model.saveProfile.loading} loadingText="保存中…" onPress={() => void service.saveProfile().catch((err) => onError(err, '保存失败'))}>
            保存资料
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.row}>{service.chain.name}</Text>
          {service.chain.description ? <Text style={styles.muted}>{service.chain.description}</Text> : null}
          {myUserId ? (
            <Pressable
              style={styles.textBtn}
              hitSlop={textBtnHitSlop}
              onPress={() =>
                void confirm({
                  title: '退出这条链',
                  body: '退出后将无法继续查看或记录，除非再次被邀请。',
                  confirmLabel: '退出',
                  danger: true,
                }).then((ok) => {
                  if (!ok) return;
                  void service
                    .leaveChain(myUserId)
                    .then(() => router.back())
                    .catch((err) => onError(err, '退出失败'));
                })
              }
            >
              <Text style={styles.danger}>退出这条链</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {isOwner ? (
        <>
          <Text style={styles.sectionTitle}>危险区</Text>
          <Button variant="danger" loading={service.$model.deleteChain.loading} onPress={onDeleteChain}>
            删除这条链
          </Button>
        </>
      ) : null}
      </>
      ) : null}

      {section === 'members' ? (
      <>
      <Text style={styles.sectionTitle}>成员（{service.members.length}）</Text>
      {service.members.map((m) => (
        <Pressable key={m.userId} style={styles.rowBox} onPress={() => onRolePress(m.userId, m.nickname, m.role)}>
          <Text style={styles.row}>{m.nickname}</Text>
          <View style={styles.rowSide}>
            {isOwner && m.role !== 'owner' ? (
              <Pressable style={styles.textBtn} hitSlop={textBtnHitSlop} onPress={() => onTransfer(m.userId, m.nickname)}>
                <Text style={styles.link}>转让</Text>
              </Pressable>
            ) : null}
            <Text style={styles.muted}>{ROLE_LABEL[m.role] ?? m.role}</Text>
          </View>
        </Pressable>
      ))}

      {canInvite ? (
        <>
          <Text style={styles.sectionTitle}>邀请家人</Text>
          <Text style={styles.muted}>填对方注册邮箱，对方会在通知里看到邀请；也可以只生成链接。</Text>
          <Field
            label="邮箱"
            value={service.inviteEmail}
            onChangeText={(v) => (service.inviteEmail = v)}
            placeholder="邮箱（可空，只生成链接）"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Button
            variant="secondary"
            loading={service.$model.createInvite.loading}
            onPress={() => {
              const emailed = service.inviteEmail.trim().length > 0;
              void service
                .createInvite()
                .then((token) => {
                  if (emailed) {
                    toast.show('已发出邀请。对方若已注册，会在通知里看到。');
                    return;
                  }
                  return onShare(`邀请你加入「${service.chain?.name ?? ''}」时光链：${webUrl}/invites/${token}`);
                })
                .catch((err) => onError(err, '生成邀请失败'));
            }}
          >
            {service.inviteEmail.trim() ? '发出邀请' : '生成邀请链接'}
          </Button>
        </>
      ) : null}

      {isOwner
        ? service.invites.map((i) => (
            <View key={i.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{i.email ?? '链接邀请'} · {ROLE_LABEL[i.role] ?? i.role} · {formatRelative(i.createdAt)}</Text>
                <Text style={styles.muted}>
                  {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
                </Text>
              </View>
              {i.acceptedAt ? null : (
                <Pressable style={styles.textBtn} hitSlop={textBtnHitSlop} onPress={() => void service.revokeInvite(i.id).catch((err) => onError(err, '吊销失败'))}>
                  <Text style={styles.danger}>吊销</Text>
                </Pressable>
              )}
            </View>
          ))
        : null}
      </>
      ) : null}

      {section === 'people' ? <PeopleSection /> : null}
      {section === 'tags' ? <TagsSection /> : null}

      {section === 'share' && isOwner ? (
      <>
          <Text style={styles.sectionTitle}>给长辈看这条链</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, service.shareExpire === 'never' && styles.chipActive]} onPress={() => (service.shareExpire = 'never')}>
              <Text style={[styles.chipText, service.shareExpire === 'never' && styles.chipTextActive]}>永不过期</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '7' && styles.chipActive]} onPress={() => (service.shareExpire = '7')}>
              <Text style={[styles.chipText, service.shareExpire === '7' && styles.chipTextActive]}>7 天</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '30' && styles.chipActive]} onPress={() => (service.shareExpire = '30')}>
              <Text style={[styles.chipText, service.shareExpire === '30' && styles.chipTextActive]}>30 天</Text>
            </Pressable>
          </View>
          <Button
            variant="secondary"
            loading={service.$model.createShareLink.loading}
            loadingText="创建中…"
            onPress={() => void service.createShareLink().catch((err) => onError(err, '创建失败'))}
          >
            创建分享链接
          </Button>
          {service.shareLinks.map((s) => (
            <View key={s.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{webUrl}/share/{s.token.slice(0, 8)}…</Text>
                <Text style={styles.muted}>
                  {s.revokedAt ? '已吊销' : s.expiresAt ? `至 ${formatRelative(s.expiresAt)}` : '永不过期'} · {formatRelative(s.createdAt)}
                </Text>
              </View>
              {s.revokedAt ? null : (
                <View style={styles.rowSide}>
                  <Pressable style={styles.textBtn} hitSlop={textBtnHitSlop} onPress={() => void onShare(`${webUrl}/share/${s.token}`)}>
                    <Text style={styles.link}>发送</Text>
                  </Pressable>
                  <Pressable style={styles.textBtn} hitSlop={textBtnHitSlop} onPress={() => void service.revokeShareLink(s.id).catch((err) => onError(err, '吊销失败'))}>
                    <Text style={styles.danger}>吊销</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
      </>
      ) : null}

      {section === 'jobs' && isOwner ? <JobsSection /> : null}
    </ScrollView>
    </View>
  );
});

const Bound = bindServices(Content, [ChainSettingsService]);

export function ChainSettingsPage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { padding: t.space4, gap: t.space3 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: t.space8, gap: t.space3 },
    centerBtn: { alignSelf: 'center' },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink, marginTop: t.space3 },
    input: { borderWidth: 1, borderColor: t.line, borderRadius: t.fieldRadius, paddingHorizontal: t.space3, paddingVertical: t.space2, backgroundColor: t.surface, color: t.ink },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: t.space3, paddingVertical: 6, borderRadius: 16, backgroundColor: t.hoverSoft },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg },
    rowBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3 },
    rowMain: { flex: 1 },
    rowSide: { flexDirection: 'row', alignItems: 'center', gap: t.space3 },
    row: { fontSize: t.fontBody, color: t.ink },
    textBtn: { alignSelf: 'flex-start', paddingVertical: t.space1 },
    link: { color: t.action, fontSize: t.fontSupport },
    danger: { color: t.danger, fontSize: t.fontSupport },
    muted: { color: t.muted, fontSize: t.fontCaption, marginTop: 2 },
  });
