export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  /** 缺省「取消」；传 null 隐藏取消（单按钮告知）。 */
  cancelLabel?: string | null;
  danger?: boolean;
};

type ConfirmHostHandle = {
  open(req: ConfirmRequest): Promise<boolean>;
};

let host: ConfirmHostHandle | null = null;

export function bindConfirmHost(h: ConfirmHostHandle): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

/** 居中确认面板。无 Host 时（测试/未挂载）视为取消。 */
export function confirm(req: ConfirmRequest): Promise<boolean> {
  if (!host) return Promise.resolve(false);
  return host.open(req);
}
