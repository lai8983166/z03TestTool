## Context

Z03testTool 通过隐藏窗口 `executeJavaScript` 驱动上位机页面，流程硬编码于 `flow.js` 的 `flows` 注册表，已有 helper：click / setInput（含复选框与 select）/ readCell / getText / wait。已探明的上位机服务事实：

- 转台（tab-18）经用户明确：内环=方位 `#tt_input_inner_pos`、外环=俯仰 `#tt_input_outer_pos`（number 输入）；`#tt_btn_set_pos` 发送位置，`#tt_btn_run` 启动。目标值必须按对应输入原样下发，不能交换。
- 到位判定：页面自身逻辑为轮询 `$MNSTS` 两轴速度归零（TurntableControl.js:766-794，模块私有）；外部可观察：周期点 `#tt_btn_status` 状态查询后读 `#tt_td_inner_vel`/`#tt_td_outer_vel`（速度）与 `#tt_td_inner_pos`/`#tt_td_outer_pos`（反馈位置，4 位小数，页面在 ≥140° 时有 −360° 环绕显示处理）；串口状态 `#tt_serial_status` 含「已连接」；`#tt_btn_stop` 停止
- F000H 发送帧表格 `#tableWidget_SJCJ_F000H_Send`：第 25 行 = 预置俯仰角、第 26 行 = 预置方位角（cells[1]，contentEditable td，度为单位 toFixed(1)，构建时 ×0.0174533）；`#pushButton_SJCJ_F000H_update` 更新A帧 = 从 UI 重建帧并重启发送循环（快照式，改动后必须点它才生效）
- 「允许截获」= `comboBox_HWJHKZ`；「地面预置测试状态」= `comboBox_YZCSZL`；保存B帧 = `pushButton_SJCJ_0010H`（切换式）；采集 = `pushButton_SJCJ_F000H_Send`（切换式）

## Goals / Non-Goals

**Goals:**
- 两个转台扫描流程：公共 8 点位扫描循环 + 各自的录帧前奏与收尾
- 到位判定：速度归零 + 位置容差双条件；逐点日志；中止时停转台/停采集/停保存

**Non-Goals:**
- 不自动连接转台串口/远控/使能/设位置模式（人工前置）
- 不分析本次录制的 B 帧数据（录帧产物供离线分析，指标判定不在本 change）
- 不做转台速度/路径优化

## Decisions

1. **公共扫描循环 `scanPositions(h, opts)`**：8 点硬编码 `POSITIONS = [[0,-45],[-15,-40],[22,-30],[-23,-20],[21,-10],[-18,0],[10,10],[0,15]]`，语义为 `[内环方位偏移, 外环俯仰偏移]`。循环前状态查询一次得到初始内/外环位置，并与上位机服务标定扫描保持一致：每轴初始值 `>=140` 时减 `360`；每个目标都以同一个初始位置加当前序列偏移计算，再分别写入内/外环输入。`onArrived` 同时收到绝对目标和原始序列值；光轴预置流程只使用原始序列值，A帧第25行（预置俯仰）写外环偏移，第26行（预置方位）写内环偏移。
2. **到位 `waitTurntableArrive(h, innerTarget, outerTarget, timeoutMs=60000)`**：循环「click `tt_btn_status` → wait 200ms → getText 读两轴速度与位置」；速度 `Math.abs(parseFloat) < 0.0001` 且角差 `Math.abs(((pos-target)%360+540)%360-180) <= 0.5` 判到位；超时抛错（含反馈值）。容差 0.5°、超时 60s 为常量可调。
3. **`setCellText(tableId, row, col, value)` 新 helper**：`tb.rows[r].cells[c].textContent = value`（contentEditable td，无需派发事件，页面 adjust 按钮同样只写 textContent）。预置流程每点：设 25/26 行两格 → click 更新A帧。
4. **收尾与清理**：光轴预置流程先把第25/26行预置俯仰/方位角均写为 `0.0`；随后取消勾选（setInput false）→ click 更新A帧（发归零与清除帧）→ 先停保存，再重复核验并停止采集。由于更新A帧内部会异步等待 100ms 后重启发送，采集按钮需间隔 150ms 多次核验，直到稳定为“开始数据采集”。整个流程 try/finally，异常/中止时额外 click `tt_btn_stop` 停转台。
5. **应用退出**：主窗口 closed 时主动进入退出流程（不能依赖 `window-all-closed`，因为隐藏页面仍计作窗口）；先 abort 当前流程，在隐藏页面停止转台/保存/A帧发送，随后销毁隐藏窗口并 `app.exit(0)`，确保 Electron 子进程退出。上位机服务是外部人工启动进程，不在本应用的终止范围。
6. **前置检查**：流程开始 `getText('tt_serial_status')` 含「已连接」才继续，否则失败提示人工处理。

## Risks / Trade-offs

- [速度为 0 但位置未到（如堵转/未启动成功）] → 位置容差双条件兜底，超时失败并输出反馈值
- [状态查询无应答导致速度/位置读不到（串口未连好/掉线）] → 读不到视为未到位继续轮询，60s 超时判失败
- [零位附近状态可能显示为 359.x°] → 初始基准严格沿用上位机服务规则：`value >= 140 ? value - 360 : value`；到位比较继续使用 ±360 环绕角差
- [更新A帧会异步重启发送循环，收尾停止与其发生竞态] → 停止逻辑重复读取按钮状态并间隔核验，覆盖 100ms 重启窗口
- [转台未设位置模式时命令被忽略] → 前置由人工保证（用户已确认）；到位超时会暴露该问题
- [初始状态查询无应答或返回占位符] → 任一轴不能解析为数字时在首次移动前快速失败，不使用 0 兜底

## Migration Plan

纯增量：两个 flows 键填充 + setCellText/扫描循环新函数；无迁移。

## Open Questions

（无——点位顺序、预置角值、前置责任、收尾方式均已与用户确认；采集补发与 0.5° 容差为记录在 proposal/本文件的假设）
