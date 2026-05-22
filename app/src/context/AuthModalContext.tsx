import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { AuthModal, type AuthModalView } from '@/components/auth/AuthModal';

export type { AuthModalView };

interface AuthModalContextValue {
  isOpen: boolean;
  openModal: (view?: AuthModalView) => void;
  closeModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialView, setInitialView] = useState<AuthModalView>('landing');

  const openModal = useCallback((view: AuthModalView = 'landing') => {
    setInitialView(view);
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <AuthModalContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
      <AuthModal isOpen={isOpen} onClose={closeModal} initialView={initialView} />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error('useAuthModal must be used within AuthModalProvider');
  return ctx;
}
