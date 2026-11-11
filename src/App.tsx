import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { HomePage } from './app/HomePage';
import { FollowUpPage } from './followup/FollowUpPage';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { NotificationsPage } from './profile/NotificationsPage';
import { OrgProvider } from './org/OrgProvider';
import { OrgSelectPage } from './org/OrgSelectPage';
import { RequireOrg } from './org/RequireOrg';
import { PrivacyPolicyPage } from './legal/PrivacyPolicyPage';
import { GuestPage } from './session/GuestPage';
import { SessionPage } from './session/SessionPage';

export function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Polityka prywatności administratora: publiczna, bez logowania. */}
          <Route path="/polityka-prywatnosci" element={<PrivacyPolicyPage />} />
          {/* Widok rozmówcy: otwierany z linku, bez logowania. */}
          <Route path="/s/:token" element={<GuestPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/org" element={<OrgSelectPage />} />
            <Route element={<RequireOrg />}>
              <Route element={<AppShell />}>
                <Route path="/app" element={<HomePage />} />
                <Route path="/session/:id" element={<SessionPage />} />
                <Route path="/session/:id/follow-up" element={<FollowUpPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </OrgProvider>
    </AuthProvider>
  );
}
