import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { ErrorText } from '../../components/ErrorText';
import { humanError } from '../../lib/errors';
import { JOBS_POLL_MS, jobStatusLabel, jobTypeLabel } from '../../lib/job-labels';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainSettingsService } from './chain-settings.service';

/** 链设置「处理中」（spec §7.4）：仅 owner 挂载；focus 时 load + 10s 轮询。v1 无重试。 */
export const JobsSection = observer(function JobsSection() {
  const service = useService(ChainSettingsService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useFocusEffect(
    useCallback(() => {
      void service.loadJobs().catch(() => undefined);
      const id = setInterval(() => {
        void service.loadJobs().catch(() => undefined);
      }, JOBS_POLL_MS);
      return () => clearInterval(id);
    }, [service, service.chainId]),
  );

  const error = service.$model.loadJobs.error;

  return (
    <View style={styles.block}>
      <Text style={styles.sectionTitle}>处理中</Text>
      <Text style={styles.hint}>压缩图和检索索引的后台任务，只有创建者看得到。</Text>
      {error ? <ErrorText message={humanError(error)} /> : null}
      {service.jobs.length === 0 ? (
        <Text style={styles.empty}>没有处理中的任务</Text>
      ) : (
        service.jobs.map((job) => (
          <View key={job.id} style={styles.row} accessibilityLabel={`${jobTypeLabel(job.type)} ${jobStatusLabel(job.status)}`}>
            <Text style={styles.type}>{jobTypeLabel(job.type)}</Text>
            <Text style={styles.muted}>{job.momentId.slice(0, 8)}</Text>
            <Text style={styles.status}>{jobStatusLabel(job.status)}</Text>
            <Text style={styles.muted}>{job.attempts} 次</Text>
            {job.lastError ? <Text style={styles.err}>{job.lastError}</Text> : null}
            <Text style={styles.time}>{new Date(job.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    block: { gap: t.space2, marginTop: t.space3 },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink },
    hint: { fontSize: t.fontCaption, color: t.muted },
    empty: { fontSize: t.fontSupport, color: t.muted, paddingVertical: t.space2 },
    row: {
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
      gap: t.space1,
    },
    type: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    status: { fontSize: t.fontSupport, color: t.ink },
    muted: { fontSize: t.fontCaption, color: t.muted },
    err: { fontSize: t.fontCaption, color: t.danger },
    time: { fontSize: t.fontCaption, color: t.muted },
  });
