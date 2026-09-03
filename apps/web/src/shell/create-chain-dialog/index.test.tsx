import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { RSRoot, register } from "@rabjs/react";
import type { TemplateDto } from "@moment/dto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateChainDialog } from "./index";
import { CreateChainDialogService } from "./create-chain-dialog.service";

// 模板选择器 icon 渲染契约（svg-icon-system P2-3 / spec §4.1）：
// - 官方模板 icon 是 tpl-* 词表 key：经 AppIcon 渲染为 svg（role=img + 注册表 label），
//   不再是 emoji 文本节点；
// - 自由 emoji icon（用户自建模板）落 AppIcon 兜底分支：原文本渲染，视觉不变。
// mock 里的模板名刻意与注册表 label 不同，role=img 的 name 只可能来自 icon label。
//
// 最小桩与 shell-navigation.test.tsx 同一约定：@/api/client 全模块桩（未列方法永不
// settle）。测试环境 RAB observer 不触发重渲（见 shell-navigation 注释），且
// bindServices 每次挂载新建子容器（resolve() 拿不到组件实例）——模板数据经
// loadTemplates → mock client 进组件自身实例，flush 后手动 rerender 让渲染读到。

const api = vi.hoisted(() => ({ listTemplates: vi.fn() }));

vi.mock("@/api/client", () => ({
  client: new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        (api as Record<string, unknown>)[prop] ??
        (() => new Promise(() => undefined)),
    },
  ),
}));

register(CreateChainDialogService);

function tpl(partial: Partial<TemplateDto> & { key: string }): TemplateDto {
  return {
    id: `tpl-${partial.key}`,
    scope: "official",
    ownerId: null,
    name: partial.key,
    description: null,
    icon: "tpl-daily",
    manifest: { version: 1 },
    version: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const TEMPLATES: TemplateDto[] = [
  tpl({ key: "baby", name: "宝宝日记", icon: "tpl-baby" }),
  tpl({ key: "travel", name: "亲子出行", icon: "tpl-travel" }),
  tpl({ key: "daily", name: "点滴记录", icon: "tpl-daily" }),
  tpl({
    key: "u_abc",
    scope: "user",
    ownerId: "user-1",
    name: "我们的小家",
    icon: "👨‍👩‍👧",
  }),
];

function tree() {
  // onClose 每次新闭包：rerender 时击穿 observer 的 memo，强制重读 service
  return (
    <MemoryRouter>
      <RSRoot>
        <CreateChainDialog onClose={() => undefined} />
      </RSRoot>
    </MemoryRouter>
  );
}

/** 渲染对话框并等 loadTemplates 落地后手动 rerender（observer 不重渲的既有测试约定）。 */
async function renderDialogWithTemplates() {
  const view = render(tree());
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenCalledWith("official"),
  );
  await act(async () => undefined); // flush loadTemplates 的 await 续体
  view.rerender(tree());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listTemplates.mockResolvedValue(TEMPLATES);
});

describe("模板选择器 icon（AppIcon）", () => {
  it("官方模板 icon 渲染 svg：role=img + 注册表 label，不再是 emoji 文本", async () => {
    await renderDialogWithTemplates();

    expect(
      await screen.findByRole("img", { name: "宝宝成长" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "旅行" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "日常生活" })).toBeInTheDocument();
  });

  it("自由 emoji icon（用户自建模板）落兜底分支：按原文本渲染", async () => {
    await renderDialogWithTemplates();

    await screen.findByRole("button", { name: /我们的小家/ });
    expect(screen.getByText("👨‍👩‍👧")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "我们的小家" })).toBeNull();
  });
});
