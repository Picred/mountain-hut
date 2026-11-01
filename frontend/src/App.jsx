import './App.css';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router';
import LoginForm from './components/AuthComponents/LoginForm';
import RegisterForm from './components/AuthComponents/RegistrationForm';
import { useEffect, useState } from 'react';
import authAPI from './api/auth_api'; // Assicurati che il nome del file coincida
import { Homepage } from './pages/Homepage';
import { Layout } from './pages/Layout';
import { ReservationPage } from './pages/ReservationPage';
import { CapacityPage } from './pages/CapacityPage';

export const App = () => {
  const [user, setUser] = useState(undefined);
  const [loggedIn, setLoggedIn] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const navigate = useNavigate(); // to redirect the user
  const location = useLocation();


  // checks session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const currentUser = await authAPI.getCurrentUser();

        if (currentUser) {
          setUser(currentUser);
          setLoggedIn(true);
        } else {
          setUser(undefined);
          setLoggedIn(false);
        }
      } catch {
        setUser(undefined);
        setLoggedIn(false);
      } finally {
        setSessionLoading(false);
      }
    };

    checkSession();
  }, []);

  // 2. Timer per far svanire i messaggi di errore/successo
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3000); // Aumentato a 3 secondi per dare tempo di leggere
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Handler for login
  const handleLogin = async (email, password) => {
    try {
      const loggedUser = await authAPI.login(email, password);
      setLoggedIn(true);
      setUser(loggedUser);
      setMessage({ msg: "Logged in successfully!", type: "success" });
      navigate(location.state?.from || "/", { replace: true }); // Goes back to the homepage after the login
    } catch (err) {
      throw new Error(
        err.message || "Invalid email or password. Please try again."
      );
    }
  }

  // handler for registration
  const handleRegister = async (name, email, phone, password) => {
    try {
      const newUser = await authAPI.register(name, email, phone, password);
      setLoggedIn(true);
      setUser(newUser);
      setMessage({ msg: "Registration completed successfully!", type: "success" });
      navigate("/"); // goes back to homepage
    } catch (err) {
      throw new Error(
        err.message || "Registration failed. Please try again."
      );
    }
  }

  // 5. Handler for Logout
  const handleLogout = async () => {
    try {
      await authAPI.logout();
      setLoggedIn(false);
      setUser(undefined);
      setMessage({ msg: "Logout effettuato.", type: "info" });
      navigate("/"); // redirects to homepage after logout 
    } catch {
      setMessage({ msg: "Logout non riuscito. Riprova.", type: "error" });
    }
  }

  return (
    <>


      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className="fixed left-1/2 top-24 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
        >
          <div
            className={`flex items-center gap-3 rounded-xl border px-5 py-4 text-sm font-medium shadow-xl ${message.type === "success"
              ? "border-emerald-400/30 bg-[#132a27] text-emerald-300"
              : message.type === "error"
                ? "border-red-400/30 bg-[#301d25] text-red-300"
                : "border-sky-300/30 bg-[#172333] text-sky-300"
              }`}
          >
            {message.type === "success" ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
            )}

            <span className="min-w-0 flex-1 break-words">
              {message.msg}
            </span>
          </div>
        </div>
      )}

      <Routes>
        <Route
          path="/"
          element={
            <Layout
              user={user}
              loggedIn={loggedIn}
              onLogout={handleLogout}
            />
          }
        >
          <Route index element={<Homepage />} />

          <Route
            path="/reservations"
            element={
              sessionLoading ? (
                <div className="flex items-center justify-center text-slate-300">
                  Checking session...
                </div>
              ) : loggedIn && user?.role === 'hiker' ? (
                <ReservationPage />
              ) : loggedIn ? (
                <Navigate to="/" replace />
              ) : (
                <Navigate
                  to="/login"
                  replace
                  state={{ from: location.pathname }}
                />
              )
            }
          />

          <Route
            path="/capacity"
            element={
              sessionLoading ? (
                <div className="flex items-center justify-center text-slate-300">
                  Checking session...
                </div>
              ) : !loggedIn ? (
                <Navigate
                  to="/login"
                  replace
                  state={{ from: location.pathname }}
                />
              ) : user?.role !== "employee" ? (
                <Navigate to="/" replace />
              ) : (
                <CapacityPage />
              )
            }
          />

          <Route
            path="/login"
            element={<LoginForm onLogin={handleLogin} />}
          />

          <Route
            path="/register"
            element={<RegisterForm onRegister={handleRegister} />}
          />

          <Route path="*" element={<p>Not Found</p>} />
        </Route>
      </Routes>
    </>
  );
}
