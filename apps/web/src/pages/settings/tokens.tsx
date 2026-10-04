import { useEffect, type FormEvent } from "react";
import { bindServices, observer, useService } from "@rabjs/react";
import { ACCESS_TOKEN_MAX_PER_USER, ACCESS_TOKEN_NAME_MAX } from "@moment/dto";
import { humanError } from "@/lib/errors";
import { AuthService } from "@/services/auth.service";
import { Button } from "@/ui/button/index";
import { Banner } from "@/ui/feedback/index";
import { TextField } from "@/ui/field/index";
import { AlertDialog, Dialog } from "@/ui/modal/index";
import { MeService } from "@/pages/me/me.service";
import { SettingsFrame } from "./frame";

function formatTokenDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export const SettingsTokensContent = observer(function SettingsTokensContent() {
  const service = useService(MeService);
  const auth = useService(AuthService);

  useEffect(() => {
    void service.loadTokens().catch(() => undefined);
  }, [service]);

  if (!auth.user) return null;
  const tokenError =
    service.$model.loadTokens.error ??
    service.$model.createToken.error ??
    service.$model.revokeToken.error;
  const atCap = service.tokens.length >= ACCESS_TOKEN_MAX_PER_USER;

  return (
    <SettingsFrame
      title="接口令牌"
      lede="给脚本和外部 Agent 用。生成后完整令牌只出现一次，请求头带 Authorization: Bearer。改密码会让已有令牌失效。"
    >
      <form
        className="flex flex-col gap-field-stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (atCap) return;
          void service.createToken().catch(() => undefined);
        }}
      >
        <TextField
          label="名称"
          name="tokenName"
          value={service.tokenName}
          maxLength={ACCESS_TOKEN_NAME_MAX}
          placeholder="例如：本地脚本"
          onChange={(value) => {
            service.tokenName = value;
          }}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            loading={service.$model.createToken.loading}
            disabled={atCap || !service.tokenName.trim()}
          >
            生成令牌
          </Button>
          <p className="text-sm text-muted">最多 {ACCESS_TOKEN_MAX_PER_USER} 个。</p>
        </div>
      </form>
      {tokenError && (
        <div className="mt-4">
          <Banner tone="error">{humanError(tokenError)}</Banner>
        </div>
      )}
      {service.tokens.length === 0 ? (
        <p className="mt-6 text-sm text-muted">还没有令牌。</p>
      ) : (
        <ul className="mt-6 space-y-1">
          {service.tokens.map((token) => (
            <li
              key={token.id}
              className="flex min-w-0 items-center gap-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{token.name}</p>
                <p className="truncate text-meta text-muted">
                  {token.preview} · {formatTokenDate(token.createdAt)}
                </p>
              </div>
              <Button
                variant="quiet"
                onClick={() => service.askRevoke(token)}
                aria-label={`吊销 ${token.name}`}
              >
                吊销
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={service.issued !== null}
        title="令牌已生成"
        onRequestClose={() => service.dismissIssued()}
        footer={
          <>
            <Button
              variant="quiet"
              onClick={() => void service.copyIssued().catch(() => undefined)}
            >
              复制
            </Button>
            <Button onClick={() => service.dismissIssued()}>完成</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          请马上复制。关闭后只能看到缩略，不能再查看完整令牌。
        </p>
        <div className="mt-4">
          <TextField
            label="令牌"
            name="issuedToken"
            readOnly
            value={service.issued?.token ?? ""}
          />
        </div>
        {service.copied && <p className="mt-4 text-sm text-muted">已复制。</p>}
        {service.copyError && (
          <div className="mt-4">
            <Banner tone="error">{service.copyError}</Banner>
          </div>
        )}
      </Dialog>
      <AlertDialog
        open={service.pendingRevoke !== null}
        title="吊销这枚令牌"
        body="使用它的脚本会立刻无法访问。"
        confirmLabel="吊销"
        cancelLabel="取消"
        danger
        busy={service.$model.revokeToken.loading}
        onCancel={() => service.cancelRevoke()}
        onConfirm={() => void service.revokeToken().catch(() => undefined)}
      />
    </SettingsFrame>
  );
});

export const SettingsTokensPage = bindServices(SettingsTokensContent, [
  MeService,
]);
