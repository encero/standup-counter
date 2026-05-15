import { createContext, useContext, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useStandupTimer, type ConnectionStatus } from '@/hooks/useStandupTimer';

export type { ConnectionStatus };

type StandupContextType = ReturnType<typeof useStandupTimer> & { teamId: string };

const StandupContext = createContext<StandupContextType | null>(null);

export function StandupProvider({ children }: { children: ReactNode }) {
  const { teamId } = useParams<{ teamId: string }>();
  const standup = useStandupTimer(teamId || '');

  return (
    <StandupContext.Provider value={{ ...standup, teamId: teamId || '' }}>
      {children}
    </StandupContext.Provider>
  );
}

export function useStandup() {
  const context = useContext(StandupContext);
  if (!context) {
    throw new Error('useStandup must be used within a StandupProvider');
  }
  return context;
}
