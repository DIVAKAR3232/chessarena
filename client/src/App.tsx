import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { ToastProvider } from './components/ui/toast';
import { HalloweenBackdrop } from './components/halloween/HalloweenBackdrop';
import { AuthProvider } from './features/auth/AuthContext';

export function App() {
  return (
    <ToastProvider>
      <HalloweenBackdrop />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  );
}
