import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import '@/styles/index.css'
import { AuthProvider } from '@/hooks/useAuth'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/pages/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { BookmarksPage } from '@/pages/BookmarksPage'
import { SearchPage } from '@/pages/SearchPage'
import { TrashPage } from '@/pages/TrashPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { MembersPage } from '@/pages/MembersPage'
import { TokensPage } from '@/pages/TokensPage'
import { SyncPage } from '@/pages/SyncPage'
import { ImportExportPage } from '@/pages/ImportExportPage'
import { AdminPage } from '@/pages/AdminPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<AppLayout />}>
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/collections/:id" element={<BookmarksPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/trash" element={<TrashPage />} />
              <Route path="/settings/profile" element={<ProfilePage />} />
              <Route path="/settings/workspace" element={<WorkspacePage />} />
              <Route path="/settings/members" element={<MembersPage />} />
              <Route path="/settings/tokens" element={<TokensPage />} />
              <Route path="/settings/sync" element={<SyncPage />} />
              <Route path="/settings/import-export" element={<ImportExportPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/bookmarks" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
