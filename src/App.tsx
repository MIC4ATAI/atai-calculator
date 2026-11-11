import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { HomePage } from './app/HomePage';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { OrgProvider } from './org/OrgProvider';
import { OrgSelectPage } from './org/OrgSelectPage';
import { RequireOrg } from './org/RequireOrg';

export function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/org" element={<OrgSelectPage />} />
            <Route element={<RequireOrg />}>
              <Route element={<AppShell />}>
                <Route path="/app" element={<HomePage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </OrgProvider>
    </AuthProvider>
  );
}
