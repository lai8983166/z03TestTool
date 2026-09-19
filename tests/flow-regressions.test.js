const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ExcelJS = require('exceljs')

const {
  flows,
  runSearchFlow,
  runWakeFlow,
  findWakeReturn,
  stopAcquisitionAndSave,
  normalizeTurntableBasePosition,
  SEARCH_CONFIGS,
  detectPoints
} = require('../flow')

test('nine- and sixteen-position points require the immediate next frame to rise above 1', () => {
  for (const key of ['搜索能力 - 九波位', '搜索能力 - 十六波位']) {
    const cfg = SEARCH_CONFIGS[key]
    assert.deepEqual(detectPoints([0, 0, 0, 0, 0, 0, 0, 0, 1.01], cfg), [8], key)
    assert.deepEqual(detectPoints([0, 0, 0, 0, 0, 0, 0, 0, 1], cfg), [], key)
    assert.deepEqual(detectPoints([0, 0, 0, 0, 0, 0, 0, 0, 0.9, 1.2], cfg), [], `${key} must use the immediate next frame`)
  }
})

test('self-check ignores placeholder zero and reads the right half of the 13-row table', async () => {
  const expected = new Map([
    ['0,1', '正常'], ['1,1', '正常'], ['2,1', '到位'], ['4,1', '正常'],
    ['5,1', '正常'], ['6,1', '正常'], ['7,1', '正常'], ['8,1', '正常'],
    ['9,1', '正常'], ['12,1', '正常'], ['1,3', '正常'], ['2,3', '正常'],
    ['3,3', '正常'], ['6,3', '正常']
  ])
  const reads = new Map()
  const logs = []
  const h = {
    click: async () => {},
    wait: async () => {},
    log: (message) => logs.push(message),
    readCell: async (_table, row, col) => {
      const key = `${row},${col}`
      assert.ok(expected.has(key), `unexpected self-check cell ${key}`)
      const count = (reads.get(key) || 0) + 1
      reads.set(key, count)
      return count === 1 ? '0' : expected.get(key)
    }
  }

  await flows['自检'](h)

  assert.equal(reads.size, 14)
  assert.ok([...reads.values()].every((count) => count >= 2))
  assert.ok(logs.some((line) => line.includes('自检测试成功')))
})

test('wake records before command and uses the first B-frame return from outside ±1 to ±0.3', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'z03-wake-'))
  const actions = []
  const buttonText = new Map([
    ['pushButton_SJCJ_F000H_Send', '开始数据采集'],
    ['pushButton_SJCJ_0010H', '开始保存A/B帧']
  ])
  let wakeTime = 0

  const h = {
    log: () => {},
    setInput: async (id, value) => actions.push(`set:${id}=${value}`),
    getText: async (id) => buttonText.get(id),
    waitCleanup: async () => {},
    wait: async () => {},
    click: async (id) => {
      actions.push(`click:${id}`)
      if (id === 'pushButton_Wake') wakeTime = Date.now()
      if (id === 'pushButton_SJCJ_F000H_Send') {
        buttonText.set(id, buttonText.get(id).includes('停止') ? '开始数据采集' : '停止数据采集')
      }
      if (id === 'pushButton_SJCJ_0010H') {
        const stopping = buttonText.get(id).includes('停止')
        buttonText.set(id, stopping ? '开始保存A/B帧' : '停止保存A/B帧')
        if (stopping) {
          await new Promise(resolve => setTimeout(resolve, 20))
          const workbook = new ExcelJS.Workbook()
          const sheet = workbook.addWorksheet('B帧')
          sheet.addRow(['时间', '光轴指向俯仰角', '光轴指向方位角'])
          sheet.addRow([new Date(wakeTime - 50).toISOString(), 2.2, 0.5])
          sheet.addRow([new Date(wakeTime + 300).toISOString(), 0.8, 0.4])
          sheet.addRow([new Date(wakeTime + 620).toISOString(), 0.2, 0.4])
          await workbook.xlsx.writeFile(path.join(tempDir, '数据采集AB帧_wake.xlsx'))
        }
      }
    }
  }

  try {
    const result = await runWakeFlow(h, tempDir)
    assert.equal(result.elapsedMs, 620)
    assert.deepEqual(result.channels, ['俯仰角'])
    assert.ok(actions.indexOf('set:comboBox_YZCSZL=true') < actions.indexOf('click:pushButton_SJCJ_F000H_Send'))
    assert.ok(actions.indexOf('click:pushButton_SJCJ_0010H') < actions.indexOf('click:pushButton_Wake'))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('wake transition requires a prior outside-±1 sample and accepts either angle', () => {
  const wakeTime = 1000
  assert.equal(findWakeReturn([
    { time: 900, pitch: 0.2, az: 0.1 },
    { time: 1200, pitch: 0.1, az: 0.2 }
  ], wakeTime).found, false)

  const result = findWakeReturn([
    { time: 950, pitch: 0.2, az: -1.4 },
    { time: 1400, pitch: 0.1, az: -0.2 }
  ], wakeTime)
  assert.deepEqual(result.channels, ['方位角'])
  assert.equal(result.elapsedMs, 400)
})

test('search resets stale toggle states and records for 15 seconds', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'z03-search-'))
  const actions = []
  const waits = []
  const buttonText = new Map([
    ['pushButton_SJCJ_F000H_Send', '停止数据采集'],
    ['pushButton_SJCJ_0010H', '停止保存A/B帧']
  ])
  let wroteWorkbook = false

  const toggleButton = async (id) => {
    if (id === 'pushButton_SJCJ_F000H_Send') {
      buttonText.set(id, buttonText.get(id).includes('停止') ? '开始数据采集' : '停止数据采集')
    }
    if (id === 'pushButton_SJCJ_0010H') {
      const starting = !buttonText.get(id).includes('停止')
      buttonText.set(id, starting ? '停止保存A/B帧' : '开始保存A/B帧')
      if (starting && !wroteWorkbook) {
        wroteWorkbook = true
        await new Promise((resolve) => setTimeout(resolve, 20))
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('B帧')
        sheet.addRow(['时间', '光轴指向方位角'])
        const base = Date.now()
        for (let i = 0; i < 21; i++) {
          sheet.addRow([new Date(base + i * 200).toISOString(), 1])
          sheet.addRow([new Date(base + i * 200 + 100).toISOString(), -1])
        }
        await workbook.xlsx.writeFile(path.join(tempDir, '数据采集AB帧_test.xlsx'))
      }
    }
  }

  const h = {
    setInput: async (id, value) => actions.push(`set:${id}=${value}`),
    click: async (id) => {
      actions.push(`click:${id}`)
      await toggleButton(id)
    },
    getText: async (id) => buttonText.get(id),
    wait: async (ms) => waits.push(ms),
    log: () => {}
  }

  try {
    const result = await runSearchFlow(h, {
      name: '测试波位',
      sszl: '001b九位波搜索',
      channel: '方位角',
      rule: 'signFlip'
    }, tempDir)

    assert.ok(Number.isFinite(result.avgMs))
    assert.equal(waits.filter((ms) => ms === 1000).length, 15)
    assert.deepEqual(actions.filter((action) => action.startsWith('click:')), [
      'click:pushButton_SJCJ_0010H',
      'click:pushButton_SJCJ_F000H_Send',
      'click:pushButton_SJCJ_F000H_Send',
      'click:pushButton_SJCJ_0010H',
      'click:pushButton_SJCJ_0010H',
      'click:pushButton_SJCJ_F000H_Send'
    ])
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('turntable derives every target from the initial position and resets A-frame preset angles', async () => {
  const inputs = []
  const cells = []
  const buttonText = new Map([
    ['pushButton_SJCJ_F000H_Send', '开始数据采集'],
    ['pushButton_SJCJ_0010H', '开始保存A/B帧']
  ])
  const current = { inner: 1, outer: 2 }

  const h = {
    log: () => {},
    wait: async () => {},
    waitCleanup: async () => {},
    setInput: async (id, value) => {
      inputs.push([id, value])
      if (id === 'tt_input_inner_pos') current.inner = Number(value)
      if (id === 'tt_input_outer_pos') current.outer = Number(value)
    },
    setCellText: async (table, row, col, value) => cells.push([table, row, col, value]),
    click: async (id) => {
      if (id === 'pushButton_SJCJ_F000H_Send') {
        buttonText.set(id, buttonText.get(id).includes('停止') ? '开始数据采集' : '停止数据采集')
      }
      if (id === 'pushButton_SJCJ_0010H') {
        buttonText.set(id, buttonText.get(id).includes('停止') ? '开始保存A/B帧' : '停止保存A/B帧')
      }
    },
    getText: async (id) => {
      if (buttonText.has(id)) return buttonText.get(id)
      if (id === 'tt_serial_status') return '已连接'
      if (id === 'tt_td_inner_vel' || id === 'tt_td_outer_vel') return '0'
      if (id === 'tt_td_inner_pos') return String(current.inner)
      if (id === 'tt_td_outer_pos') return String(current.outer)
      return ''
    }
  }

  await flows['光轴预置范围'](h)

  const turntableInputs = inputs.filter(([id]) => id.startsWith('tt_input_'))
  assert.deepEqual(turntableInputs.slice(0, 4), [
    ['tt_input_inner_pos', 1],
    ['tt_input_outer_pos', -43],
    ['tt_input_inner_pos', -14],
    ['tt_input_outer_pos', -38]
  ])
  assert.deepEqual(cells.slice(0, 4), [
    ['tableWidget_SJCJ_F000H_Send', 25, 1, '-45.0'],
    ['tableWidget_SJCJ_F000H_Send', 26, 1, '0.0'],
    ['tableWidget_SJCJ_F000H_Send', 25, 1, '-40.0'],
    ['tableWidget_SJCJ_F000H_Send', 26, 1, '-15.0']
  ])
  assert.deepEqual(cells.slice(-2), [
    ['tableWidget_SJCJ_F000H_Send', 25, 1, '0.0'],
    ['tableWidget_SJCJ_F000H_Send', 26, 1, '0.0']
  ])
})

test('turntable base position uses the same >= 140 minus 360 rule as the upper service', () => {
  assert.equal(normalizeTurntableBasePosition(139.9), 139.9)
  assert.equal(normalizeTurntableBasePosition(140), -220)
  assert.ok(Math.abs(normalizeTurntableBasePosition(359.8) - (-0.2)) < 1e-9)
  assert.equal(normalizeTurntableBasePosition(-359.8), -359.8)
})

test('A-frame cleanup survives the asynchronous update restart race', async () => {
  let running = false
  let buttonText = '停止数据采集'
  let clicks = 0
  let pendingRestart = true
  const h = {
    log: () => {},
    getText: async (id) => id === 'pushButton_SJCJ_0010H' ? '开始保存A/B帧' : buttonText,
    click: async (id) => {
      if (id === 'pushButton_SJCJ_0010H') return
      clicks++
      running = !running
      buttonText = running ? '停止数据采集' : '开始数据采集'
    },
    waitCleanup: async () => {
      if (pendingRestart) {
        pendingRestart = false
        running = true
        buttonText = '停止数据采集'
      }
    }
  }

  await stopAcquisitionAndSave(h, { force: true })

  assert.equal(running, false)
  assert.equal(buttonText, '开始数据采集')
  assert.equal(clicks, 2)
})
