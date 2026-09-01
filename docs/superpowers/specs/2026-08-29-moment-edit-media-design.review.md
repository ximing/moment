# Review: 2026-08-29-moment-edit-media-design

## Verdict
P0 count 0 / P1 count 0 / nit count 0
总体：Approve

第二轮 4 条 open 均已写入 spec：`addImages` 内部按 `this.edit` 分支算 cap/occupied；compress ready 路径 0 行 best-effort `deleteFile(derivedKey)`，不再声称 sweeper 能收到未落列对象；§5.1 把 handler 例外从「零改语义」清单划清；`audio/*` 禁止进 `keptMedia`。对照锁定决策 1–12、矩阵、错误码、T1–T4 Files，未发现新的矛盾或不可实施缺口。

## Issues

无剩余 open issue。

## 覆盖检查
锁定决策 1–12 是否都在 spec 里写死（逐条 yes/no + 锚点）

1. PATCH 可选 `mediaIds` 全量替换（undefined=不变） — **yes**（§0.1、§3、§4.3）
2. 客户端不传 `type`；server 按结果集推导 — **yes**（§0.2、§4.5.10、§4.6）
3. type=media 结果 1–9 张 `image/*`，不能删光变 text — **yes**（§0.3、§4.6）
4. type=text 可提交 1–9 张图升级 media — **yes**（§0.4、§4.6、§6.3）
5. type=voice 改 0–8 附图、必须保留原 audio id — **yes**（§0.5、§4.6、§6.2 `addImages` 编辑分支 `editImageCap`）
6. type=video 带 `mediaIds` 或改 poster → `MEDIA_NOT_ALLOWED` — **yes**（§0.6、§4.2 含 `null`、§4.4 锁后、§8）
7. 不能 media/voice/video 互转（只允许 text→media） — **yes**（§0.7、§4.5.10、§4.6）
8. 权限不变；不改路由 — **yes**（§0.8、§0.10、§3）
9. web+app 编辑态可改图 — **yes**（§0.9、§6、§7）
10. 媒体 URL 为响应内预签名 GET，不写回「不得内嵌预签名」 — **yes**（文首、§0.11、§6.1 `cardDisplayUrl`）
11. 集合变化走既有 compress/embed，不新 outbox 类型 — **yes**（文首覆盖 fused-retrieval、§5.1；handler 仅 WHERE + 0 行 `deleteFile`）
12. 离开集合 orphan，请求线程不物理删对象 — **yes**（§4.5.7、§5.2–5.3）

fused-retrieval「PATCH 不能改 mediaIds / update 不发 compress」仍被本 spec 显式覆盖（文首、§2、§5.1）。

占位符：无 TBD / TODO / 「适当处理」/「类似 Task N」。

错误码全部是现网 UPPER_SNAKE；dto 数量失败走 `VALIDATION_ERROR` 包络，构成失败走 `HttpError`；不用 `MEDIA_ALREADY_BOUND`。混排宫格：不提交 `mediaIds` 则存量 `video/*` 保留；提交则结果必须全 `image/*`。矩阵的 `originalType` 取 FOR UPDATE 后的行。

## 计划可执行性
可直接按 §11 拆成 dto → server → web → app（T1+T2 连续合入）。接口够抄：

- `PatchMomentInput.mediaIds?: string[]`、`posterMediaId?: string | null`；`.strict()` 仍拒 `type`
- `MomentService.update(userId, momentId, PatchMomentInput)` 签名不变；`originalType = locked.type`
- `emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId, chainId, mediaId })`；`maybeEmitMomentEmbed`
- compress 终态 `WHERE id=? AND moment_id IS NOT NULL`；ready 路径 0 行 `deleteFile(derivedKey)`
- `destroyMediaObject` 保持内部函数；`deletedObjects` 每次成功 `deleteFile` +1
- web `addImages`：`cap = this.edit ? editImageCap(this.edit) : this.voice ? 8 : 9`；编辑占用 `editOccupied(keptMedia, next)`
- app `pickMoreImages` 编辑 `remain = editImageCap - editOccupied`；新建仍 `this.type === 'voice' ? 8 : 9`
- `MediaGrid.onRemove?: (mediaId: string) => void`
- 编辑 submit：先串行 `compressImage` + `uploadMedia({ kind:'image' })` 再 `updateMoment`；未动不传 `mediaIds`
