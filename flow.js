const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

/**
 * 工具函数工厂 —— 流程函数里通过 h.xxx 调用，一般不需要改这里。
 *   h.click(id)              点击页面上指定 id 的按钮
 *   h.setInput(id, value)    赋值：布尔值→复选框勾选/取消，其他→输入框值（自动触发 input+change 事件）
 *   h.readCell(tableId, row, col)  读取页面表格单元格文本（0 基行列）
 *   h.wait(ms, silent)       延时等待（silent=true 不打日志，轮询用）
 *   h.readFile(path)         读取本地文件并把内容打到日志
 *   h.waitForFile(path, ms)  等待某个文件生成（默认超时 60 秒）
 */
function makeHelpers({ exec, log, signal }) {
  const checkAborted = () => { if (signal.aborted) throw new Error('已中止') }
  const sleep = (ms) => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(new Error('已中止')) }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const cleanupSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const validId = (id) => {
    if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`非法 id: ${id}`)
    return JSON.stringify(id)
  }

  return {
    log,
    click: async (id, { force = false } = {}) => {
      if (!force) checkAborted()
      const r = await exec(`(() => { const el = document.getElementById(${validId(id)}); if (!el) return 'MISSING'; el.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`按钮不存在: ${id}`)
      log(`✔ 点击 ${id}${force ? '（清理）' : ''}`)
    },
    setInput: async (id, value) => {
      checkAborted()
      const isBool = typeof value === 'boolean' || value === 'true' || value === 'false'
      const checked = value === true || value === 'true'
      const setExpr = isBool ? `el.checked = ${checked}` : `el.value = ${JSON.stringify(String(value))}`
      const r = await exec(`(() => { const el = document.getElementById(${validId(id)}); if (!el) return 'MISSING'; ${setExpr}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`输入框不存在: ${id}`)
      log(isBool ? `✔ ${checked ? '勾选' : '取消勾选'} ${id}` : `✔ 输入 ${id} = ${value}`)
    },
    readCell: async (tableId, row, col) => {
      checkAborted()
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
        throw new Error(`非法行列号: ${row}, ${col}`)
      }
      const r = await exec(`(() => { const tb = document.getElementById(${validId(tableId)}); if (!tb) return 'MISSING_TABLE'; const tr = tb.rows[${row}]; const cell = tr && tr.cells[${col}]; return cell ? cell.textContent.trim() : 'MISSING_CELL' })()`)
      if (r === 'MISSING_TABLE') throw new Error(`表格不存在: ${tableId}`)
      if (r === 'MISSING_CELL') throw new Error(`单元格不存在: ${tableId} 第${row}行第${col}列`)
      return r
    },
    getText: async (id, { force = false } = {}) => {
      if (!force) checkAborted()
      const r = await exec(`(() => { const el = document.getElementById(${validId(id)}); return el ? el.textContent.trim() : 'MISSING' })()`)
      if (r === 'MISSING') throw new Error(`元素不存在: ${id}`)
      return r
    },
    setCellText: async (tableId, row, col, value) => {
      checkAborted()
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
        throw new Error(`非法行列号: ${row}, ${col}`)
      }
      const v = JSON.stringify(String(value))
      const r = await exec(`(() => { const tb = document.getElementById(${validId(tableId)}); if (!tb) return 'MISSING_TABLE'; const tr = tb.rows[${row}]; const cell = tr && tr.cells[${col}]; if (!cell) return 'MISSING_CELL'; cell.textContent = ${v}; return 'ok' })()`)
      if (r === 'MISSING_TABLE') throw new Error(`表格不存在: ${tableId}`)
      if (r === 'MISSING_CELL') throw new Error(`单元格不存在: ${tableId} 第${row}行第${col}列`)
      log(`✔ 设置 ${tableId}[${row}][${col}] = ${value}`)
    },
    wait: async (ms, silent = false) => {
      checkAborted()
      if (!silent) log(`... 等待 ${ms}ms`)
      await sleep(ms)
    },
    // 清理阶段专用：流程中止后仍必须能等待页面异步切换完成。
    waitCleanup: cleanupSleep,
    readFile: async (path, maxKB = 64) => {
      checkAborted()
      const buf = await fs.promises.readFile(path)
      log(`📄 ${path}（共 ${buf.length} 字节）:\n${buf.subarray(0, maxKB * 1024).toString('utf8')}`)
      return buf
    },
    waitForFile: async (path, timeoutMs = 60000) => {
      checkAborted()
      const start = Date.now()
      for (;;) {
        try {
          await fs.promises.stat(path)
          log(`✔ 文件已生成: ${path}`)
          return
        } catch { /* 还没出现，继续等 */ }
        if (Date.now() - start > timeoutMs) throw new Error(`等待文件超时(${timeoutMs}ms): ${path}`)
        await sleep(500)
      }
    }
  }
}

/**
 * 搜索能力流程（六个波位共用）—— 规则见 openspec/changes/add-search-capability-flows
 */
// ===== 部署配置：上位机服务数据目录（上位机服务部署位置变化时修改此处） =====
let runtimeDataDir = null

function configureRuntime({ upperComputerPath }) {
  if (typeof upperComputerPath !== 'string' || !upperComputerPath.trim()) {
    throw new Error('上位机路径不能为空')
  }
  runtimeDataDir = path.join(path.resolve(upperComputerPath.trim()), 'data')
}

// 点检测：返回锚帧（"下一帧"/翻转帧）索引数组
function detectPoints(angles, cfg) {
  const anchors = []
  if (cfg.rule === 'signFlip') {
    for (let i = 1; i < angles.length; i++) {
      if (angles[i - 1] > 0 && angles[i] < 0) anchors.push(i)
    }
    return anchors
  }
  let run = 0
  for (let i = 0; i < angles.length; i++) {
    const v = angles[i]
    if (Number.isFinite(v) && v >= cfg.lo && v <= cfg.hi) { run++; continue }
    const nextMatches = cfg.nextGreaterThan !== undefined
      ? Number.isFinite(v) && v > cfg.nextGreaterThan
      : Number.isFinite(v) && Math.round(v) === cfg.target
    if (run >= cfg.n && nextMatches) anchors.push(i)
    run = 0
  }
  return anchors
}

// 帧频判定：连续记录中每相邻两个红外图像帧号的差值必须为 step。
function analyzeFrameFrequency(frameNumbers, required = 1000, step = 2) {
  let validCount = 0
  let currentRun = 0
  let longestRun = 0
  let previous = null

  for (const raw of frameNumbers) {
    const value = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    if (!Number.isFinite(value)) {
      previous = null
      currentRun = 0
      continue
    }

    validCount++
    currentRun = previous !== null && value - previous === step ? currentRun + 1 : 1
    longestRun = Math.max(longestRun, currentRun)
    previous = value
  }

  return { validCount, longestRun, required, step, success: longestRun >= required }
}

async function readFrameFrequencySheet(h, t0, dir) {
  const deadline = Date.now() + 15000
  let file = null
  for (;;) {
    try {
      const files = fs.readdirSync(dir).filter(f => /^数据采集AB帧_.*\.xlsx$/.test(f))
      let newest = null
      let newestM = 0
      for (const f of files) {
        const st = fs.statSync(path.join(dir, f))
        if (st.mtimeMs > t0 && st.mtimeMs > newestM) {
          newest = path.join(dir, f)
          newestM = st.mtimeMs
        }
      }
      if (newest) {
        const size = fs.statSync(newest).size
        await h.wait(500, true)
        if (size > 0 && size === fs.statSync(newest).size) {
          file = newest
          break
        }
      }
    } catch { /* 文件尚未生成或仍在写入，继续等待 */ }
    if (Date.now() > deadline) throw new Error('帧频测试失败：未找到本次保存的数据采集AB帧_*.xlsx')
    await h.wait(500, true)
  }

  h.log(`📄 读取 ${path.basename(file)}（帧频B帧）`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('B帧')
  if (!ws) throw new Error('帧频测试失败：xlsx 中没有「B帧」工作表')

  const header = Array.from(ws.getRow(1).values || [], v => String(v ?? ''))
  const frameCol = header.findIndex(txt => txt.includes('红外图像帧号'))
  if (frameCol === -1) {
    throw new Error(`帧频测试失败：表头未找到「红外图像帧号」列，实际表头: ${header.filter(Boolean).join(' | ')}`)
  }

  const frameNumbers = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const cell = ws.getRow(r).getCell(frameCol)
    const value = parseFloat(String(cell.text ?? cell.value ?? ''))
    frameNumbers.push(value)
  }
  const result = analyzeFrameFrequency(frameNumbers)
  h.log(`... 帧频数据总行数 ${frameNumbers.length}，有效帧号 ${result.validCount}，最长连续段 ${result.longestRun}/${result.required}`)
  if (!result.validCount) throw new Error('帧频测试失败：红外图像帧号字段没有可解析的数值')
  return result
}

// 读取本次保存的 AB帧 xlsx 的「B帧」工作表 → { times[], angles[] }
async function readBFrameSheet(h, t0, dir, channel) {
  const deadline = Date.now() + 15000
  let file = null
  for (;;) {
    try {
      const files = fs.readdirSync(dir).filter(f => /^数据采集AB帧_.*\.xlsx$/.test(f))
      let newest = null, newestM = 0
      for (const f of files) {
        const st = fs.statSync(path.join(dir, f))
        if (st.mtimeMs > t0 && st.mtimeMs > newestM) { newest = path.join(dir, f); newestM = st.mtimeMs }
      }
      if (newest) {
        const s1 = fs.statSync(newest).size
        await h.wait(500, true)
        if (s1 > 0 && s1 === fs.statSync(newest).size) { file = newest; break }
      }
    } catch { /* 目录尚未就绪，继续等 */ }
    if (Date.now() > deadline) throw new Error('搜索测试失败：未找到本次保存的数据采集AB帧_*.xlsx')
    await h.wait(500, true)
  }
  h.log(`📄 读取 ${path.basename(file)}（B帧）`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('B帧')
  if (!ws) throw new Error('搜索测试失败：xlsx 中没有「B帧」工作表')

  // row.values 是稀疏数组（空单元格为洞），用 Array.from 补齐
  const header = Array.from(ws.getRow(1).values || [], v => String(v ?? ''))
  const timeCol = header.findIndex(txt => txt.includes('时间'))
  const angleCol = header.findIndex(txt => txt.includes(`光轴指向${channel}`))
  if (angleCol === -1) throw new Error(`搜索测试失败：表头未找到「光轴指向${channel}」列，实际表头: ${header.filter(Boolean).join(' | ')}`)
  h.log(`... 解析 ${ws.rowCount - 1} 行（时间列${timeCol}，角度列${angleCol}${timeCol === -1 ? '，时间列未识别改用第1列' : ''}）`)

  const times = [], angles = []
  let skipped = 0
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const tVal = row.getCell(timeCol === -1 ? 1 : timeCol).value
    const aVal = parseFloat(String(row.getCell(angleCol).text ?? row.getCell(angleCol).value ?? ''))
    const t = tVal instanceof Date ? tVal.getTime() : Date.parse(String(tVal))
    if (Number.isFinite(t) && Number.isFinite(aVal)) { times.push(t); angles.push(aVal) }
    else skipped++
  }
  if (skipped) h.log(`⚠ 跳过无法解析的帧 ${skipped} 行`, 'warn')
  if (!angles.length) throw new Error('搜索测试失败：B帧数据为空或角度全部无法解析，请检查设备数据流')
  return { times, angles }
}

async function readWakeBFrameSheet(h, recordingStart, dir) {
  const deadline = Date.now() + 15000
  let file = null
  for (;;) {
    try {
      const files = fs.readdirSync(dir).filter(f => /^数据采集AB帧_.*\.xlsx$/.test(f))
      let newest = null, newestM = 0
      for (const f of files) {
        const st = fs.statSync(path.join(dir, f))
        if (st.mtimeMs > recordingStart && st.mtimeMs > newestM) {
          newest = path.join(dir, f)
          newestM = st.mtimeMs
        }
      }
      if (newest) {
        const size = fs.statSync(newest).size
        await h.wait(500, true)
        if (size > 0 && size === fs.statSync(newest).size) { file = newest; break }
      }
    } catch { /* 文件尚未生成，继续等待 */ }
    if (Date.now() > deadline) throw new Error('唤醒测试失败：未找到本次保存的数据采集AB帧_*.xlsx')
    await h.wait(500, true)
  }

  h.log(`📄 读取 ${path.basename(file)}（B帧唤醒轨迹）`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('B帧')
  if (!ws) throw new Error('唤醒测试失败：xlsx 中没有「B帧」工作表')

  const header = Array.from(ws.getRow(1).values || [], v => String(v ?? ''))
  const timeCol = header.findIndex(txt => txt.includes('时间'))
  const pitchCol = header.findIndex(txt => txt.includes('光轴指向俯仰角'))
  const azCol = header.findIndex(txt => txt.includes('光轴指向方位角'))
  if (timeCol === -1 || pitchCol === -1 || azCol === -1) {
    throw new Error(`唤醒测试失败：B帧表头缺少时间或光轴指向角列，实际表头: ${header.filter(Boolean).join(' | ')}`)
  }

  const frames = []
  let skipped = 0
  for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
    const row = ws.getRow(rowIndex)
    const rawTime = row.getCell(timeCol).value
    const time = rawTime instanceof Date ? rawTime.getTime() : Date.parse(String(rawTime))
    const pitch = parseFloat(String(row.getCell(pitchCol).text ?? row.getCell(pitchCol).value ?? ''))
    const az = parseFloat(String(row.getCell(azCol).text ?? row.getCell(azCol).value ?? ''))
    if (Number.isFinite(time) && Number.isFinite(pitch) && Number.isFinite(az)) frames.push({ time, pitch, az })
    else skipped++
  }
  if (skipped) h.log(`⚠ 跳过无法解析的B帧 ${skipped} 行`, 'warn')
  if (!frames.length) throw new Error('唤醒测试失败：B帧数据为空或光轴指向角无法解析')
  return frames
}

function findWakeReturn(frames, wakeTime, limitMs = 2000) {
  const outside = value => Number.isFinite(value) && (value < -1 || value > 1)
  const arrived = value => Number.isFinite(value) && value >= -0.3 && value <= 0.3
  let pitchWasOutside = false
  let azWasOutside = false

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    if (outside(frame.pitch)) pitchWasOutside = true
    if (outside(frame.az)) azWasOutside = true
    if (frame.time < wakeTime || frame.time - wakeTime > limitMs) continue

    const channels = []
    if (pitchWasOutside && arrived(frame.pitch)) channels.push('俯仰角')
    if (azWasOutside && arrived(frame.az)) channels.push('方位角')
    if (channels.length) {
      return { found: true, ...frame, index, channels, elapsedMs: frame.time - wakeTime }
    }
  }
  return { found: false, pitchWasOutside, azWasOutside }
}

const SEARCH_RECORD_SECONDS = 15

async function startAcquisitionAndSave(h) {
  await h.click('pushButton_SJCJ_F000H_Send')
  const acquisitionText = await h.getText('pushButton_SJCJ_F000H_Send')
  if (!acquisitionText.includes('停止')) {
    throw new Error(`启动数据采集失败：按钮状态为“${acquisitionText}”`)
  }

  await h.click('pushButton_SJCJ_0010H')
  const saveText = await h.getText('pushButton_SJCJ_0010H')
  if (!saveText.includes('停止')) {
    throw new Error(`启动保存A/B帧失败：按钮状态为“${saveText}”`)
  }
}

async function runWakeFlow(h, dataDir = runtimeDataDir) {
  if (!dataDir) throw new Error('未配置上位机路径，请检查 config.json')
  const RECORD_MS = 2000
  h.log('▶ 唤醒测试：预置状态、A帧发送与A/B帧保存先于唤醒指令')

  await stopAcquisitionAndSave(h)
  await h.setInput('comboBox_YZCSZL', true)
  const recordingStart = Date.now()
  await startAcquisitionAndSave(h)

  let wakeTime
  try {
    await h.wait(100, true) // 预录少量B帧，用于确认角度在唤醒前/初期确实位于 ±1° 外
    wakeTime = Date.now()
    await h.click('pushButton_Wake')
    h.log('... 唤醒指令已发送，继续保存B帧 2s')
    await h.wait(RECORD_MS, true)
  } finally {
    await stopAcquisitionAndSave(h, { force: true })
  }

  const frames = await readWakeBFrameSheet(h, recordingStart, dataDir)
  const result = findWakeReturn(frames, wakeTime, RECORD_MS)
  const last = frames[frames.length - 1]
  h.log(`... 本次解析B帧 ${frames.length} 行，末帧俯仰=${last.pitch.toFixed(3)}° 方位=${last.az.toFixed(3)}°`)
  if (!result.found) {
    const outsideChannels = [result.pitchWasOutside && '俯仰角', result.azWasOutside && '方位角'].filter(Boolean)
    if (!outsideChannels.length) {
      throw new Error('唤醒测试失败：2s B帧中俯仰角、方位角均未出现小于-1°或大于1°的起始状态')
    }
    throw new Error(`唤醒测试失败：${outsideChannels.join('、')}曾超出±1°，但2s内未回到±0.3°`)
  }

  h.log(`✔ ${result.channels.join('、')}从±1°外回到±0.3°：俯仰=${result.pitch.toFixed(3)}° 方位=${result.az.toFixed(3)}°`)
  h.log(`⏱ 唤醒用时 ${result.elapsedMs}ms（终点为B帧时间戳）`)
  h.log('✅ 唤醒测试成功')
  return result
}

// 搜索流程主体
async function runSearchFlow(h, cfg, dataDir = runtimeDataDir) {
  if (!dataDir) throw new Error('未配置上位机路径，请检查 config.json')
  const NEED = 5
  h.log(`▶ 搜索流程【${cfg.name}】搜索指令=${cfg.sszl}`)
  await h.setInput('comboBox_SSZL', cfg.sszl)      // 搜索指令（发送前设置，A帧为启动时快照）
  await h.setInput('comboBox_HWJHKZ', true)        // 允许截获

  // 切换按钮可能被人工操作或上次异常遗留在运行状态。先统一停止，再开始本次独立录制。
  const stoppedOldRun = await stopAcquisitionAndSave(h)
  if (stoppedOldRun) await h.wait(500, true)
  const t0 = Date.now()

  try {
    await startAcquisitionAndSave(h)
    for (let s = SEARCH_RECORD_SECONDS; s >= 1; s--) {
      h.log(`... 录制中，剩余 ${s}s`)
      await h.wait(1000, true)
    }
    h.log(`... 录制结束（${SEARCH_RECORD_SECONDS}s），发送搜索流程收尾A帧`)
    await h.setInput('comboBox_HWJHKZ', false) // 取消允许截获
    await h.setInput('comboBox_YZCSZL', true)   // 启用地面预置测试状态
    await h.click('pushButton_SJCJ_F000H_update')
    h.log('... 收尾A帧已更新并发送，准备停止保存与采集')
  } finally {
    await stopAcquisitionAndSave(h, { force: true })
  }

  const { times, angles } = await readBFrameSheet(h, t0, dataDir, cfg.channel)
  const anchors = detectPoints(angles, cfg)
  h.log(`... 检测到 ${anchors.length} 个点（总帧数 ${angles.length}）`)
  if (anchors.length < NEED) {
    throw new Error(`搜索测试失败：【${cfg.name}】仅找到 ${anchors.length}/${NEED} 个连续点（总帧数 ${angles.length}）`)
  }

  const used = anchors.slice(0, NEED)
  const avgMs = (times[used[NEED - 1]] - times[used[0]]) / 5
  const seg = angles.slice(used[0], used[NEED - 1] + 1)
  const range = Math.max(...seg) - Math.min(...seg)
  used.forEach((idx, i) => h.log(`点${i + 1}: 帧${idx + 1} ${cfg.channel}=${angles[idx].toFixed(3)}°`))
  h.log(`📊 平均时间 = ${avgMs.toFixed(1)}ms，范围 = ${range.toFixed(3)}°`)
  h.log(`✅ ${cfg.name}搜索测试完成`)
  return { avgMs, range }
}

async function runFrameRateFlow(h, dataDir = runtimeDataDir) {
  if (!dataDir) throw new Error('未配置上位机路径，请检查 config.json')
  h.log('▶ 帧频测试：发送A帧并保存A/B帧15秒')

  const stoppedOldRun = await stopAcquisitionAndSave(h)
  if (stoppedOldRun) await h.wait(500, true)
  const t0 = Date.now()

  try {
    await startAcquisitionAndSave(h)
    for (let s = SEARCH_RECORD_SECONDS; s >= 1; s--) {
      h.log(`... 帧频录制中，剩余 ${s}s`)
      await h.wait(1000, true)
    }
    h.log(`... 帧频录制结束（${SEARCH_RECORD_SECONDS}s）`)
  } finally {
    await stopAcquisitionAndSave(h, { force: true })
  }

  const result = await readFrameFrequencySheet(h, t0, dataDir)
  if (!result.success) {
    throw new Error(`帧频测试失败：最长连续段 ${result.longestRun}/${result.required}，要求相邻帧号差为${result.step}`)
  }
  h.log(`✅ 帧频测试成功：连续 ${result.longestRun} 帧，前后帧号差为 ${result.step}`)
  return result
}

// 六个波位的规则配置
const SEARCH_CONFIGS = {
  '搜索能力 - 九波位':      { name: '九波位', sszl: '001b九位波搜索', channel: '方位角', n: 5, lo: -0.3, hi: 0.3, nextGreaterThan: 1 },
  '搜索能力 - 十六波位':    { name: '十六波位', sszl: '010b十六位波搜索', channel: '方位角', n: 5, lo: -0.3, hi: 0.3, nextGreaterThan: 1 },
  '搜索能力 - 俯仰向三波位': { name: '俯仰向三波位', sszl: '011b俯仰向三波位搜索', channel: '俯仰角', n: 5, lo: -0.5, hi: 0.5, target: -2 },
  '搜索能力 - 方位向三波位': { name: '方位向三波位', sszl: '100b方位向三波位搜索', channel: '方位角', n: 5, lo: -0.3, hi: 0.3, target: -3 },
  '搜索能力 - 五波位':      { name: '五波位', sszl: '101b五波位搜索', channel: '方位角', n: 5, lo: -0.3, hi: 0.3, target: -1 },
  '搜索能力 - 四波位':      { name: '四波位', sszl: '110b四波位搜索', channel: '方位角', rule: 'signFlip' }
}

/**
 * 转台扫描流程（最小搜索范围 / 光轴预置范围）—— 规则见 openspec/changes/add-turntable-scan-flows
 */
// 每项是相对流程开始时转台位置的 [内环方位偏移, 外环俯仰偏移]。
const POSITIONS = [[0, -45], [-15, -40], [22, -30], [-23, -20], [21, -10], [-18, 0], [10, 10], [0, 15]]
const ARRIVE_TOL = 0.5      // 到位位置容差（度）
const ARRIVE_TIMEOUT = 60000 // 单点到位超时（ms）
const fmtN = (v) => (Number.isFinite(v) ? v.toFixed(3) : 'N/A')
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180)
// 与上位机服务标定扫描保持一致：状态值 >= 140° 时换算到负角度表示。
const normalizeTurntableBasePosition = (value) => value >= 140 ? value - 360 : value

async function assertTurntableReady(h) {
  const s = await h.getText('tt_serial_status')
  if (!s.includes('已连接')) throw new Error(`转台串口未连接（${s}），请先在上位机页面连接转台串口`)
}

// 真机轴向：内环=方位，外环=俯仰。
// 到位 = 两轴速度为 0 且反馈位置进目标 ±容差（考虑 ±360° 环绕）
async function waitTurntableArrive(h, innerTarget, outerTarget, timeoutMs = ARRIVE_TIMEOUT, pollMs = 200) {
  const t0 = Date.now()
  for (;;) {
    await h.click('tt_btn_status')
    await h.wait(pollMs, true)
    const vInner = parseFloat(await h.getText('tt_td_inner_vel'))
    const vOuter = parseFloat(await h.getText('tt_td_outer_vel'))
    const pInner = parseFloat(await h.getText('tt_td_inner_pos'))
    const pOuter = parseFloat(await h.getText('tt_td_outer_pos'))
    const stopped = [vInner, vOuter].every(v => Number.isFinite(v) && Math.abs(v) < 0.0001)
    const posOk = angDiff(pInner, innerTarget) <= ARRIVE_TOL && angDiff(pOuter, outerTarget) <= ARRIVE_TOL
    if (stopped && posOk) {
      h.log(`✔ 到位：内环(方位)=${fmtN(pInner)}° 外环(俯仰)=${fmtN(pOuter)}°`)
      return
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`转台到位超时：目标(内环=${innerTarget},外环=${outerTarget})，反馈(内环=${fmtN(pInner)},外环=${fmtN(pOuter)})，速度(${fmtN(vInner)},${fmtN(vOuter)})`)
    }
  }
}

async function readTurntablePosition(h) {
  await h.click('tt_btn_status')
  await h.wait(200, true)
  const rawInner = parseFloat(await h.getText('tt_td_inner_pos'))
  const rawOuter = parseFloat(await h.getText('tt_td_outer_pos'))
  if (!Number.isFinite(rawInner) || !Number.isFinite(rawOuter)) {
    throw new Error(`无法读取转台初始位置：内环=${fmtN(rawInner)} 外环=${fmtN(rawOuter)}`)
  }
  const inner = normalizeTurntableBasePosition(rawInner)
  const outer = normalizeTurntableBasePosition(rawOuter)
  if (inner !== rawInner || outer !== rawOuter) {
    h.log(`... 初始位置按上位机规则换算：(${rawInner}, ${rawOuter}) → (${inner}, ${outer})`)
  }
  h.log(`✔ 转台初始位置：内环(方位)=${inner.toFixed(3)}° 外环(俯仰)=${outer.toFixed(3)}°`)
  return { inner, outer }
}

// 8 点位扫描：每个目标=初始位置+当前序列偏移；A帧回调同时收到原始序列值。
async function scanPositions(h, onArrived, dwellMs = 5000) {
  const { inner: baseInner, outer: baseOuter } = await readTurntablePosition(h)
  for (let i = 0; i < POSITIONS.length; i++) {
    const [innerOffset, outerOffset] = POSITIONS[i]
    const innerTarget = baseInner + innerOffset
    const outerTarget = baseOuter + outerOffset
    h.log(`▶ 点位 ${i + 1}/${POSITIONS.length}：初始位置+偏移(${innerOffset}, ${outerOffset}) → 目标内环(方位)=${innerTarget}° 外环(俯仰)=${outerTarget}°`)
    await h.setInput('tt_input_inner_pos', innerTarget)
    await h.setInput('tt_input_outer_pos', outerTarget)
    await h.click('tt_btn_set_pos')
    await h.click('tt_btn_run')
    await waitTurntableArrive(h, innerTarget, outerTarget)
    if (onArrived) {
      await onArrived({ innerTarget, outerTarget, innerOffset, outerOffset, index: i })
    }
    for (let s = Math.round(dwellMs / 1000) - 1; s >= 1; s--) {
      await h.wait(1000, true)
      h.log(`... 停留中，本点剩余 ${s}s`)
    }
    await h.wait(dwellMs % 1000 || 1000, true)
  }
  h.log(`✔ ${POSITIONS.length} 个点位扫描完成`)
}

const waitDuringCleanup = (h, ms) => h.waitCleanup ? h.waitCleanup(ms) : h.wait(ms, true)

// 收尾清理：先停保存再停采集（force=中止后仍执行）。
// “更新A帧”会异步停 100ms 后重启采集，因此采集开关需重复核验到稳定停止。
async function stopAcquisitionAndSave(h, { force = false } = {}) {
  let stoppedAny = false
  const stopToggle = async (id, label, attempts) => {
    try {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (!(await h.getText(id, { force })).includes('停止')) return
        await h.click(id, { force })
        stoppedAny = true
        await waitDuringCleanup(h, 150)
      }
      const text = await h.getText(id, { force })
      if (text.includes('停止')) throw new Error(`按钮仍为“${text}”`)
    } catch (e) {
      h.log(`⚠ 停止${label}失败: ${e.message}`, 'warn')
    }
  }
  await stopToggle('pushButton_SJCJ_0010H', '保存', 2)
  await stopToggle('pushButton_SJCJ_F000H_Send', 'A帧发送', 4)
  return stoppedAny
}

/**
 * 左侧面板结构（从上到下）—— type: button 点击即运行 / select 选中某选项即运行对应流程
 */
const sidebar = [
  { type: 'button', label: '自检' },
  { type: 'button', label: '唤醒' },
  { type: 'button', label: '帧频' },
  { type: 'select', label: '搜索能力', options: ['九波位', '十六波位', '俯仰向三波位', '方位向三波位', '五波位', '四波位'] },
  { type: 'button', label: '最小搜索范围' },
  { type: 'button', label: '光轴预置范围' }
]

/**
 * 流程定义 —— 键名与左侧面板条目对应；下拉框流程键名为「标签 - 选项」。
 */
const flows = {
  /**
   * 自检：点击自检 → 取自检结果 → 判定 14 项 → 总用时 ≤9s 判成功
   * 结果表 tableWidget_ZJJG：13 行 4 列；项 1-13 在左半区，项 14-26 在右半区
   */
  '自检': async (h) => {
    const LIMIT = 9000
    const t0 = Date.now()
    const items = [
      { name: '红外AD芯片自检', row: 0, col: 1, expect: '正常' },
      { name: '红外测温二极管自检', row: 1, col: 1, expect: '正常' },
      { name: '红外制冷状态自检', row: 2, col: 1, expect: '到位' },
      { name: '激光发射温控状态自检', row: 4, col: 1, expect: '正常' },
      { name: '激光器状态自检', row: 5, col: 1, expect: '正常' },
      { name: '激光器接收状态自检', row: 6, col: 1, expect: '正常' },
      { name: '激光接收模块温度自检', row: 7, col: 1, expect: '正常' },
      { name: '激光接收比较电平自检', row: 8, col: 1, expect: '正常' },
      { name: '激光接收高压自检', row: 9, col: 1, expect: '正常' },
      { name: '伺服预置状态自检', row: 12, col: 1, expect: '正常' },
      { name: '与激光发射通信状态自检', row: 1, col: 3, expect: '正常' },
      { name: '与激光接收通信状态自检', row: 2, col: 3, expect: '正常' },
      { name: '与微机械陀螺通信状态自检', row: 3, col: 3, expect: '正常' },
      { name: '频率源锁定状态', row: 6, col: 3, expect: '正常' }
    ]
    const validStatuses = new Set(['正常', '异常', '到位', '未到位'])

    await h.click('pushButton_ZJ')
    await h.wait(2000, true) // 预留设备自检执行时间（经验值，联机验证时可调）
    await h.click('pushButton_QZJJG')

    const status = new Map(items.map(it => [it.name, null]))
    let loggedRead = 0
    const failWith = (reason) => {
      for (const it of items) {
        const s = status.get(it.name)
        h.log(`${s === it.expect ? '✔' : '✘'} ${it.name} = ${s || '未读取'}（期望 ${it.expect}）`, s === it.expect ? 'info' : 'error')
      }
      h.log(`⏱ 自检总用时 ${Date.now() - t0}ms`)
      throw new Error(`自检测试失败：${reason}`)
    }

    for (;;) {
      for (const it of items) {
        if (status.get(it.name) !== null) continue
        try {
          const text = await h.readCell('tableWidget_ZJJG', it.row, it.col)
          // CSV 初始占位值为“0”；只接受设备回包会写入的明确状态文本。
          if (validStatuses.has(text)) status.set(it.name, text)
        } catch { /* 单元格暂不可读，下轮再试 */ }
      }

      const read = items.filter(it => status.get(it.name) !== null)
      const bad = read.filter(it => status.get(it.name) !== it.expect)
      if (read.length > loggedRead) {
        h.log(`... 自检结果已读取 ${read.length}/${items.length} 项`)
        loggedRead = read.length
      }
      if (bad.length) failWith(`${bad.map(b => `${b.name}=${status.get(b.name)}`).join('、')} 不合格`)

      const elapsed = Date.now() - t0
      if (read.length === items.length) {
        for (const it of items) h.log(`✔ ${it.name} = ${status.get(it.name)}`)
        h.log(`⏱ 自检总用时 ${elapsed}ms`)
        if (elapsed > LIMIT) throw new Error(`自检测试失败：用时 ${elapsed}ms 超过 ${LIMIT}ms`)
        h.log('✅ 自检测试成功')
        return
      }
      if (elapsed > LIMIT) failWith('超时，结果未取全')
      await h.wait(300, true)
    }
  },

  '唤醒': async (h) => runWakeFlow(h),
  '帧频': async (h) => runFrameRateFlow(h),

  '搜索能力 - 九波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 九波位']),
  '搜索能力 - 十六波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 十六波位']),
  '搜索能力 - 俯仰向三波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 俯仰向三波位']),
  '搜索能力 - 方位向三波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 方位向三波位']),
  '搜索能力 - 五波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 五波位']),
  '搜索能力 - 四波位': async (h) => runSearchFlow(h, SEARCH_CONFIGS['搜索能力 - 四波位']),
  /**
   * 最小搜索范围（最小跟踪视场测试）：勾截获→采集→保存B帧→5s→8点位扫描→
   * 取消截获+发清除帧→停止采集/保存
   */
  '最小搜索范围': async (h) => {
    h.log('▶ 流程【最小搜索范围】（最小跟踪视场测试）')
    await assertTurntableReady(h)
    await h.setInput('comboBox_HWJHKZ', true)
    await stopAcquisitionAndSave(h)
    await startAcquisitionAndSave(h)
    try {
      await h.wait(5000, true)
      h.log('... 预录 5s 结束，开始点位扫描')
      await scanPositions(h)
      h.log('... 取消允许截获并发清除帧')
      await h.setInput('comboBox_HWJHKZ', false)
      await h.click('pushButton_SJCJ_F000H_update')
    } finally {
      await h.click('tt_btn_stop', { force: true })
      await stopAcquisitionAndSave(h, { force: true })
    }
    h.log('✅ 最小搜索范围流程完成')
  },

  /**
   * 光轴预置范围：勾选地面预置→采集→保存B帧→5s→8点位扫描（每点到位后
   * 预置俯仰/方位角设为该点角度并更新A帧发出）→取消预置+发清除帧→停止
   */
  '光轴预置范围': async (h) => {
    h.log('▶ 流程【光轴预置范围】')
    await assertTurntableReady(h)
    await h.setInput('comboBox_YZCSZL', true)      // 地面预置测试状态
    await stopAcquisitionAndSave(h)
    await startAcquisitionAndSave(h)
    try {
      await h.wait(5000, true)
      h.log('... 预录 5s 结束，开始点位扫描')
      await scanPositions(h, async ({ innerOffset, outerOffset }) => {
        h.log(`... A帧写入当前序列值：预置方位=${innerOffset.toFixed(1)}° 预置俯仰=${outerOffset.toFixed(1)}°`)
        await h.setCellText('tableWidget_SJCJ_F000H_Send', 25, 1, outerOffset.toFixed(1))
        await h.setCellText('tableWidget_SJCJ_F000H_Send', 26, 1, innerOffset.toFixed(1))
        await h.click('pushButton_SJCJ_F000H_update')  // 更新A帧发出预置
      })
      h.log('... 预置方位角、预置俯仰角回零，取消地面预置并更新A帧发出')
      await h.setCellText('tableWidget_SJCJ_F000H_Send', 25, 1, '0.0')
      await h.setCellText('tableWidget_SJCJ_F000H_Send', 26, 1, '0.0')
      await h.setInput('comboBox_YZCSZL', false)
      await h.click('pushButton_SJCJ_F000H_update')
    } finally {
      await h.click('tt_btn_stop', { force: true })
      await stopAcquisitionAndSave(h, { force: true })
    }
    h.log('✅ 光轴预置范围流程完成')
  }
}

module.exports = {
  sidebar,
  flows,
  makeHelpers,
  configureRuntime,
  SEARCH_CONFIGS,
  detectPoints,
  runSearchFlow,
  runFrameRateFlow,
  readFrameFrequencySheet,
  analyzeFrameFrequency,
  runWakeFlow,
  findWakeReturn,
  stopAcquisitionAndSave,
  normalizeTurntableBasePosition,
  POSITIONS
}
