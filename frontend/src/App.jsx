import './App.css';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router';
import LoginForm from './components/AuthComponents/LoginForm';
import RegisterForm from './components/AuthComponents/RegistrationForm';
import ChangePasswordForm from './components/AuthComponents/ChangePasswordForm';
import ForgotPasswordForm from './components/AuthComponents/ForgotPasswordForm';
import { useEffect, useState } from 'react';
import authAPI from './api/auth_api'; // Assicurati che il nome del file coincida
import { Homepage } from './pages/Homepage';
import { Layout } from './pages/Layout';
import { ReservationPage } from './pages/ReservationPage';
import { EmployeeReservationPage } from './pages/EmployeeReservationPage';
import { CapacityPage } from './pages/CapacityPage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { LocationPage } from './pages/Location';
import { ServicesPage } from './pages/Services';
import { ExcursionsPage } from './pages/Excursions';

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

  // Goes back to the page the user came from (the homepage by default),
  // keeping the booking selection made before the login, if any.
  const goBack = () => {
    navigate(location.state?.from || "/", {
      replace: true,
      state: location.state?.reservation
        ? { reservation: location.state.reservation }
        : undefined,
    });
  };

  // Handler for login
  const handleLogin = async (email, password) => {
    try {
      const loggedUser = await authAPI.login(email, password);
      setLoggedIn(true);
      setUser(loggedUser);
      setMessage({ msg: "Logged in successfully!", type: "success" });

      if (loggedUser.passwordToChange) {
        // A temporary password must be replaced before using the site.
        navigate("/change-password", { replace: true, state: location.state ?? undefined });
        return;
      }

      goBack();
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

  // Handler for the change of a temporary password
  const handleChangePassword = async (newPassword) => {
    try {
      const updatedUser = await authAPI.changePassword(newPassword);
      setUser(updatedUser);
      setMessage({ msg: "Password changed successfully!", type: "success" });
      goBack();
    } catch (err) {
      throw new Error(
        err.message || "Could not change the password. Please try again."
      );
    }
  }

  // Handler for the new password chosen from the recovery link (/reset-password?token=...)
  const handleResetPassword = async (newPassword) => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    await authAPI.confirmPasswordReset(token, newPassword);
    setMessage({ msg: "Password changed: log in with the new password.", type: "success" });
    navigate("/login", { replace: true });
  };

  // 5. Handler for Logout
  const handleLogout = async () => {
    try {
      await authAPI.logout();
      setLoggedIn(false);
      setUser(undefined);
      setMessage({ msg: "Logged out successfully!", type: "info" });
      navigate("/"); // redirects to homepage after logout 
    } catch {
      setMessage({ msg: "Logout failed. Please try again.", type: "error" });
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

      {/* Until the temporary password is changed, only the change-password page is available. */}
      {loggedIn && user?.passwordToChange && location.pathname !== "/change-password" && (
        <Navigate
          to="/change-password"
          replace
          state={
            location.state ?? {
              from: ["/login", "/register"].includes(location.pathname) ? "/" : location.pathname,
            }
          }
        />
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

          {/* Detail pages opened from the homepage cards. */}
          <Route path="/location" element={<LocationPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/excursions" element={<ExcursionsPage />} />

          <Route
            path="/reservations"
            element={
              sessionLoading ? (
                <div className="flex items-center justify-center text-slate-300">
                  Checking session...
                </div>
              ) : loggedIn && user?.role !== 'hiker' ? (
                // Employees enter reservations from their own page.
                <Navigate
                  to={user?.role === 'employee' ? '/employee/reservations' : '/'}
                  replace
                />
              ) : (
                // Visitors and hikers: anyone can check the availability,
                // only logged-in hikers can reserve.
                <ReservationPage loggedIn={loggedIn} />
              )
            }
          />

          <Route
            path="/my-reservations"
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
              ) : user?.role !== "hiker" ? (
                <Navigate to="/" replace />
              ) : (
                <MyReservationsPage />
              )
            }
          />

          <Route
            path="/employee/reservations"
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
                <EmployeeReservationPage />
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
            path="/change-password"
            element={
              sessionLoading ? (
                <div className="flex items-center justify-center text-slate-300">
                  Checking session...
                </div>
              ) : !loggedIn ? (
                <Navigate to="/login" replace />
              ) : !user?.passwordToChange ? (
                <Navigate to={location.state?.from || "/"} replace />
              ) : (
                <ChangePasswordForm onChangePassword={handleChangePassword} />
              )
            }
          />

          <Route
            path="/login"
            element={<LoginForm onLogin={handleLogin} />}
          />

          <Route
            path="/forgot-password"
            element={
              loggedIn ? (
                <Navigate to="/" replace />
              ) : (
                <ForgotPasswordForm onResetPassword={authAPI.resetPassword} />
              )
            }
          />
          <Route
            path="/reset-password"
            element={
              loggedIn ? (
                <Navigate to="/" replace />
              ) : (
                <ChangePasswordForm
                  onChangePassword={handleResetPassword}
                  subtitle="Choose a new password for your account. The link is valid for 24 hours and can be used only once."
                />
              )
            }
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