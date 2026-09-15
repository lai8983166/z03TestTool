const fs = require('fs')

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
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('已中止')) }, { once: true })
  })
  const validId = (id) => {
    if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`非法 id: ${id}`)
    return JSON.stringify(id)
  }

  return {
    log,
    click: async (id) => {
      checkAborted()
      const r = await exec(`(() => { const el = document.getElementById(${validId(id)}); if (!el) return 'MISSING'; el.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`按钮不存在: ${id}`)
      log(`✔ 点击 ${id}`)
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
    wait: async (ms, silent = false) => {
      checkAborted()
      if (!silent) log(`... 等待 ${ms}ms`)
      await sleep(ms)
    },
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
 * 左侧面板结构（从上到下）—— type: button 点击即运行 / select 选中某选项即运行对应流程
 */
const sidebar = [
  { type: 'button', label: '自检' },
  { type: 'button', label: '唤醒' },
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
   * 结果表 tableWidget_ZJJG：项 N 在第 N-1 行；项 1-13 第 1 列，项 14-26 第 3 列
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
      { name: '与激光发射通信状态自检', row: 14, col: 3, expect: '正常' },
      { name: '与激光接收通信状态自检', row: 15, col: 3, expect: '正常' },
      { name: '与微机械陀螺通信状态自检', row: 16, col: 3, expect: '正常' },
      { name: '频率源锁定状态', row: 19, col: 3, expect: '正常' }
    ]

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
          if (text) status.set(it.name, text)
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

  /**
   * 唤醒：点击唤醒 → 勾选地面预置测试状态 → 更新A帧 → 2s 内俯仰/方位角进 ±0.3° 判成功
   * F000H 应答表 tableWidget_SJCJ_F000H_Recv：俯仰角第 15 行、方位角第 16 行（0 基 14/15）第 1 列
   */
  '唤醒': async (h) => {
    const LIMIT = 2000
    const t0 = Date.now()
    const fmt = (v) => (Number.isFinite(v) ? v.toFixed(3) : 'N/A')
    const inRange = (v) => Number.isFinite(v) && v >= -0.3 && v <= 0.3

    await h.click('pushButton_Wake')
    await h.setInput('comboBox_YZCSZL', true)      // 地面预置测试状态
    await h.click('pushButton_SJCJ_F000H_update')  // 更新A帧

    for (;;) {
      const pitch = parseFloat(await h.readCell('tableWidget_SJCJ_F000H_Recv', 14, 1))
      const az = parseFloat(await h.readCell('tableWidget_SJCJ_F000H_Recv', 15, 1))
      h.log(`... 轮询 俯仰=${fmt(pitch)}° 方位=${fmt(az)}°`)
      if (inRange(pitch) && inRange(az)) {
        h.log(`⏱ 唤醒总用时 ${Date.now() - t0}ms`)
        h.log('✅ 唤醒测试成功（伺服自检到位）')
        return
      }
      if (Date.now() - t0 > LIMIT) {
        h.log(`⏱ 唤醒总用时 ${Date.now() - t0}ms`)
        throw new Error(`唤醒测试失败：超时未到位 俯仰=${fmt(pitch)}° 方位=${fmt(az)}°`)
      }
      await h.wait(100, true)
    }
  },

  '搜索能力 - 九波位': async (h) => {
    h.log('TODO: 搜索能力（九波位）步骤待定义')
  },
  '搜索能力 - 十六波位': async (h) => {
    h.log('TODO: 搜索能力（十六波位）步骤待定义')
  },
  '搜索能力 - 俯仰向三波位': async (h) => {
    h.log('TODO: 搜索能力（俯仰向三波位）步骤待定义')
  },
  '搜索能力 - 方位向三波位': async (h) => {
    h.log('TODO: 搜索能力（方位向三波位）步骤待定义')
  },
  '搜索能力 - 五波位': async (h) => {
    h.log('TODO: 搜索能力（五波位）步骤待定义')
  },
  '搜索能力 - 四波位': async (h) => {
    h.log('TODO: 搜索能力（四波位）步骤待定义')
  },
  '最小搜索范围': async (h) => {
    h.log('TODO: 最小搜索范围流程步骤待定义')
  },
  '光轴预置范围': async (h) => {
    h.log('TODO: 光轴预置范围流程步骤待定义')
  }
}

module.exports = { sidebar, flows, makeHelpers }
