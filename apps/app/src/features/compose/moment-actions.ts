import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { ApiError } from '@moment/api-client';
import { EventSystem } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { confirm, toast } from '../../components/feedback';
import { client } from '../../lib/api';
import type { MomentChangedPayload } from '../../lib/events';

/**
 * 卡片长按删除（spec §4.2）：一次性 API 调用 + 事件，不进任何全局 Service——无跨页状态。
 * 重试幂等（§5，与详情页 MomentPageService.deleteMoment 同款）：
 * 404 MOMENT_NOT_FOUND / 410 MOMENT_DELETED 按已删除处理（照常 emit，不报错）；
 * 其他错误抛给调用方走 humanError。
 */
export async function deleteMoment(moment: MomentResponse): Promise<void> {
  try {
    await client.deleteMoment(moment.id);
  } catch (err) {
    const gone =
      err instanceof ApiError && (err.code === 'MOMENT_NOT_FOUND' || err.code === 'MOMENT_DELETED');
    if (!gone) throw err;
  }
  // 与 Service.emit(..., 'global') 同一 emitter（EventSystem.getGlobalEvents）
  const payload: MomentChangedPayload = { momentId: moment.id, chainId: moment.chainId, op: 'delete' };
  EventSystem.getGlobalEvents().emit('moment:changed', payload);
}

function confirmDelete(moment: MomentResponse): void {
  void confirm({
    title: '删除这条时刻？',
    body: '删除后不可恢复',
    confirmLabel: '删除',
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    void deleteMoment(moment).catch((err) => toast.error(err, '删除失败'));
  });
}

/**
 * 长按菜单（spec §4.2）：iOS ActionSheetIOS / Android Alert 三按钮
 * 「编辑」「删除」（destructive，二次确认）「取消」。
 * 跳转留组件（onEdit 由列表侧注入 router.push），此处只管菜单与删除。
 */
export function showMomentActions(moment: MomentResponse, onEdit: () => void): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['取消', '编辑', '删除'],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (index) => {
        if (index === 1) onEdit();
        else if (index === 2) confirmDelete(moment);
      },
    );
    return;
  }
  Alert.alert('时刻操作', undefined, [
    { text: '编辑', onPress: onEdit },
    { text: '删除', style: 'destructive', onPress: () => confirmDelete(moment) },
    { text: '取消', style: 'cancel' },
  ]);
}
