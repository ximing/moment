import { useNavigate } from "react-router";
import { bindServices, observer, useService } from "@rabjs/react";
import { humanError } from "@/lib/errors";
import { AuthService } from "@/services/auth.service";
import { Button } from "@/ui/button/index";
import { Banner } from "@/ui/feedback/index";
import { PasswordField } from "@/ui/field/index";
import { Dialog } from "@/ui/modal/index";
import { MeService } from "@/pages/me/me.service";
import { SettingsFrame } from "./frame";

export const SettingsPasswordContent = observer(
  function SettingsPasswordContent() {
    const service = useService(MeService);
    const auth = useService(AuthService);
    const navigate = useNavigate();
    if (!auth.user) return null;
    const error = service.$model.changePassword.error;
    const ready =
      service.oldPassword.length > 0 &&
      service.newPassword.length > 0 &&
      service.confirmPassword.length > 0;

    function finish(): void {
      void auth.logout().then(() => navigate("/login"));
    }

    return (
      <SettingsFrame
        title="修改密码"
        lede="改完后所有设备都要重新登录，已有的接口令牌也会失效。"
      >
        <form
          className="flex flex-col gap-field-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void service.changePassword().catch(() => undefined);
          }}
        >
          <PasswordField
            label="旧密码"
            name="oldPassword"
            autoComplete="current-password"
            value={service.oldPassword}
            onChange={(value) => {
              service.oldPassword = value;
            }}
          />
          <PasswordField
            label="新密码"
            name="newPassword"
            autoComplete="new-password"
            value={service.newPassword}
            onChange={(value) => {
              service.newPassword = value;
            }}
          />
          <PasswordField
            label="再输一遍新密码"
            name="confirmPassword"
            autoComplete="new-password"
            value={service.confirmPassword}
            onChange={(value) => {
              service.confirmPassword = value;
            }}
          />
          {error && <Banner tone="error">{humanError(error)}</Banner>}
          <div>
            <Button
              type="submit"
              loading={service.$model.changePassword.loading}
              disabled={!ready}
            >
              确认修改
            </Button>
          </div>
        </form>
        <Dialog
          open={service.passwordDone}
          title="密码已修改"
          onRequestClose={finish}
          footer={<Button onClick={finish}>好</Button>}
        >
          <p className="text-sm text-muted">
            所有设备都要重新登录。已有的接口令牌也失效了。
          </p>
        </Dialog>
      </SettingsFrame>
    );
  },
);

export const SettingsPasswordPage = bindServices(SettingsPasswordContent, [
  MeService,
]);
