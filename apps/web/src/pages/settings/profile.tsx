import { useEffect, useRef } from "react";
import { bindServices, observer, useService } from "@rabjs/react";
import { humanError } from "@/lib/errors";
import { AuthService } from "@/services/auth.service";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/button/index";
import { Banner } from "@/ui/feedback/index";
import { TextField } from "@/ui/field/index";
import { MeService } from "@/pages/me/me.service";
import { SettingsFrame } from "./frame";

export const SettingsProfileContent = observer(
  function SettingsProfileContent() {
    const service = useService(MeService);
    const auth = useService(AuthService);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      service.hydrateNickname();
    }, [service]);

    if (!auth.user) return null;
    const user = auth.user;
    const shown = service.preview ?? user.avatarUrl;
    const error =
      service.$model.uploadAvatar.error ?? service.$model.clearAvatar.error;
    const nameError = service.$model.saveNickname.error;

    return (
      <SettingsFrame title="个人资料" lede="头像和名字。">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <button
            type="button"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
            onClick={() => fileRef.current?.click()}
            aria-label="换头像"
          >
            <Avatar
              name={user.nickname}
              color={user.avatarColor}
              icon={user.avatarIcon}
              src={shown}
              size={48}
            />
          </button>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              variant="secondary"
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
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            service.setPreview(URL.createObjectURL(file));
            void service.uploadAvatar(file).catch(() => undefined);
          }}
        />
        {error && (
          <div className="mt-4">
            <Banner tone="error">{humanError(error)}</Banner>
          </div>
        )}
        <form
          className="mt-6 flex flex-col gap-field-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void service.saveNickname().catch(() => undefined);
          }}
        >
          <TextField
            label="名字"
            name="nickname"
            value={service.nickname}
            maxLength={50}
            onChange={(value) => {
              service.nickname = value;
            }}
          />
          <TextField
            label="邮箱"
            name="email"
            type="email"
            value={user.email}
            readOnly
            description="用来登录，不能在这里改。"
          />
          {nameError && <Banner tone="error">{humanError(nameError)}</Banner>}
          <div>
            <Button
              type="submit"
              loading={service.$model.saveNickname.loading}
              disabled={
                !service.nickname.trim() ||
                service.nickname.trim() === user.nickname
              }
            >
              保存名字
            </Button>
          </div>
        </form>
      </SettingsFrame>
    );
  },
);

export const SettingsProfilePage = bindServices(SettingsProfileContent, [
  MeService,
]);
