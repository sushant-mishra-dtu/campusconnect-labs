import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Attempt } from './pages/Attempt';
import { ChallengeDetail } from './pages/ChallengeDetail';
import { Challenges } from './pages/Challenges';
import { Labs } from './pages/Labs';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { PostChallenge } from './pages/PostChallenge';
import { Profile } from './pages/Profile';
import { Proof } from './pages/Proof';

function Private({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/challenges" element={<Challenges />} />
        <Route path="/challenges/new" element={<Private><PostChallenge /></Private>} />
        <Route path="/challenges/:id" element={<ChallengeDetail />} />
        <Route path="/challenges/:id/attempt" element={<Private><Attempt /></Private>} />
        <Route path="/labs" element={<Labs />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/proof/:id" element={<Proof />} />
        <Route path="*" element={<Private><Navigate to="/" replace /></Private>} />
      </Route>
    </Routes>
  );
}
