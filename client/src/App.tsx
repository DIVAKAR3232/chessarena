import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { ToastProvider } from './components/ui/toast';
import { AuthProvider } from './features/auth/AuthContext';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  );
}
