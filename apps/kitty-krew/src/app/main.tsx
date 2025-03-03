/// <reference types="vinxi/types/client" />

import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import './main.css'

import { createRouter } from './router.tsx'

// Set up a Router instance
const router = createRouter()

// biome-ignore lint/style/noNonNullAssertion: legit
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  )
}
