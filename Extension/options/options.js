const DEFAULT = 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net'

chrome.storage.sync.get(['apiUrl'], ({ apiUrl }) => {
  document.getElementById('api-url').value = apiUrl || DEFAULT
})

document.getElementById('save').addEventListener('click', () => {
  const url = document.getElementById('api-url').value.trim()
  chrome.storage.sync.set({ apiUrl: url || DEFAULT }, () => {
    const status = document.getElementById('status')
    status.textContent = 'Saved.'
    setTimeout(() => { status.textContent = '' }, 2000)
  })
})
