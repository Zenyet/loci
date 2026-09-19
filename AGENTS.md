# Loci 项目约束

## UI 控件

- 业务界面优先复用项目已有的自定义控件：`Select`、`GroupSelect`、`TextInput`、`Slider`、`SettingsControls`。需要扩展能力时先改进现有组件，不另写一套相同控件。
- 普通弹窗和内容面板的关闭按钮复用 `CloseButton`，统一叉号尺寸、底色与焦点样式，避免各处单独拼装。
- **下拉选择器必须使用项目的自定义组件，禁止原生 `<select>`、`<option>`、`<optgroup>`。** 普通选择使用 `src/components/Select.tsx`；需要文件夹颜色、层级等专用展示时使用 `GroupSelect` 或基于 `Select` 的封装。
- 该限制适用于整个项目，包括图谱、设置、工具栏弹窗、收件箱和后续新增页面。给原生下拉框加 CSS 或包一层 React 组件，仍不符合要求；也不要通过 `createElement` 或隐藏原生下拉框绕过。
- 自定义控件需要保持键盘操作、可访问名称、焦点恢复、禁用状态和浮层边界；Escape 应先关闭下拉菜单，再关闭其所在弹窗。
- 本约束不禁止自定义组件内部使用 `button`、`input` 等原生语义元素；文字输入应保留浏览器的输入法等基础能力。

## 验证

- 修改 UI 后运行 `npm run check:ui`；该检查已纳入 `npm run check`，会检查源码中的原生下拉标签和直接 `createElement` 调用。
- 控件替换还需验证实际选择行为、键盘操作及菜单在容器边缘的展示，不能只替换样式。
