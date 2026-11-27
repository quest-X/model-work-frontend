# OpenSight

## Development and Verification

```bash
npm start          # Development server
npm run build      # Production build
npm test           # Jest tests
npm run lint       # TypeScript checks
```

The main source tree is under `src/`: `views/` contains the UI, `services/` connects backend and extension APIs, `store/` owns Redux state, and `logic/` plus `workers/` provide business logic and background tasks.

## Current Boundaries

| Area | Boundary |
|------|----------|
| Models and runtime | This repository does not contain model weights, training data, or the Python inference environment |
| Browser project state | Becomes available to the Backend, Monitor, and Node only after export or upload |
| Extensions | Availability depends on Backend installation and runtime switches |

## License

This project is licensed under [GPL-3.0](LICENSE), following the upstream [make-sense](https://github.com/SkalskiP/make-sense) license.

整理日期：2026-10-23。仅调整文档表达与分卷；原有授权、事实日期和验收边界保持原范围。

同主题分卷：[概览与其他分卷](<README_EN.md>)；[上一卷：Repository Role](<README_EN(1).md>)。
