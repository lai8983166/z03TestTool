const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { sidebar, flows, makeHelpers, configureRuntime } = require('./flow')

const DEFAULT_PAGE_URL = 'http://localhost:8080'
let PAGE_URL = DEFAULT_PAGE_URL
let runtimeConfig = null
let configError = null

let panelWin = null
let pageWin = null
let pageLoaded = null
let running = false
let currentFlow = null
let abortCtl = null
let shutdownStarted = false

function getConfigCandidates() {
  const candidates = []
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'config.json'))
  }
  if (app.isPackaged) {
    candidates.push(path.join(path.dirname(process.execPath), 'config.json'))
    candidates.push(path.join(process.resourcesPath, 'config.json'))
    candidates.push(path.join(app.getAppPath(), 'config.json'))
  } else {
    candidates.push(path.join(__dirname, 'config.json'))
  }
  return [...new Set(candidates)]
}

function loadRuntimeConfig() {
  const candidates = getConfigCandidates()
  const configPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!configPath) {
    throw new Error(`找不到配置文件 config.json，请放在程序目录：${candidates[0]}`)
  }

  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    throw new Error(`读取配置文件失败：${configPath}（${e.message}）`)
  }

  const upperComputerPath = typeof config.upperComputerPath === 'string'
    ? config.upperComputerPath.trim()
    : ''
  if (!upperComputerPath) {
    throw new Error(`配置文件缺少 upperComputerPath：${configPath}`)
  }

  runtimeConfig = {
    pageUrl: typeof config.pageUrl === 'string' && config.pageUrl.trim()
      ? config.pageUrl.trim()
      : DEFAULT_PAGE_URL,
    upperComputerPath,
    configPath
  }
  PAGE_URL = runtimeConfig.pageUrl
  configureRuntime({ upperComputerPath })
}

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
  panelWin.loadFile(path.join(__dirname, 'panel.html'))
  panelWin.on('closed', () => {
    panelWin = null
    // 隐藏的 pageWin 仍存在时不会触发 window-all-closed，必须主动退出。
    requestShutdown('主窗口已关闭')
  })
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

async function cleanupPageTasks() {
  if (!pageWin || pageWin.isDestroyed() || pageWin.webContents.isDestroyed()) return
  const cleanupScript = `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const click = id => document.getElementById(id)?.click();
      const stopToggle = async (id, attempts) => {
        for (let i = 0; i < attempts; i++) {
          const el = document.getElementById(id);
          if (!el || !el.textContent.includes('停止')) return;
          el.click();
          await wait(150);
        }
      };
      click('tt_btn_stop');
      await stopToggle('pushButton_SJCJ_0010H', 2);
      await stopToggle('pushButton_SJCJ_F000H_SendSequence', 2);
      await stopToggle('pushButton_SJCJ_F000H_Send', 4);
      return 'ok';
    })()
  `
  await Promise.race([
    pageWin.webContents.executeJavaScript(cleanupScript),
    new Promise((_, reject) => setTimeout(() => reject(new Error('页面清理超时')), 2000))
  ])
}

async function requestShutdown(reason) {
  if (shutdownStarted) return
  shutdownStarted = true
  if (abortCtl) abortCtl.abort()
  log(`正在退出：${reason}，停止转台、保存与A帧发送...`)
  try {
    await cleanupPageTasks()
  } catch (e) {
    console.warn(`[warn] 退出清理未完全执行: ${e.message}`)
  } finally {
    if (pageWin && !pageWin.isDestroyed()) pageWin.destroy()
    if (panelWin && !panelWin.isDestroyed()) panelWin.destroy()
    app.exit(0)
  }
}

ipcMain.handle('flow:list', () => Object.keys(flows))

ipcMain.handle('flow:run', async (_e, name) => {
  if (configError) {
    log(configError.message, 'error')
    sendStatus('error')
    return { ok: false, error: configError.message }
  }
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
  try {
    loadRuntimeConfig()
  } catch (e) {
    configError = e
  }
  createPanel()
  if (configError) log(configError.message, 'error')
})

app.on('window-all-closed', () => requestShutdown('所有窗口已关闭'))
app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  requestShutdown('应用退出')
})
