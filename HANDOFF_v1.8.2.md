# v1.8.2 FFmpeg 后端拆帧 + 视频模式 UI — 交接文档

## 当前状态（v1.8.1 已完成）

### 已完成
1. **后端原生 FFmpeg 拆帧服务** — `POST /extract-frames`
   - 接收视频文件 + fps 参数，原生 FFmpeg 拆帧，ZIP 打包返回
   - 10.8MB 1920x1440 视频 174 帧，**0.87 秒**完成
   - 文件：`backend/app/services/frame_extraction.py`, `backend/app/api/routes.py`

2. **前端 FrameExtractorService 调后端 API**
   - 上传视频 → 接收 ZIP → JSZip 解压 → File[] 独立 JPEG
   - 文件：`src/services/FrameExtractorService.ts`

3. **DataCloneError 已修复**
   - `AutoSaveService.ts`：视频模式下跳过 IndexedDB 保存 + 500MB 大小限制
   - FFmpeg 拆帧后每帧独立小 JPEG（~50KB），不再引用大视频文件

4. **FFmpeg WASM 已清理**
   - 删除了 `public/ffmpeg/worker.js`
   - 删除了 `vite.config.ts` 的 COOP/COEP 中间件插件
   - `@ffmpeg/ffmpeg` 和 `@ffmpeg/util` 仍在 package.json 中（可选清理）

### v1.8.1 的问题
当前拆帧后走**图片模式**（QueueItemType.FOLDER），没有视频控制栏、播放按钮、时间轴。
用户期望：FFmpeg 只替换"帧数据获取"层，UI 交互保持视频模式不变。

## v1.8.2 目标

**FFmpeg 后端拆帧 + 视频模式 UI**：
- 拖入视频 → 后端 FFmpeg 拆帧得到 JPEG 数组 → 进入视频模式
- VideoEditor、播放控制栏、时间轴、帧导航 — UI 完全不变
- 底层数据用预拆帧的 JPEG 数组驱动，不再依赖 `<video>` 元素实时 seek

### 核心改动思路

1. **修改 `EditorContainer.tsx` onDrop**：
   - 视频拆帧成功后，仍然创建 `QueueItemType.VIDEO` 队列项
   - 但额外存储拆好的帧数组（File[] 或 Blob[]）
   - 进入视频模式，VideoEditor 挂载

2. **修改 VideoEditor / VideoPlayer**：
   - 当有预拆帧数据时，不用 `<video>` 元素 seek，直接从帧数组取对应帧的 JPEG
   - 播放 = 定时器按 fps 切换帧索引
   - 时间轴 seek = 直接跳到对应帧索引
   - canvas 绘制帧图片而非 video 元素

3. **保持兼容**：
   - 没有预拆帧数据时（回退模式），仍用原来的 `<video>` seek 方式
   - 批量检测直接用预拆帧的 JPEG blob，不需要 seekVideoToTimeForCapture

### 关键文件

| 文件 | 说明 |
|------|------|
| `src/views/EditorView/EditorContainer/EditorContainer.tsx` | onDrop：拆帧后进视频模式 |
| `src/views/EditorView/VideoEditor/VideoEditor.tsx` | 适配预拆帧数据源 |
| `src/views/EditorView/VideoPlayer/VideoPlayer.tsx` | 用帧数组替代 `<video>` seek |
| `src/views/EditorView/VideoTimeline/VideoTimeline.tsx` | 时间轴交互保持不变 |
| `src/store/video/types.ts` | VideoData 类型可能需要扩展（加 preExtractedFrames 字段） |
| `src/logic/actions/AIDetectionActions.ts` | 批量检测用预拆帧数据 |
| `src/services/FrameExtractorService.ts` | 已完成，无需改动 |
| `backend/app/services/frame_extraction.py` | 已完成，无需改动 |

### 数据流

```
拖入视频
  → FrameExtractorService.extractFrames() [调后端 FFmpeg, 0.87s]
  → 得到 174 个 JPEG File + metadata
  → 创建 QueueItem (VIDEO) + 存储帧数组
  → QueueActions.switchToQueueItem → 进入视频模式
  → VideoEditor 挂载
    → VideoPlayer: 从帧数组取 JPEG → 绘制到 canvas
    → 播放: setInterval 切换帧索引
    → Seek: 直接跳帧索引
  → 批量检测: 直接用帧 JPEG blob，无需 seek
```

## Git 状态

```
当前分支: v1-main（待打 v1.8.1 tag）
后端改动: frame_extraction.py (新建), routes.py (修改)
前端改动: FrameExtractorService.ts (重写), EditorContainer.tsx (修改),
          AutoSaveService.ts (修改), vite.config.ts (清理)
```
