void import('./main').catch(async (error: unknown) => {
  console.error('[boot] Failed to load the game module.', error)
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  try {
    const { Ui } = await import('./ui/ui')
    Ui.fatal(`Loading failed · Stage module-import · ${detail}`)
  } catch {
    const message = document.createElement('pre')
    message.textContent = `The apartments failed to load.\n${detail}`
    message.style.cssText = 'position:fixed;inset:0;margin:0;padding:32px;background:#16110b;color:#f1e9d4;white-space:pre-wrap;font:14px/1.5 monospace;z-index:2147483647'
    document.body.appendChild(message)
  }
})
