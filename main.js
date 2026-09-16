const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { sidebar, flows, makeHelpers } = require('./flow')

const PAGE_URL = 'http://localhost:8080'

let panelWin = null
let pageWin = null
let pageLoaded = null
let running = false
let currentFlow = null
let abortCtl = null

function log(msg, level = 'info') {
  console.log(`[${level}] ${msg}`)
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('flow:log', {
      level,
      msg,
      t: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    })
  }
}

function sendStatus(phase) {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('flow:status', { phase, flow: currentFlow })
  }
}

function createPanel() {
  panelWin = new BrowserWindow({
    width: 900,
    height: 560,
    title: 'Z03 自动化工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  panelWin.loadFile('panel.html')
  panelWin.on('closed', () => { panelWin = null })
}

// 隐藏的上位机页面窗口；did-finish-load 完成前不执行任何点击
function ensurePage() {
  if (pageWin && !pageWin.isDestroyed() && pageLoaded) return pageLoaded
  pageWin = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  pageLoaded = new Promise((resolve, reject) => {
    pageWin.webContents.on('did-finish-load', () => {
      log('上位机页面加载完成')
      resolve()
    })
    pageWin.webContents.on('did-fail-load', (_e, code, desc) => {
      reject(new Error(`页面加载失败(${code}): ${desc}`))
    })
  })
  pageWin.loadURL(PAGE_URL)
  pageWin.on('closed', () => { pageWin = null; pageLoaded = null })
  return pageLoaded
}

function exec(js) {
  return ensurePage().then(() => pageWin.webContents.executeJavaScript(js))
}

ipcMain.handle('flow:list', () => Object.keys(flows))

ipcMain.handle('flow:run', async (_e, name) => {
  const flow = flows[name]
  if (!flow) throw new Error(`未知流程: ${name}`)
  if (running) throw new Error('流程正在运行中')
  running = true
  currentFlow = name
  abortCtl = new AbortController()
  const signal = abortCtl.signal
  sendStatus('running')
  try {
    log(`▶ 开始流程【${name}】`)
    log('检查上位机服务...')
    try {
      const res = await fetch(PAGE_URL, { signal })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      log('上位机服务在线')
    } catch (e) {
      if (signal.aborted) throw new Error('已中止')
      throw new Error(`上位机服务离线，请先手动运行 start.bat（${e.message}）`)
    }

    await flow(makeHelpers({ exec, log, signal }))
    log(`✅ 流程【${name}】执行完成`)
    sendStatus('done')
  } catch (e) {
    const aborted = e.message === '已中止'
    log(aborted ? '⏹ 流程已中止' : `❌ ${e.message || e}`, aborted ? 'warn' : 'error')
    sendStatus(aborted ? 'idle' : 'error')
  } finally {
    running = false
    currentFlow = null
  }
  return { ok: true }
})

ipcMain.handle('flow:stop', () => {
  if (abortCtl) abortCtl.abort()
  return { ok: true }
})

ipcMain.handle('flow:getState', () => ({
  running,
  currentFlow,
  sidebar
}))

app.whenReady().then(() => {
  createPanel()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  if (pageWin && !pageWin.isDestroyed()) pageWin.destroy()
})
