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
 * 流程定义 —— 一个键 = 左侧面板一个按钮，值为该流程的执行函数。
 * 添加新流程：照着下面的样子加一个键值对即可。
 */
const flows = {
  '演示流程': async (h) => {
    await h.wait(500)
    await h.click('pushButton_End_Save') // 演示：未录制时点击「停止保存」为空操作，无副作用
    await h.wait(1000)
    await h.readFile('D:/projects/7-31/dist/app/config.json')
  }

  // '流程名称': async (h) => {
  //   await h.click('按钮id')
  //   await h.wait(2000)
  //   await h.waitForFile('D:/xxx/输出文件.dat')
  //   await h.readFile('D:/xxx/输出文件.dat')
  // },
}

module.exports = { flows, makeHelpers }
