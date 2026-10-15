import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './hooks/use-theme'
import { SidebarProvider } from './hooks/use-sidebar'
import { PreferencesProvider } from './hooks/use-preferences'
import { AuthProvider } from './hooks/use-auth'
import './index.css'

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <SidebarProvider>
            <PreferencesProvider>
              <App />
            </PreferencesProvider>
          </SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </Router>
  </React.StrictMode>,
)
