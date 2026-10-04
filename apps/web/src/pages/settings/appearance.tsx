import { observer, useService } from "@rabjs/react";
import { AuthService } from "@/services/auth.service";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { SettingsFrame } from "./frame";

export const SettingsAppearanceContent = observer(
  function SettingsAppearanceContent() {
    const auth = useService(AuthService);
    if (!auth.user) return null;

    return (
      <SettingsFrame title="外观" lede="浅色、深色，或跟着系统走。">
        <ThemeToggle />
      </SettingsFrame>
    );
  },
);

export const SettingsAppearancePage = SettingsAppearanceContent;
