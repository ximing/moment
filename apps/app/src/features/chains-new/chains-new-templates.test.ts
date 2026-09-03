import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OFFICIAL_TEMPLATES } from "@moment/dto";
import { resolveAppIcon } from "../../components/app-icon-resolve";

// 模板选择器 icon 契约（svg-icon-system P2-3）：chains-new 模板卡片把 tpl.icon
// 直接传给 <AppIcon value>。app 测试基建是纯 node vitest，组件树渲染断言不可行，
// 这里钉住解析层——官方模板 icon（tpl-* 词表 key）必须全部命中注册表（命中即渲染
// svg）；自由 emoji（用户自建模板 icon）落兜底 null（AppIcon 按原文本渲染，视觉不变）。
describe("chains-new 模板 icon → AppIcon 解析", () => {
  it("官方模板 icon 全部命中注册表（tpl-baby → 宝宝成长）", () => {
    for (const tpl of OFFICIAL_TEMPLATES) {
      assert.ok(
        resolveAppIcon(tpl.icon),
        `${tpl.key} 的 icon ${tpl.icon} 应命中注册表`,
      );
    }
    assert.deepEqual(resolveAppIcon("tpl-baby"), {
      key: "tpl-baby",
      label: "宝宝成长",
    });
  });

  it("自由 emoji（用户自建模板 icon）落兜底分支", () => {
    assert.equal(resolveAppIcon("👨‍👩‍👧"), null);
    assert.equal(resolveAppIcon("🎸"), null);
  });
});
