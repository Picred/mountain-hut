import { useNavigate } from "react-router"
import LogoutButton from "./AuthComponents/LogoutButton";

export const Navbar = ({ user, loggedIn, onLogout }) => {
  const navigate = useNavigate()

  return (
    /* Header fisso in alto con sfocatura dello sfondo (Glassmorphism) */
    <header className="sticky top-0 z-50 bg-[#080e18]/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="navbar min-h-16 px-0 justify-between">

          {/* Logo con icona del brand */}
          <div className="flex-1">
            <button
              onClick={() => navigate("/")}
              className="btn btn-ghost normal-case text-xl font-bold tracking-wide text-white hover:bg-neutral-800/60 gap-2.5 px-2"
            >
              {/* Icona Montagna/Rifugio */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-300"><path d="m8 3 4 8 5-5 5 15H2L8 3z" /><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" /></svg>
              <span>Mountain Hut</span>
            </button>
          </div>

          {/* Sezione Azioni e Profilo */}
          <div className="flex items-center gap-2 sm:gap-3">

            {/* CTA Principale: Prenota un tavolo */}
            {user?.role !== "employee" && (
              <button
                className="btn btn-sm bg-sky-300 hover:bg-sky-400 border-sky-300 hover:border-sky-400 text-slate-950 font-semibold shadow-md hover:shadow-lg transition-all gap-1.5"
                onClick={() => navigate("/reservations")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-plus-2 preview-icon"><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M10 15h4" /><path d="M12 13v4" /></svg>
                <span className="hidden sm:inline">Reserve a table</span>
                <span className="sm:hidden">Book</span>
              </button>
            )}

            {/* Pulsante Login secondario */}
            {!loggedIn && (
              <button
                className="btn btn-ghost btn-sm text-neutral-300 hover:text-white hover:bg-neutral-800"
                onClick={() => navigate("/login")}
              >
                Login
              </button>
            )}

            {/* Dropdown Profilo Utente */}
            <div className="dropdown dropdown-end">
              <div
                tabIndex={0}
                role="button"
                className="btn btn-ghost h-11 w-auto min-w-11 px-2.5 gap-2 rounded-full border-2 border-white hover:border-sky-400/50 hover:bg-white/10 transition-all"
              >
                {user?.role === "employee" ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M12 12h.01" /><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M22 13a18.15 18.15 0 0 1-20 0" /><rect width="20" height="14" x="2" y="6" rx="2" /></svg>
                ) : (
                  <div className="">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
                  </div>
                )}
                {loggedIn && user?.name && (
                  <span className="hidden sm:inline text-sm font-medium text-slate-200">
                    {user.name}
                  </span>
                )}
              </div>

              <ul
                tabIndex={0}
                className="dropdown-content menu p-2 mt-3 z-50 w-56 rounded-xl bg-neutral-800 text-neutral-200 border border-neutral-700 shadow-xl space-y-1"
              >
                {loggedIn ? (
                  <>
                    <li className="menu-title text-neutral-400 text-[11px] px-3 py-1 font-semibold uppercase tracking-wider border-b border-neutral-700 mb-1">
                      My Account
                    </li>

                    {user?.role === "employee" && (
                      <li>
                        <button
                          type="button"
                          onClick={() => navigate("/capacity")}
                          className="text-slate-200 hover:text-sky-300"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="M17.5 15.5 16 17l1.5 1.5" /><path d="M20 17h-4" /></svg>
                          <span>Capacity Management</span>
                        </button>
                      </li>
                    )}

                    <li>
                      <LogoutButton onLogout={onLogout} />
                    </li>
                  </>
                ) : (
                  <li>
                    <button onClick={() => navigate("/login")}>
                      Login
                    </button>
                  </li>
                )}
              </ul>
            </div>

          </div>

        </div>
      </div>
    </header >
  )
}