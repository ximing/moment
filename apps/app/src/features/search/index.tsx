import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { INTENT_MAX_QUERY_CHARS, type MomentResponse } from '@moment/dto';
import { Field } from '../../components/Field';
import { FilterChips } from '../../components/FilterChips';
import { OverlayNav } from '../../components/OverlayNav';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { Banner, EmptyState } from '../../components/feedback';
import { humanError } from '../../lib/errors';
import { formatSearchParsed } from '../../lib/search-summary';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { SearchService } from './search.service';

function asParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const Content = observer(function Content() {
  const params = useLocalSearchParams<{ chainId?: string }>();
  const service = useService(SearchService);
  const auth = useService(AuthService);
  const myId = auth.user?.id;
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    service.hydrate(asParam(params.chainId));
    setDraft(service.q);
  }, [service, params.chainId]);

  function onSubmit(): void {
    const trimmed = draft.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    void service.submit(trimmed);
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <OverlayNav title={service.scopeName} />
      <View style={styles.searchWrap}>
        <Field
          accessibilityLabel="搜索时刻"
          value={draft}
          onChangeText={(next) => {
            setDraft(next);
            if (next === '') service.clearQuery();
          }}
          placeholder={service.chainId ? '搜索这条链的时刻' : '搜索全部时刻'}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoFocus
          enablesReturnKeyAutomatically
        />
      </View>
      {service.searchError ? (
        <View style={styles.banner}>
          <Banner tone="error">{humanError(service.searchError)}</Banner>
        </View>
      ) : null}
      {service.hasSubmitted && service.searchParsed && !service.searchError ? (
        <Text style={styles.summary}>{formatSearchParsed(service.searchParsed)}</Text>
      ) : null}
      <FilterChips
        personId={service.personId}
        personName={service.personName}
        place={service.place}
        onClearPerson={() => service.clearPersonFilter()}
        onClearPlace={() => service.clearPlaceFilter()}
      />
      <FlashList
        data={service.moments}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.4}
        onEndReached={() => void service.loadMore().catch(() => undefined)}
        renderItem={({ item }: { item: MomentResponse }) => (
          <MomentCard
            moment={item}
            onPress={() => router.push(`/moments/${item.id}`)}
            onLongPress={
              myId === item.author.id
                ? () =>
                    showMomentActions(item, () =>
                      router.push({ pathname: '/compose', params: { momentId: item.id } }),
                    )
                : undefined
            }
            onPersonFilter={(p) => service.togglePersonFilter(p)}
            onPlaceFilter={(place) => service.togglePlaceFilter(place)}
          />
        )}
        ListEmptyComponent={
          service.$model.submit.loading ? (
            <Loading />
          ) : service.hasSubmitted ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="没有找到相关时刻"
              description="换个说法再试试。"
            />
          ) : (
            <EmptyState
              variant="timeline"
              scope="section"
              title={service.chainId ? '搜这条链里的时刻' : '搜一搜家里的时刻'}
              description="人名、地点，或一句话。"
            />
          )
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
    </View>
  );
});

export const SearchPage = bindServices(Content, [SearchService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    searchWrap: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space2 },
    banner: { paddingHorizontal: t.space3, paddingVertical: t.space2 },
    summary: {
      paddingHorizontal: t.space3,
      paddingBottom: t.space2,
      fontSize: t.fontSupport,
      color: t.muted,
    },
    list: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space8 },
    loadingMore: { textAlign: 'center', color: t.muted, padding: t.space3 },
  });
