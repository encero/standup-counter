import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StandupProvider } from '@/context/StandupContext';
import { StandupTimer } from '@/pages/StandupTimer';
import { ControlPage } from '@/pages/ControlPage';
import { TrendsPage } from '@/pages/TrendsPage';
import { TeamNotFound } from '@/pages/TeamNotFound';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Team-scoped routes */}
        <Route path="/:teamId" element={
          <StandupProvider>
            <StandupTimer />
          </StandupProvider>
        } />
        <Route path="/:teamId/control" element={<ControlPage />} />
        <Route path="/:teamId/trends" element={<TrendsPage />} />

        {/* Team not found page */}
        <Route path="/team-not-found" element={<TeamNotFound />} />

        {/* Root redirect - no default team */}
        <Route path="/" element={<TeamNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
