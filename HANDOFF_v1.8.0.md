# v1.8.0 FFmpeg WASM 集成 — 交接文档

## 当前状态

### 已完成
1. **`@ffmpeg/ffmpeg` + `@ffmpeg/util` 已安装** — `package.json` 已更新
2. **`src/services/FrameExtractorService.ts` 已创建** — FFmpeg WASM 拆帧服务，包含：
   - `ensureLoaded()` — 加载 WASM 引擎（~25MB，从 CDN）
   - `extractFrames(videoFile, fps, onProgress)` — 视频拆帧为独立 JPEG
   - `probeVideo()` — 解析视频信息（duration, fps, resolution）
3. **v1.7.2 所有功能稳定** — 批量检测 174/174、播放流畅、timeline 同步

### 未完成（核心集成步骤）
**`src/views/EditorView/EditorContainer/EditorContainer.tsx`** 的 `onDrop` 处理器需要修改：
- 当前：检测到 video 文件 → 创建 `QueueItemType.VIDEO` → 进入视频模式
- 目标：检测到 video 文件 → **调用 FrameExtractorService.extractFrames()** → 将每帧 JPEG 作为独立图片加载 → 走图片模式

具体修改位置：`EditorContainer.tsx` 约第 252-288 行，`onDrop` 中检测到 `video/` MIME 类型的分支。

## 当前 Bug

### 1. DataCloneError: out of memory（紧急）
自动保存持续崩溃：
```
DataCloneError: Failed to execute 'put' on 'IDBObjectStore': Data cannot be cloned, out of memory.
```
**原因**：174 帧的 ImageData 每个都引用同一个完整视频 File 对象（~几十 MB）。IndexedDB 尝试克隆 174 份视频数据 → 内存爆炸。
**文件**：`src/utils/IndexedDBManager.ts:56`, `src/services/AutoSaveService.ts:97`
**修复方向**：视频模式下，自动保存只保存一份视频文件引用 + 标注数据，不复制 174 份。或者在 FFmpeg 拆帧后，每帧是独立小 JPEG（~50KB），总共 ~9MB，IndexedDB 轻松装下。

### 2. 推理结果面板缩略图对不上（视频模式特有）
视频帧的缩略图从 `<video>` 元素当前显示帧截取，但检测框坐标是其他帧的。
**在 FFmpeg 拆帧模式下此问题自动消失**（每帧是独立图片，直接裁剪 bbox 即可）。

## 集成方案（下个 session 执行）

### 修改 EditorContainer.tsx onDrop

```typescript
// 在 onDrop 中，检测到 video 文件时：
if (videoFiles.length > 0) {
    const videoFile = videoFiles[0];

    // 显示拆帧进度
    // ...

    // 用 FFmpeg WASM 拆帧
    const result = await FrameExtractorService.extractFrames(videoFile, 30, (phase, current, total) => {
        // 更新进度通知
    });

    // 将每帧 JPEG 当普通图片处理
    const imageFiles = result.frames; // File[] of JPEGs

    // 复用现有的图片加载流程
    // addImageDataAction(...)
    // 不进入视频模式！
}
```

### 关键设计决策
- **不进入视频模式** — 拆帧后全走图片模式，VideoEditor 不挂载
- **保留原始视频引用** — 用于播放预览（可选）
- **每帧是独立 File** — 类型 `image/jpeg`，可直接被 ImagePreview 加载
- **批量检测直接复用图片模式** — 不需要 seekVideoToTimeForCapture

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `package.json` | ✅ 已改 | @ffmpeg/ffmpeg, @ffmpeg/util 已安装 |
| `src/services/FrameExtractorService.ts` | ✅ 已创建 | FFmpeg WASM 拆帧服务 |
| `src/views/EditorView/EditorContainer/EditorContainer.tsx` | ❌ 待改 | onDrop 集成 FFmpeg |
| `src/utils/IndexedDBManager.ts` | ❌ 待改 | 修 DataCloneError |
| `src/services/AutoSaveService.ts` | ❌ 待改 | 视频数据保存策略 |

## Git 状态

```
当前分支: v1-main
最新 tag: v1.7.2
FrameExtractorService.ts: 已 commit（在 v1.8.0 commit 中）
```
