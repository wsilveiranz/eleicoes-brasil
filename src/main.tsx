import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { createAppQueryClient } from './app/queryClient'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Elemento raiz da aplicação não encontrado.')
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={createAppQueryClient()}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
