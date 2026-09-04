import { AlertDialogHost } from './AlertDialogHost';
import { ToastHost } from './ToastHost';

/** 根布局挂载：Toast 在下、AlertDialog 经 RN Modal 盖在更上。 */
export function FeedbackHost() {
  return (
    <>
      <ToastHost />
      <AlertDialogHost />
    </>
  );
}
