const status = document.querySelector<HTMLParagraphElement>('#status')
const retry = document.querySelector<HTMLButtonElement>('#retry')
const diagnostics = document.querySelector<HTMLButtonElement>('#diagnostics')
const quit = document.querySelector<HTMLButtonElement>('#quit')

function setStatus(message: string): void {
  if (status !== null) status.textContent = message
}

retry?.addEventListener('click', () => { setStatus('Please reopen Narwhal Forge to retry the local agent.') })
diagnostics?.addEventListener('click', () => { setStatus('Startup logs are available in the application Logs folder.') })
quit?.addEventListener('click', () => { window.close() })
