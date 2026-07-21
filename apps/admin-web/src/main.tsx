import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Refine } from '@refinedev/core'
import { AdminApp } from './App'
import { adminAccessControlProvider, adminAuthProvider, adminDataProvider } from './refine'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Refine
      dataProvider={adminDataProvider}
      authProvider={adminAuthProvider}
      accessControlProvider={adminAccessControlProvider}
      resources={[{ name: 'audit-events', list: '/audit-events' }]}
      options={{ reactQuery: { clientConfig: { defaultOptions: { queries: { retry: false } } } } }}
    >
      <AdminApp />
    </Refine>
  </StrictMode>,
)
