## Context

Z03testTool（Electron 主进程）通过隐藏窗口 `executeJavaScript` 驱动上位机页面（http://localhost:8080），流程以硬编码函数写在 `flow.js` 的 `flows` 注册表，工具函数由 `makeHelpers` 提供（click/setInput/wait/readFile/waitForFile）。面板左侧「自检」「唤醒」按钮已存在，对应流程体目前是 TODO 占位。已探明的上位机页面事实（js 文件行号见下）：

- 自检按钮 `pushButton_ZJ`（发 0001H）、取自检结果按钮 `pushButton_QZJJG`（发 0010H）（Command.js:362-384）
- 自检结果表 `tableWidget_ZJJG`，26 项来自 csv/ZJJG_Recv.csv，实际为 13 行 4 列：项 1-13 在 `row=index-1,col=1`，项 14-26 在 `row=index-14,col=3`；CSV 初始值为 `0`，设备回包后更新为“正常/异常/到位/未到位”（Command.js:2459-2568）
- 唤醒按钮 `pushButton_Wake`（发 2000H）
- F000H 发送帧「地面预置测试状态」复选框 `comboBox_YZCSZL`；更新A帧按钮 `pushButton_SJCJ_F000H_update`（Command.js:658-663，触发 `requestSJCJF000HUpdate()`）
- 保存A/B帧生成 `data/数据采集AB帧_<时间戳>.xlsx`；「B帧」工作表包含ISO时间戳、`光轴指向俯仰角`和`光轴指向方位角`，可用于离线重建唤醒轨迹

## Goals / Non-Goals

**Goals:**
- 在 `flows` 中实现「自检」「唤醒」两个流程，带逐项判定、计时与结论日志
- `makeHelpers` 最小扩展：复选框支持、读表格单元格文本

**Non-Goals:**
- 不改上位机工具代码；不做唤醒方式（红外/激光/数据链）下拉的设置（假定操作员预先选好）
- 不做唤醒2000H应答状态的DOM判定（页面只写状态栏消息，没有稳定独立状态字段）；不生成额外测试报告文件
- 不把判定清单配置化（维持项目硬编码约定）

## Decisions

1. **判定清单硬编码为 flow.js 内的数组**：`{row, col, name, expect}`（expect: "正常" | "到位"），14 项：第 1、2、3、5、6、7、8、9、10、13 项（col 1，row=项-1）+ 第 15、16、17、20 项（col 3，row=项-14）。第 3 项（红外制冷状态自检）expect="到位"，其余 expect="正常"。读取时只接受“正常/异常/到位/未到位”，初始占位值 `0` 继续等待。备选的"从 csv 读取清单"被否：多一层依赖且违背硬编码约定。
2. **新增 `readCell(tableId, row, col)` helper**：`executeJavaScript` 读目标表格单元格 `textContent` 并 trim 返回。备选的"直读页面 JS 内部变量"被否：耦合上位机内部状态，DOM 文本是稳定契约。
3. **`setInput` 兼容复选框**：元素 `type === 'checkbox'` 时设置 `checked` 而非 `value`，同样派发 `input`+`change` 事件。不新增独立 helper，保持函数数量最小。
4. **唤醒计时与轨迹**：先停止遗留采集/保存，勾选预置并重新启动A帧与A/B帧保存，预录100ms；点击唤醒前记录 `wakeTime=Date.now()`，继续保存2秒后在 finally 中稳定停止保存与A帧。读取本次xlsx的B帧；逐通道记录是否出现 `<-1` 或 `>1`，其后首个进入 `[-0.3,0.3]` 且时间不晚于 `wakeTime+2000ms` 的帧为终点，任一通道满足即可。
5. **日志输出**：开始/每步动作照旧；结束时输出判定项逐项状态（或两角度值）、总用时、"测试成功/失败"。
6. **日志策略**：自检轮询（300ms）仅在新读取到判定项或发现不合格项时输出进度；唤醒输出保存文件、有效帧数、末帧角度、完成回归的通道与B帧终点时间。均走既有 `h.log` 通道。

## Risks / Trade-offs

- [取结果按钮早于设备回包，读到空单元格] → 轮询至时限而非一次读取；空单元格按"未合格"继续等
- [F000H 数据流未更新或初始已在零位] → 必须在本次B帧内观察到至少一个通道绝对值大于1°后再回到±0.3°，否则失败，避免旧值误判
- [角度字符串非数值] → `parseFloat` NaN 视为未到位，继续轮询至超时
- [设备未上电时自检项大量为空] → 9s 超时判失败，日志列明未取到的项
- [0010H 取结果早于设备自检完成，读到中间态误判异常] → 自检与取结果间预留 2s 可调预等待（flow.js 内经验值），联机验证（任务 4.1）时校准

## Migration Plan

纯增量：填充两个流程体 + 两个 helper 扩展，无部署/回滚问题。

## Open Questions

（无——判定清单与超时语义已与用户确认）
