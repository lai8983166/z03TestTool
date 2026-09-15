const sidebarEl = document.getElementById('sidebar-list')
const dotEl = document.getElementById('dot')
const statusEl = document.getElementById('status')
const currentFlowEl = document.getElementById('current-flow')
const btnStop = document.getElementById('btn-stop')
const logEl = document.getElementById('log')

const STATUS_TEXT = { running: '运行中', done: '完成', error: '出错', idle: '空闲' }

let running = false
let sidebarItems = []

function renderSidebar(activeFlow) {
  sidebarEl.textContent = ''
  for (const item of sidebarItems) {
    if (item.type === 'button') {
      const btn = document.createElement('button')
      btn.className = 'flow-btn' + (item.label === activeFlow ? ' active' : '')
      btn.textContent = item.label
      btn.disabled = running
      btn.addEventListener('click', () => window.z03.run(item.label))
      sidebarEl.appendChild(btn)
    } else if (item.type === 'select') {
      const sel = document.createElement('select')
      sel.className = 'flow-select'
      sel.disabled = running
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = item.label
      sel.appendChild(placeholder)
      for (const opt of item.options) {
        const name = `${item.label} - ${opt}`
        const o = document.createElement('option')
        o.value = name
        o.textContent = opt
        sel.appendChild(o)
      }
      if (running && activeFlow && activeFlow.startsWith(`${item.label} - `)) sel.value = activeFlow
      sel.addEventListener('change', () => {
        const name = sel.value
        sel.value = ''
        if (name) window.z03.run(name)
      })
      sidebarEl.appendChild(sel)
    }
  }
}

function setRunningUI(isRunning, flow) {
  running = isRunning
  renderSidebar(running ? flow : null)
  btnStop.disabled = !running
  dotEl.className = 'dot' + (running ? ' green' : '')
  currentFlowEl.textContent = running && flow ? `【${flow}】` : ''
}

window.z03.onLog(({ level, msg, t }) => {
  const div = document.createElement('div')
  div.className = `line ${level || ''}`
  div.textContent = `[${t}] ${msg}`
  logEl.appendChild(div)
  while (logEl.childElementCount > 500) logEl.firstChild.remove()
  logEl.scrollTop = logEl.scrollHeight
})

window.z03.onStatus(({ phase, flow }) => {
  setRunningUI(phase === 'running', flow)
  statusEl.textContent = STATUS_TEXT[phase] || '空闲'
  if (phase === 'error') dotEl.classList.add('red')
})

btnStop.addEventListener('click', () => window.z03.stop())

window.z03.getState().then(({ running: isRunning, currentFlow, sidebar }) => {
  sidebarItems = sidebar
  renderSidebar(isRunning ? currentFlow : null)
  if (isRunning) {
    setRunningUI(true, currentFlow)
    statusEl.textContent = '运行中'
  }
})
