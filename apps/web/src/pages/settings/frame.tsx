import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { useService } from "@rabjs/react";
import { AuthService } from "@/services/auth.service";
import { Button } from "@/ui/button/index";
import { SETTINGS_PAGES } from "./sections";

const NAV_ITEM =
  "whitespace-nowrap rounded-menu-item px-3 py-1.5 text-left text-sm transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset min-[900px]:w-full";

/** 设置各页共用：标题、左侧分节、退出。分节样式对齐链设置的导航。 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  const navigate = useNavigate();

  return (
    <div>
      <h1 className="text-page-title font-semibold text-ink">设置</h1>
      <div className="mt-6 min-[900px]:flex min-[900px]:items-start min-[900px]:gap-8">
        <div className="min-[900px]:sticky min-[900px]:top-6 min-[900px]:w-40 min-[900px]:shrink-0">
          <nav
            aria-label="设置"
            className="flex flex-wrap gap-1 min-[900px]:flex-col"
          >
            {SETTINGS_PAGES.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end
                className={({ isActive }) =>
                  `${NAV_ITEM} ${
                    isActive
                      ? "bg-select font-semibold text-select-fg"
                      : "text-muted hover:bg-floating-hover hover:text-ink"
                  }`
                }
              >
                {item.title}
              </NavLink>
            ))}
          </nav>
          <div className="mt-8">
            <Button
              variant="quiet"
              onClick={() => void auth.logout().then(() => navigate("/login"))}
            >
              退出
            </Button>
          </div>
        </div>
        <div className="mt-8 min-w-0 flex-1 min-[900px]:mt-0">{children}</div>
      </div>
    </div>
  );
}

/** 设置子页：分节标题和说明在右栏，导航留在左栏。 */
export function SettingsFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <SettingsLayout>
      <h2 className="text-lg font-medium text-ink">{title}</h2>
      <p className="mt-2 text-sm text-muted">{lede}</p>
      <div className="mt-6">{children}</div>
    </SettingsLayout>
  );
}
