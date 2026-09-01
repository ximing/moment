# Plan Review

**Status:** Addressed

**Plan:** `docs/superpowers/plans/2026-08-29-moment-edit-media.md`  
**Spec:** `docs/superpowers/specs/2026-08-29-moment-edit-media-design.md`  
**Conventions:** `docs/superpowers/plans/CONVENTIONS.md`

**T1+T2 consecutive landing:** Explicit. Global Constraints、Task 1 Step 6（「立刻执行 Task 2」「本 commit 不合入可部署的 server 镜像单独上线」）、执行顺序「T1 禁止单独上线」三处钉死。理由也写对了：T1 放行 uuid `mediaIds` 后旧 `update` 会 **200 且静默忽略**，不是仅测试红。

Header（Goal / Architecture / Tech Stack / Spec / Global Constraints）、每 Task Files / Interfaces / Steps（红灯 → 实现 → 绿灯 → commit）、无 TBD/TODO/「适当处理」。§0 十一条、§4.6 矩阵、§5 compress/sweeper、§8 错误码、§9 点名测试文件均有对应 Task，无范围膨胀。

---

**Issues:**

- [x] [Task 2, Step 2] `只改 mediaIds 不改正文 → 不因媒体变化多发 moment.extract` 会在正确实现后仍红 — `MomentService.update` 现网在 `ai_extract_hash` 未写时对任意成功 PATCH 再发一行 extract（`moment.service.ts` 注释「重复 PATCH 同内容在消费前会重复发射」；`tests/worker/moment-extract-emit.test.ts` 同内容不追加的用例会先 `set({ aiExtractHash: computeAiExtractHash(...) })`）。本用例 create voice 后 handler 未跑，`extractBefore === 1`，媒体 PATCH 后会变成 2。实现者会误以为要改 extract 发射条件（例如 `mediaIds !== undefined` 就跳过），从而让「正文+媒体」同一次 PATCH 漏发 extract。修复：PATCH 前把 `aiExtractHash` 写成当前 `computeAiExtractHash(content, transcript)`（voice 附图那条 content 为 `''`、transcript 仍 null），再断言 extract / transcribe 行数不变。
  **addressed:** 用例在 PATCH 前 `update(moments).set({ aiExtractHash: computeAiExtractHash('', null) })`（对齐 `moment-extract-emit.test.ts`），并注明不先写 hash 会假红、禁止改 extract 发射条件。测试文件 import `computeAiExtractHash`。

- [x] [Task 3, Step 2] chain-home 一条 `it` 里连续四次 `render(<ComposePanel />)` 且不 `unmount`/`cleanup` — `@testing-library/react` 16 每次 `render()` 往 `document.body` 追加一棵树；`ComposeBody` 又是 `bindServices(..., [ComposePanelService])`，多挂载 = 多份面板。从第二次起 `getByRole('button', { name: '加图片' })` 会 Multiple elements；video 段 `queryByRole(..., '加图片')` 会被前三次的按钮挡住，`toBeNull()` 恒失败。实现者 UI 做对了也会卡在这条假红。修复：拆成 4 个 `it`，或每次 `const { unmount } = render(...); ...; unmount();`。
  **addressed:** 拆成 4 个独立 `it` + `renderEdit` helper；注明 `setup.ts` 的 `afterEach(cleanup)` 卸树，禁止同一 `it` 连续 `render` 不 unmount。

---

**Recommendations (advisory, do not block approval):**

- [x] Task 3 Step 5：`addMediaFiles` 与文件框 `onChange` 仍走 `onPickImages` / `onPickVideo`（会进 `replaceConfirm`）。只改 `handlePaste` 的 `if (edit || busy)` 不够；编辑态必须只收 `image/*` 进 `addImages`，`video/*` 置 `error = '编辑时不能换成视频'`。`handleDrop` 现网本来就不短路 `edit`，漏改会让拖入视频进编辑草稿。
  **addressed:** Step 5 给出完整 `addMediaFiles` 编辑分支（只 `addImages`）；文件框 `onChange` 钉死 `addImages`；`handleDrop` 同样 `busy || edit?.type==='video'` 才忽略。

- [x] Task 3 Step 4 / Task 4 Step 3：web `submit` 在 `if (edit)` **之前**用 `this.images`（不含 `keptMedia`）判「先写一句此刻吧」；app `submitEdit` 现网 `edit.type === 'text' && content.trim() === ''` 无条件抛「文字类型需要内容」。文字补图空正文、图文清空配文都可能被这道旧闸误伤。实现时按 spec §6.3 把闸改成「结果 0 图才拦 text」。
  **addressed:** web Step 4 / app Step 3 明确旧闸位置与 `resultCount = keptMedia.length + images.length`；补测「原 media 空正文、只留已有图」与 app「text 加图（空正文）」。

- [x] Task 4 Step 1：`ComposeService` 是 `register` 单例，`beforeEach` 只 `vi.clearAllMocks()`。`loadForEdit` 若漏复位 `images`/`voice`，后序用例会串状态。建议 `beforeEach` 里对 service 字段做与 web 测试同款复位，或保证 `loadForEdit` 总是先清草稿。
  **addressed:** `beforeEach` 复位 `edit/images/video/poster/voice/content/kept*/mediaTouched`；Step 3 再钉 `loadForEdit` 必须先清草稿。

- [x] Task 2 Step 6：前面写「事务开头声明 `copiedTmp`」，后面才写必须在 transaction **回调外**声明。跟 `create()` 现网写法，以后者为准。
  **addressed:** Step 6.4 改为与 `create()` L61–63 同形：`copiedTmp` 在 `db.transaction` 回调外声明，回调内 push，提交后循环 `deleteFile`。
