const status = document.querySelector<HTMLParagraphElement>('#status')
const retry = document.querySelector<HTMLButtonElement>('#retry')
const diagnostics = document.querySelector<HTMLButtonElement>('#diagnostics')
const quit = document.querySelector<HTMLButtonElement>('#quit')
let retrying = false

function setStatus(message: string): void {
  if (status !== null) status.textContent = message
}

async function retryAgent(): Promise<void> {
  if (retrying) return
  retrying = true
  if (retry) retry.disabled = true
  setStatus('正在启动本地 DSH Host...')
  try {
    const api = (window as any).narwhal
    if (api && typeof api.retryAgent === 'function') {
      await api.retryAgent()
      setStatus('本地 Agent 正在启动，页面将自动刷新...')
      setTimeout(() => { window.location.reload() }, 1200)
    } else {
      setStatus('桌面桥不可用，请重新打开应用。')
    }
  } catch (err) {
    setStatus('启动失败：' + (err instanceof Error ? err.message : String(err)))
    if (retry) retry.disabled = false
  } finally {
    retrying = false
  }
}

retry?.addEventListener('click', () => { void retryAgent() })
diagnostics?.addEventListener('click', () => { setStatus('启动日志位于应用日志文件夹。') })
quit?.addEventListener('click', () => { window.close() })

// Auto-retry on load
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { void retryAgent() }, 1500)
})
