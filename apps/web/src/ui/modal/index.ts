// 只公开 Dialog / Sheet / AlertDialog 与其 props、CloseReason 类型；
// ModalSurface 是目录私有实现细节，业务方永不 import（规范 §14）。
export { Dialog, Sheet, AlertDialog } from './Modal';
export type {
  DialogProps,
  SheetProps,
  AlertDialogProps,
  CloseReason,
} from './Modal';
