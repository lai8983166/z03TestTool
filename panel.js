const flowListEl = document.getElementById('flow-list')
const dotEl = document.getElementById('dot')
const statusEl = document.getElementById('status')
const currentFlowEl = document.getElementById('current-flow')
const btnStop = document.getElementById('btn-stop')
const logEl = document.getElementById('log')

const STATUS_TEXT = { running: '运行中', done: '完成', error: '出错', idle: '空闲' }

let running = false

function renderFlowButtons(names, activeFlow) {
  flowListEl.textContent = ''
  for (const name of names) {
    const btn = document.createElement('button')
    btn.className = 'flow-btn' + (name === activeFlow ? ' active' : '')
    btn.textContent = name
    btn.disabled = running
    btn.addEventListener('click', () => window.z03.run(name))
    flowListEl.appendChild(btn)
  }
}

function setRunningUI(isRunning, flow) {
  running = isRunning
  for (const btn of flowListEl.children) btn.disabled = running
  const active = [...flowListEl.children].find(b => b.textContent === flow)
  for (const btn of flowListEl.children) btn.classList.toggle('active', btn === active && running)
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

window.z03.getState().then(({ running, currentFlow, flows }) => {
  renderFlowButtons(flows, currentFlow)
  if (running) {
    setRunningUI(true, currentFlow)
    statusEl.textContent = '运行中'
  }
})
