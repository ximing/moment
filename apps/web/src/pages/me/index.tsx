import { useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { bindServices, observer, useService } from "@rabjs/react";
import { ACCESS_TOKEN_MAX_PER_USER, ACCESS_TOKEN_NAME_MAX } from "@moment/dto";
import { humanError } from "@/lib/errors";
import { AuthService } from "@/services/auth.service";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/button/index";
import { Banner } from "@/ui/feedback/index";
import { TextField } from "@/ui/field/index";
import { AlertDialog, Dialog } from "@/ui/modal/index";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MeService } from "./me.service";

function formatTokenDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

// 「我」页（plan Task 12）：安静的内容堆叠，不再用 elev 卡片分区；头像上传/清除、
// 主题三态与退出语义不变。具名导出是测试 seam（同 MomentPageContent 先例）。
export const MePageContent = observer(function MePageContent() {
  const service = useService(MeService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void service.loadTokens().catch(() => undefined);
  }, [service]);

  if (!auth.user) return null;
  const user = auth.user;
  const shown = service.preview ?? user.avatarUrl;
  const error =
    service.$model.uploadAvatar.error ?? service.$model.clearAvatar.error;
  const tokenError =
    service.$model.loadTokens.error ??
    service.$model.createToken.error ??
    service.$model.revokeToken.error;
  const atCap = service.tokens.length >= ACCESS_TOKEN_MAX_PER_USER;

  return (
    <div className="max-w-content">
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-full hover:opacity-90 focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
          onClick={() => fileRef.current?.click()}
          aria-label="换头像"
        >
          <Avatar
            name={user.nickname}
            color={user.avatarColor}
            icon={user.avatarIcon}
            src={shown}
            size={72}
          />
        </button>
        <div>
          <h1 className="text-page-title font-semibold text-ink">
            {user.nickname}
          </h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm text-muted">头像</h2>
        <p className="mt-2 text-sm text-muted">
          点头像或按钮上传一张图。和时刻里的照片一样，存在私有桶里，打开资料时签发
          6 天链接。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            service.setPreview(URL.createObjectURL(file));
            void service.uploadAvatar(file).catch(() => undefined);
          }}
        />
        {error && (
          <div className="mt-3">
            <Banner tone="error">{humanError(error)}</Banner>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            loading={service.$model.uploadAvatar.loading}
            onClick={() => fileRef.current?.click()}
          >
            上传头像
          </Button>
          {user.avatarUrl && (
            <Button
              variant="quiet"
              loading={service.$model.clearAvatar.loading}
              onClick={() => void service.clearAvatar().catch(() => undefined)}
            >
              去掉头像
            </Button>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm text-muted">主题</h2>
        <div className="mt-2">
          <ThemeToggle />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm text-muted">接口令牌</h2>
        <p className="mt-2 text-sm text-muted">
          给脚本和外部 Agent 用。生成后完整令牌只出现一次，请求头带
          Authorization: Bearer。改密码会让已有令牌失效。
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
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
              className="shrink-0"
              loading={service.$model.createToken.loading}
              disabled={atCap || !service.tokenName.trim()}
            >
              生成令牌
            </Button>
            <p className="text-sm text-muted">
              最多 {ACCESS_TOKEN_MAX_PER_USER} 个。
            </p>
          </div>
        </form>
        {tokenError && (
          <div className="mt-4">
            <Banner tone="error">{humanError(tokenError)}</Banner>
          </div>
        )}
        {service.tokens.length === 0 ? (
          <p className="mt-4 text-sm text-muted">还没有令牌。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {service.tokens.map((token) => (
              <li
                key={token.id}
                className="flex min-w-0 flex-wrap items-center gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{token.name}</p>
                  <p className="text-sm text-muted">
                    {token.preview} · {formatTokenDate(token.createdAt)}
                  </p>
                </div>
                <Button
                  variant="quiet"
                  className="shrink-0"
                  onClick={() => service.askRevoke(token)}
                  aria-label={`吊销 ${token.name}`}
                >
                  吊销
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      <div className="mt-8">
        <Button
          variant="quiet"
          onClick={() => void auth.logout().then(() => navigate("/login"))}
        >
          退出
        </Button>
      </div>
    </div>
  );
});

export const MePage = bindServices(MePageContent, [MeService]);
