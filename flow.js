const fs = require('fs')

/**
 * 工具函数工厂 —— 流程函数里通过 h.xxx 调用，一般不需要改这里。
 *   h.click(id)              点击页面上指定 id 的按钮
 *   h.setInput(id, value)    给输入框/表格内输入框赋值（自动触发 input+change 事件）
 *   h.wait(ms)               延时等待
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
      const v = JSON.stringify(String(value))
      const r = await exec(`(() => { const el = document.getElementById(${validId(id)}); if (!el) return 'MISSING'; el.value = ${v}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`输入框不存在: ${id}`)
      log(`✔ 输入 ${id} = ${value}`)
    },
    wait: async (ms) => {
      checkAborted()
      log(`... 等待 ${ms}ms`)
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
 * 各流程具体步骤待补充，现在为占位。
 */
const flows = {
  '自检': async (h) => {
    h.log('TODO: 自检流程步骤待定义')
  },
  '唤醒': async (h) => {
    h.log('TODO: 唤醒流程步骤待定义')
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
