import React from 'react'
import ReactDOM from 'react-dom/client'
import { NotificationsProvider } from './context/NotificationsContext'
import App from './App.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </React.StrictMode>,
)